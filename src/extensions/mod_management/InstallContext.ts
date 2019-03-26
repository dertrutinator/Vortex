import { addNotification, dismissNotification, updateNotification } from '../../actions/notifications';
import { IExtensionApi } from '../../types/IExtensionContext';
import { INotification } from '../../types/INotification';
import { IState } from '../../types/IState';
import { log } from '../../util/log';
import { showError } from '../../util/message';
import { getSafe } from '../../util/storeHelper';

import { setDownloadInstalled } from '../download_management/actions/state';
import { setModEnabled } from '../profile_management/actions/profiles';

import {
  addMod,
  removeMod,
  setModInstallationPath,
  setModState,
  setModType,
  setModAttributes,
} from './actions/mods';
import { IMod, ModState } from './types/IMod';

import { IInstallContext, InstallOutcome } from './types/IInstallContext';

import * as Promise from 'bluebird';
import * as path from 'path';

class InstallContext implements IInstallContext {
  private mAddMod: (mod: IMod) => void;
  private mRemoveMod: (modId: string) => void;
  private mAddNotification: (notification: INotification) => void;
  private mUpdateNotification: (id: string, progress: number, message: string) => void;
  private mDismissNotification: (id: string) => void;
  private mShowError: (message: string, details?: any, allowReport?: boolean,
                       replace?: { [key: string]: string }) => void;
  private mSetModState: (id: string, state: ModState) => void;
  private mSetModAttributes: (id: string, attributes: { [key: string]: any }) => void;
  private mSetModInstallationPath: (id: string, installPath: string) => void;
  private mSetModType: (id: string, modType: string) => void;
  private mEnableMod: (modId: string) => void;
  private mSetDownloadInstalled: (archiveId: string, gameId: string, modId: string) => void;

  private mAddedId: string;
  private mIndicatorId: string;
  private mGameId: string;
  private mArchiveId: string;
  private mInstallOutcome: InstallOutcome;
  private mFailReason: string;
  private mIsEnabled: (modId: string) => boolean;
  private mIsDownload: (archiveId: string) => boolean;
  private mLastProgress: number = 0;

  constructor(gameMode: string, api: IExtensionApi) {
    const store = api.store;
    const dispatch = store.dispatch;
    this.mAddMod = (mod) => dispatch(addMod(gameMode, mod));
    this.mRemoveMod = (modId) => dispatch(removeMod(gameMode, modId));
    this.mAddNotification = (notification) =>
      dispatch(addNotification(notification));
    this.mUpdateNotification = (id: string, progress: number, message: string) =>
      dispatch(updateNotification(id, progress, message));
    this.mDismissNotification = (id) =>
      dispatch(dismissNotification(id));
    this.mShowError = (message, details?, allowReport?, replace?) =>
      showError(dispatch, message, details, { allowReport, replace });
    this.mSetModState = (id, state) =>
      dispatch(setModState(gameMode, id, state));
    this.mSetModAttributes = (id, attributes) => {
      Object.keys(attributes).forEach(id => {
        if (attributes[id] === undefined) {
          delete attributes[id];
        }
      });
      if (Object.keys(attributes).length > 0) {
        dispatch(setModAttributes(gameMode, id, attributes));
      }
    }
    this.mSetModInstallationPath = (id, installPath) =>
      dispatch(setModInstallationPath(gameMode, id, installPath));
    this.mSetModType = (id, modType) =>
      dispatch(setModType(gameMode, id, modType));
    this.mEnableMod = (modId) => {
      const state: IState = store.getState();
      const profileId = state.settings.profiles.lastActiveProfile[this.mGameId];
      dispatch(setModEnabled(profileId, modId, true));
      api.events.emit('mods-enabled', [ modId ], true, this.mGameId);
    };
    this.mIsEnabled = (modId) => {
      const state: IState = store.getState();

      const profileId = state.settings.profiles.lastActiveProfile[this.mGameId];
      const profile = state.persistent.profiles[profileId];
      return getSafe(profile, ['modState', modId, 'enabled'], false);
    };
    this.mSetDownloadInstalled = (archiveId, gameId, modId) => {
      dispatch(setDownloadInstalled(archiveId, gameId, modId));
    };
    this.mIsDownload = (archiveId) => {
      const state: IState = store.getState();
      return (archiveId !== null) && getSafe(state, ['persistent', 'downloads', 'files', archiveId], undefined) !== undefined;
    }
  }

