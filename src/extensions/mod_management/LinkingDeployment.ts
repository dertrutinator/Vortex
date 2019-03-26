import {addNotification} from '../../actions/notifications';
import {IExtensionApi} from '../../types/IExtensionContext';
import { UserCanceled } from '../../util/api';
import * as fs from '../../util/fs';
import {Normalize} from '../../util/getNormalizeFunc';
import {log} from '../../util/log';
import { truthy } from '../../util/util';

import {
  IDeployedFile,
  IDeploymentMethod,
  IFileChange,
  IUnavailableReason,
} from './types/IDeploymentMethod';

import * as Promise from 'bluebird';
import * as I18next from 'i18next';
import * as _ from 'lodash';
import * as path from 'path';
import turbowalk from 'turbowalk';

export interface IDeployment {
  [relPath: string]: IDeployedFile;
}

// TODO: guess I need to pull this out of the linking activator as the deployment
//   code needs to know about these files when merging archives
export const BACKUP_TAG = '.vortex_backup';

interface IDeploymentContext {
  previousDeployment: IDeployment;
  newDeployment: IDeployment;
  onComplete: () => void;
}

/**
 * base class for mod activators that use some form of file-based linking
 * (which is probably all of them)
 */
abstract class LinkingActivator implements IDeploymentMethod {
  public static OLD_TAG_NAME = '__delete_if_empty';
  public static NEW_TAG_NAME = process.platform === 'win32'
    ? '__folder_managed_by_vortex'
    : '.__folder_managed_by_vortex';

  public id: string;
  public name: string;
  public description: string;
  public isFallbackPurgeSafe: boolean;

  private mApi: IExtensionApi;
  private mNormalize: Normalize;

  private mQueue: Promise<void> = Promise.resolve();
  private mContext: IDeploymentContext;