  public startIndicator(id: string): void {
    log('info', 'start mod install', { id });
    this.mLastProgress = 0;
    this.mAddNotification({
      id: 'install_' + id,
      title: 'Installing {{ id }}',
      message: 'Preparing',
      replace: { id },
      type: 'activity',
    });
    this.mIndicatorId = id;
    this.mInstallOutcome = undefined;
  }

  public stopIndicator(): void {
    if (this.mIndicatorId === undefined) {
      return;
    }

    this.mDismissNotification('install_' + this.mIndicatorId);

    Promise.delay(500)
    .then(() => {
      this.mAddNotification(
        this.outcomeNotification(
          this.mInstallOutcome, this.mIndicatorId, this.mIsEnabled(this.mAddedId)));
    });
  }

  public setProgress(percent?: number) {
    if ((percent - this.mLastProgress) >= 2) {
      this.mLastProgress = percent;
      this.mUpdateNotification(
        'install_' + this.mIndicatorId,
        percent,
        percent !== undefined ? 'Extracting' : 'Installing',
      );
    }
  }

  public startInstallCB(id: string, gameId: string, archiveId: string): void {
    this.mAddMod({
      id,
      type: '',
      archiveId,
      installationPath: id,
      state: 'installing',
      attributes: {
        name: id,
        installTime: new Date(),
      },
    });
    this.mAddedId = id;
    this.mGameId = gameId;
    this.mArchiveId = archiveId;
  }

  public finishInstallCB(outcome: InstallOutcome, info?: any, reason?: string): void {
    log('info', 'finish mod install', {
      id: this.mIndicatorId,
      outcome: this.mInstallOutcome,
    });
    if (outcome === 'success') {
      this.mSetModState(this.mAddedId, 'installed');

      this.mSetModAttributes(this.mAddedId, {
        installTime: new Date(),
        category: info.category,
        version: info.version,
        fileId: info.fileId,
        newestFileId: info.fileId,
        changelog: info.changelog,
        endorsed: undefined,
        bugMessage: '',
        ...info,
      });

      if (this.mIsDownload(this.mArchiveId)) {
        this.mSetDownloadInstalled(this.mArchiveId, this.mGameId, this.mAddedId);
      }
    } else {
      this.mFailReason = reason;
      if (this.mAddedId !== undefined) {
        this.mRemoveMod(this.mAddedId);
      }
    }
    this.mInstallOutcome = outcome;
  }

  public setInstallPathCB(id: string, installPath: string) {
    const fileName = path.basename(installPath);
    log('info', 'using install path', { id, installPath, fileName });
    this.mSetModInstallationPath(id, fileName);
  }

  public setModType(id: string, modType: string) {
    log('info', 'determined mod type', { id, modType });
    this.mSetModType(id, modType);
  }

  public reportError(message: string, details?: string | Error, allowReport?: boolean,
                     replace?: { [key: string]: string }): void {
    log('error', 'install error', { message, details, replace });
    this.mShowError(message, details, allowReport, replace);
  }

  public progressCB(percent: number, file: string): void {
    log('debug', 'install progress', { percent, file });
  }

  private outcomeNotification(outcome: InstallOutcome, id: string,
                              isEnabled: boolean): INotification {
    switch (outcome) {
      case 'success':
        return {
          id: `may-enable-${id}`,
          type: 'success',
          message: '{{id}} installed',
          replace: { id },
          group: 'mod-installed',
          displayMS: isEnabled ? 4000 : undefined,
          actions: isEnabled ? [] : [
            {
              title: 'Enable',
              action: dismiss => {
                this.mEnableMod(this.mAddedId);
                dismiss();
              },
            },
          ],
        };
      case 'canceled': return {
        type: 'info',
        title: 'Installation canceled',
        message: this.mFailReason,
        replace: { id },
        displayMS: 4000,
        localize: { message: false },
      };
      default: return {
        type: 'error',
        title: '{{id}} failed to install',
        message: this.mFailReason,
        replace: { id },
        localize: { message: false },
      };
    }
  }
}

export default InstallContext;