  constructor(id: string, name: string, description: string,
              fallbackPurgeSafe: boolean, api: IExtensionApi) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.isFallbackPurgeSafe = fallbackPurgeSafe;
    this.mApi = api;
  }

  public abstract isSupported(state: any, gameId: string, modTypeId: string): IUnavailableReason;

  /**
   * if necessary, get user confirmation we should deploy now. Right now this
   * is used for activators that require elevation, since this will prompt an OS dialog
   * and we don't want auto-deployment to pop up a dialog that takes the focus away
   * from the application without having the user initiate it
   *
   * @returns {Promise<void>}
   * @memberof LinkingActivator
   */
  public userGate(): Promise<void> {
    return Promise.resolve();
  }

  public detailedDescription(t: I18next.TranslationFunction): string {
    return t(this.description);
  }

  public prepare(dataPath: string, clean: boolean, lastDeployment: IDeployedFile[],
                 normalize: Normalize): Promise<void> {
    let queueResolve: () => void;
    const queueProm = new Promise<void>(resolve => {
      queueResolve = resolve;
    });

    const queue = this.mQueue;
    this.mQueue = this.mQueue.then(() => queueProm);
    this.mNormalize = normalize;

    return queue
      .then(() => {
        this.mContext = {
          newDeployment: {},
          previousDeployment: {},
          onComplete: queueResolve,
        };
        lastDeployment.forEach(file => {
          const key = this.mNormalize(file.relPath);
          this.mContext.previousDeployment[key] = file;
          if (!clean) {
            this.mContext.newDeployment[key] = file;
          }
        });
      });
  }

  public finalize(gameId: string,
                  dataPath: string,
                  installationPath: string,
                  progressCB?: (files: number, total: number) => void): Promise<IDeployedFile[]> {
    if (this.mContext === undefined) {
      return Promise.reject(new Error('No deployment in progress'));
    }

    let added: string[];
    let removed: string[];
    let sourceChanged: string[];
    let contentChanged: string[];

    let errorCount: number = 0;

    // unlink all files that were removed or changed
    ({added, removed, sourceChanged, contentChanged} =
         this.diffActivation(this.mContext.previousDeployment, this.mContext.newDeployment));
    log('debug', 'deployment', {
      added: added.length,
      removed: removed.length,
      'source changed': sourceChanged.length,
      modified: contentChanged.length,
    });

    const total = added.length + removed.length + sourceChanged.length + contentChanged.length;
    let count = 0;
    const progress = () => {
      if (progressCB !== undefined) {
        ++count;
        if ((count % 1000) === 0) {
          progressCB(count, total);
        }
      }
    };

    return Promise.map(removed, key =>
        this.removeDeployedFile(installationPath, dataPath, key, true)
          .catch(err => {
            log('warn', 'failed to remove deployed file', {
              link: this.mContext.newDeployment[key].relPath,
              error: err.message,
            });
            ++errorCount;
          }))
      .then(() => Promise.map(sourceChanged, (key: string, idx: number) =>
          this.removeDeployedFile(installationPath, dataPath, key, false)
          .catch(err => {
            log('warn', 'failed to remove deployed file', {
              link: this.mContext.newDeployment[key].relPath,
              error: err.message,
            });
            ++errorCount;
            sourceChanged.splice(idx, 1);
          })))
      .then(() => Promise.map(contentChanged, (key: string, idx: number) =>
          this.removeDeployedFile(installationPath, dataPath, key, false)
          .catch(err => {
            log('warn', 'failed to remove deployed file', {
              link: this.mContext.newDeployment[key].relPath,
              error: err.message,
            });
            ++errorCount;
            contentChanged.splice(idx, 1);
          })))
        // then, (re-)link all files that were added
        .then(() => Promise.map(
                  added,
                  key => this.deployFile(key, installationPath, dataPath, false)
                             .catch(err => {
                               log('warn', 'failed to link', {
                                 link: this.mContext.newDeployment[key].relPath,
                                 source: this.mContext.newDeployment[key].source,
                                 error: err.message,
                               });
                               ++errorCount;
                             })
                            .then(() => progress()), { concurrency: 100 }))
        // then update modified files
        .then(() => Promise.map(
                  [].concat(sourceChanged, contentChanged),
                  (key: string) =>
                      this.deployFile(key, installationPath, dataPath, true)
                          .catch(err => {
                            log('warn', 'failed to link', {
                              link: this.mContext.newDeployment[key].relPath,
                              source: this.mContext.newDeployment[key].source,
                              error: err.message,
                            });
                            ++errorCount;
                          }).then(() => progress()), { concurrency: 100 }))
        .then(() => {
          if (errorCount > 0) {
            this.mApi.store.dispatch(addNotification({
              type: 'error',
              title: this.mApi.translate('Deployment failed'),
              message: this.mApi.translate(
                  '{{count}} files were not correctly deployed (see log for details).\n'
                  + 'The most likely reason is that files were locked by external applications '
                  + 'so please ensure no other application has a mod file open, then repeat '
                  + 'deployment.',
                  {replace: {count: errorCount}}),
            }));
          }

          const context = this.mContext;
          this.mContext = undefined;
          context.onComplete();
          return Object.keys(context.previousDeployment)
              .map(key => context.previousDeployment[key]);
        })
        .tapCatch(() => {
          const context = this.mContext;
          this.mContext = undefined;
          context.onComplete();
        });
  }

  public cancel(gameId: string, dataPath: string, installationPath: string) {
    if (this.mContext !== undefined) {
      const context = this.mContext;
      this.mContext = undefined;
      context.onComplete();
    }
    return Promise.resolve();
  }

  public activate(sourcePath: string, sourceName: string, dataPath: string,
                  blackList: Set<string>): Promise<void> {
    return fs.statAsync(sourcePath)
      .then(() => turbowalk(sourcePath, entries => {
        if (this.mContext === undefined) {
          return;
        }
        entries.forEach(entry => {
          const relPath: string = path.relative(sourcePath, entry.filePath);
          const relPathNorm = this.mNormalize(path.join(dataPath, relPath));
          if (!entry.isDirectory && !blackList.has(relPathNorm)) {
            // mods are activated in order of ascending priority so
            // overwriting is fine here
            this.mContext.newDeployment[relPathNorm] = {
              relPath,
              source: sourceName,
              target: dataPath,
              time: entry.mtime * 1000,
            };
          }
        });
      }, { skipHidden: false }))
      .catch({ code: 'ENOENT' }, () => null);
  }

  public deactivate(sourcePath: string, dataPath: string): Promise<void> {
    return turbowalk(sourcePath, entries => {
      if (this.mContext === undefined) {
        return;
      }
      entries.forEach(entry => {
        if (!entry.isDirectory) {
          const relPath: string = path.relative(sourcePath, entry.filePath);
          delete this.mContext.newDeployment[this.mNormalize(path.join(dataPath, relPath))];
        }
      });
    });
  }

  public prePurge(): Promise<void> {
    return Promise.resolve();
  }

  public purge(installPath: string, dataPath: string): Promise<void> {
    if (!truthy(dataPath)) {
      // previously we reported an issue here, but we want the ability to have mod types
      // that don't actually deploy
      return Promise.resolve();
    }
    // purge
    return this.purgeLinks(installPath, dataPath)
      .then(() => this.postLinkPurge(dataPath, false))
      .then(() => undefined);
  }

  public postPurge(): Promise<void> {
    return Promise.resolve();
  }

  public isActive(): boolean {
    return false;
  }

  public externalChanges(gameId: string,
                         installPath: string,
                         dataPath: string,
                         activation: IDeployedFile[]): Promise<IFileChange[]> {
    const nonLinks: IFileChange[] = [];

    return Promise.map(activation, fileEntry => {
      const fileDataPath = (truthy(fileEntry.target)
        ? [dataPath, fileEntry.target, fileEntry.relPath]
        : [dataPath, fileEntry.relPath]
        ).join(path.sep);
      const fileModPath = [installPath, fileEntry.source, fileEntry.relPath].join(path.sep);
      let sourceDeleted: boolean = false;
      let destDeleted: boolean = false;
      let sourceTime: Date;
      let destTime: Date;

      return this.stat(fileModPath)
        .catch(err => {
          // can't stat source, probably the file was deleted
          sourceDeleted = true;
          return Promise.resolve(undefined);
        })
        .then(sourceStats => {
          if (sourceStats !== undefined) {
            sourceTime = sourceStats.mtime;
          }
          return this.statLink(fileDataPath);
        })
        .catch(() => {
          // can't stat destination, probably the file was deleted
          destDeleted = true;
          return Promise.resolve(undefined);
        })
        .then(destStats => {
          if (destStats !== undefined) {
            destTime = destStats.mtime;
          }
          return sourceDeleted || destDeleted
            ? Promise.resolve(false)
            : this.isLink(fileDataPath, fileModPath);
        })
        .then((isLink?: boolean) => {
          if (sourceDeleted && !destDeleted && this.canRestore()) {
            nonLinks.push({
              filePath: fileEntry.relPath,
              source: fileEntry.source,
              changeType: 'srcdeleted',
            });
          } else if (destDeleted && !sourceDeleted) {
            nonLinks.push({
              filePath: fileEntry.relPath,
              source: fileEntry.source,
              changeType: 'deleted',
            });
          } else if (!sourceDeleted && !destDeleted && !isLink) {
            nonLinks.push({
              filePath: fileEntry.relPath,
              source: fileEntry.source,
              sourceTime,
              destTime,
              changeType: 'refchange',
            });
          /* TODO not registering these atm as we have no way to "undo" anyway
          } else if (destTime.getTime() !== fileEntry.time) {
            nonLinks.push({
              filePath: fileEntry.relPath,
              source: fileEntry.source,
              changeType: 'valchange',
            });
          */
          }
          return Promise.resolve(undefined);
        });
      }, { concurrency: 200 }).then(() => Promise.resolve(nonLinks));
  }

  /**
   * create file link
   * Note: This function is expected to replace the target file if it exists
   */
  protected abstract linkFile(linkPath: string, sourcePath: string): Promise<void>;
  protected abstract unlinkFile(linkPath: string, sourcePath: string): Promise<void>;
  protected abstract purgeLinks(installPath: string, dataPath: string): Promise<void>;
  protected abstract isLink(linkPath: string, sourcePath: string): Promise<boolean>;
  /**
   * must return true if this deployment method is able to restore a file after the
   * "original" was deleted. This is essentially true for hard links (since the file
   * data isn't gone after removing the original) and false for everything else
   */
  protected abstract canRestore(): boolean;

  protected get normalize(): Normalize {
    return this.mNormalize;
  }

  protected get context(): IDeploymentContext {
    return this.mContext;
  }

  protected stat(filePath: string): Promise<fs.Stats> {
    return fs.statAsync(filePath);
  }

  protected statLink(filePath: string): Promise<fs.Stats> {
    return fs.lstatAsync(filePath);
  }

  private removeDeployedFile(installationPath: string,
                             dataPath: string,
                             key: string,
                             restoreBackup: boolean): Promise<void> {
    const outputPath = path.join(dataPath,
      this.mContext.previousDeployment[key].target || '',
      this.mContext.previousDeployment[key].relPath);
    const sourcePath = path.join(installationPath,
      this.mContext.previousDeployment[key].source,
      this.mContext.previousDeployment[key].relPath);
    return this.unlinkFile(outputPath, sourcePath)
      .catch(err => (err.code !== 'ENOENT')
        // treat an ENOENT error for the unlink as if it was a success.
        // The end result either way is the link doesn't exist now.
        ? Promise.reject(err)
        : Promise.resolve())
      .then(() => restoreBackup
        ? fs.renameAsync(outputPath + BACKUP_TAG, outputPath).catch(() => undefined)
        : Promise.resolve())
      .then(() => {
        delete this.mContext.previousDeployment[key];
      })
      .catch(err => {
        log('warn', 'failed to unlink', {
          path: this.mContext.previousDeployment[key].relPath,
          error: err.message,
        });
        // need to make sure the deployment manifest
        // reflects the actual state, otherwise we may
        // leave files orphaned
        this.mContext.newDeployment[key] =
          this.mContext.previousDeployment[key];

        return Promise.reject(err);
      });
  }

  private deployFile(key: string, installPathStr: string, dataPath: string,
                     replace: boolean): Promise<IDeployedFile> {
    const fullPath =
      [installPathStr, this.mContext.newDeployment[key].source,
        this.mContext.newDeployment[key].relPath].join(path.sep);
    const fullOutputPath =
      [dataPath, this.mContext.newDeployment[key].target || null,
        this.mContext.newDeployment[key].relPath].filter(i => i !== null).join(path.sep);

    const backupProm: Promise<void> = replace
      ? Promise.resolve()
      : this.isLink(fullOutputPath, fullPath)
        .then(link => link
          ? Promise.resolve(undefined) // don't re-create link that's already correct
          : fs.renameAsync(fullOutputPath, fullOutputPath + BACKUP_TAG))
        .catch(err => (err.code === 'ENOENT')
          // if the backup fails because there is nothing to backup, that's great,
          // that's the most common outcome. Otherwise we failed to backup an existing
          // file, so continuing could cause data loss
          ? Promise.resolve(undefined)
          : Promise.reject(err));

    return backupProm
      .then(() => this.linkFile(fullOutputPath, fullPath))
      .then(() => {
        this.mContext.previousDeployment[key] = this.mContext.newDeployment[key];
        return this.mContext.newDeployment[key];
      });
  }

  private diffActivation(before: IDeployment, after: IDeployment) {
    const keysBefore = Object.keys(before);
    const keysAfter = Object.keys(after);
    const keysBoth = _.intersection(keysBefore, keysAfter);
    return {
      added: _.difference(keysAfter, keysBefore),
      removed: _.difference(keysBefore, keysAfter),
      sourceChanged: keysBoth.filter((key: string) => before[key].source !== after[key].source),
      contentChanged: keysBoth.filter((key: string) =>
         (before[key].time !== after[key].time) && (before[key].source === after[key].source)),
    };
  }

  private postLinkPurge(baseDir: string, doRemove: boolean): Promise<boolean> {
    // recursively go through directories and remove empty ones !if! we encountered a
    // __delete_if_empty file in the hierarchy so far
    let empty = true;
    let queue = Promise.resolve();
    return turbowalk(baseDir, entries => {
      doRemove = doRemove ||
        (entries.find(entry =>
          !entry.isDirectory
          && ((path.basename(entry.filePath) === LinkingActivator.OLD_TAG_NAME)
              || (path.basename(entry.filePath) === LinkingActivator.NEW_TAG_NAME)))
         !== undefined);
      const dirs = entries.filter(entry => entry.isDirectory);
      // recurse into subdirectories
      queue = queue.then(() =>
        Promise.each(dirs, dir => this.postLinkPurge(dir.filePath, doRemove)
                                    .then(removed => {
                                      if (!removed) { empty = false; }
                                    }))
        .then(() => {
          // then check files. if there are any, this isn't empty. plus we
          // restore backups here
          const files = entries.filter(entry =>
            !entry.isDirectory
            && (path.basename(entry.filePath) !== LinkingActivator.OLD_TAG_NAME)
            && (path.basename(entry.filePath) !== LinkingActivator.NEW_TAG_NAME));
          if (files.length > 0) {
            empty = false;
            return Promise.map(
                files.filter(entry => path.extname(entry.filePath) === BACKUP_TAG),
                entry => this.restoreBackup(entry.filePath))
              .catch(UserCanceled, () => undefined)
              .then(() => undefined);
          } else {
            return Promise.resolve();
          }
        }));
    }, { recurse: false, skipHidden: false })
      .catch({ code: 'ENOTFOUND' }, err => {
        // was only able to reproduce this by removing directory manually while purge was happening
        // still, if the directory doesn't exist, there is nothing to clean up, so - job done?
        log('error', 'mod directory not found wrapping up deployment', err.message);
      })
      .then(() => queue)
      .then(() => (empty && doRemove)
        ? fs.statAsync(path.join(baseDir, LinkingActivator.NEW_TAG_NAME))
          .then(() => fs.unlinkAsync(path.join(baseDir, LinkingActivator.NEW_TAG_NAME)))
          .catch(() => fs.unlinkAsync(path.join(baseDir, LinkingActivator.OLD_TAG_NAME)))
          .catch(err =>
            err.code === 'ENOENT' ? Promise.resolve() : Promise.reject(err))
          .then(() => fs.rmdirAsync(baseDir)
            .catch(err => {
              log('error', 'failed to remove directory, it was supposed to be empty', {
                error: err.message,
                path: baseDir,
              });
            }))
          .then(() => true)
        : Promise.resolve(false));
  }

  private restoreBackup(backupPath: string) {
    const targetPath = backupPath.substr(0, backupPath.length - BACKUP_TAG.length);
    return fs.renameAsync(backupPath, targetPath)
      .catch(UserCanceled, cancelErr => {
        // TODO:
        // this dialog may show up multiple times for the same file because
        // the purge process for different mod types may come across the same directory if
        // the base directory of one is a parent of the base directory of another
        // (say .../Fallout4 and .../Fallout4/data)
        // to fix that we'd have to blacklist directories that are the base of another mod type
        // which would speed this up in general but it feels like a lot can go wrong with that
        return this.mApi.showDialog('question', 'Confirm', {
          text: 'Are you sure you want to cancel? This will leave backup files '
            + 'unrestored, you will have to clean those up manually.',
        }, [
            { label: 'Really cancel' },
            { label: 'Try again' },
          ]).then(res => (res.action === 'Really cancel')
            ? Promise.reject(cancelErr)
            : this.restoreBackup(backupPath));
      });
  }
}

export default LinkingActivator;
