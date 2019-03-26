import { IErrorOptions, IExtensionApi } from '../types/api';
import { IError } from '../types/IError';

import { UserCanceled } from './CustomErrors';
import { genHash } from './genHash';
import { log } from './log';
import { getSafe } from './storeHelper';
import { getAllPropertyNames, spawnSelf, truthy } from './util';

import * as Promise from 'bluebird';
import {
  app as appIn,
  dialog as dialogIn,
  remote,
} from 'electron';
import * as fs from 'fs-extra-promise';
import { getFixedT } from 'i18next';
import NexusT, { IFeedbackResponse } from 'nexus-api';
import { } from 'opn';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { inspect } from 'util';
import {} from 'uuid';

// tslint:disable-next-line:no-var-requires
const opn = require('opn');

function createTitle(type: string, error: IError, hash: string) {
  return `${type}: ${error.message}`;
}

interface IErrorContext {
  [id: string]: string,
}

const context: IErrorContext = {};

function createReport(type: string, error: IError, context: IErrorContext,
                      version: string, reporterProcess: string, sourceProcess: string) {
  let proc: string = reporterProcess || 'unknown';
  if (sourceProcess !== undefined) {
    proc = `${sourceProcess} -> ${proc}`;
  }
  const sections = [
    `#### System
| | |
|------------ | -------------|
|Platform | ${process.platform} ${os.release()} |
|Architecture | ${process.arch} |
|Application Version | ${version} |
|Process | ${proc} |`,
    `#### Message
${error.message}`,
  ];

  if (error.details) {
    sections.push(`#### Details
\`\`\`
${error.details}
\`\`\``);
  }

  if (Object.keys(context).length > 0) {
    sections.push(`#### Context
\`\`\`
${Object.keys(context).map(key => `${key} = ${context[key]}`)}
\`\`\``)
  }

  if (error.path) {
    sections.push(`#### Path
\`\`\`
${error.path}
\`\`\``);
  }

  if (error.stack) {
    sections.push(`#### Stack
\`\`\`
${error.stack}
\`\`\``);
  }

  return `### Application ${type}\n` + sections.join('\n');
}

export function createErrorReport(type: string, error: IError, context: IErrorContext,
                                  labels: string[], state: any, sourceProcess?: string) {
  const app = appIn || remote.app;
  const reportPath = path.join(app.getPath('userData'), 'crashinfo.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    type, error, labels: labels || [], context,
    reporterId: getSafe(state, ['confidential', 'account', 'nexus', 'APIKey'], undefined),
    reportProcess: process.type, sourceProcess,
  }));
  spawnSelf(['--report', reportPath]);
}

function nexusReport(hash: string, type: string, error: IError, labels: string[],
                     context: IErrorContext, apiKey: string, reporterProcess: string,
                     sourceProcess: string): Promise<IFeedbackResponse> {
  const app = appIn || remote.app;
  const Nexus: typeof NexusT = require('nexus-api').default;

  const referenceId = require('uuid').v4();
  return Promise.resolve(Nexus.create(apiKey, 'Vortex', app.getVersion(), undefined))
    .then(nexus => nexus.sendFeedback(
      createTitle(type, error, hash),
      createReport(type, error, context, app.getVersion(), reporterProcess, sourceProcess),
      undefined,
      apiKey === undefined,
      hash,
      referenceId))
    .tap(() =>
      opn(`https://www.nexusmods.com/crash-report/?key=${referenceId}`).catch(() => null))
    .catch(err => {
      log('error', 'failed to report error to nexus', err.message);
      return undefined;
    });
}

let fallbackAPIKey: string;
let outdated: boolean = false;
let errorIgnored: boolean = false;

export function setApiKey(key: string) {
  fallbackAPIKey = key;
}

export function setOutdated(api: IExtensionApi) {
  if (process.env.NODE_ENV === 'development') {
    return;
  }
  const state = api.store.getState();
  const app = appIn || remote.app;
  const version = app.getVersion();
  if (state.persistent.nexus.newestVersion !== undefined) {
    try {
      outdated = semver.lt(version, state.persistent.nexus.newestVersion);
    } catch (err) {
      // not really a big issue
      log('warn', 'failed to update outdated status', { message: err.message });
    }
  }
  api.onStateChange(['persistent', 'nexus', 'newestVersion'], (prev, next) => {
    outdated = semver.lt(version, next);
  });
}

export function isOutdated(): boolean {
  return outdated;
}

export function didIgnoreError(): boolean {
  return errorIgnored;
}

export function sendReportFile(fileName: string): Promise<IFeedbackResponse> {
  return fs.readFileAsync(fileName)
    .then(reportData => {
      const {type, error, labels, reporterId, reportProcess, sourceProcess} =
        JSON.parse(reportData.toString());
      return sendReport(type, error, labels, reporterId, reportProcess, sourceProcess);
  });
}

export function sendReport(type: string, error: IError, context: IErrorContext,
                           labels: string[],
                           reporterId?: string, reporterProcess?: string,
                           sourceProcess?: string): Promise<IFeedbackResponse> {
  const hash = genHash(error);
  if (process.env.NODE_ENV === 'development') {
    const dialog = dialogIn || remote.dialog;
    dialog.showErrorBox(error.message, JSON.stringify({
      type, error, labels, context, reporterId, reporterProcess, sourceProcess,
    }));
    return Promise.resolve(undefined);
  } else {
    return nexusReport(hash, type, error, labels, context, reporterId || fallbackAPIKey,
                       reporterProcess, sourceProcess);
  }
}

let defaultWindow: Electron.BrowserWindow = null;

export function setWindow(window: Electron.BrowserWindow) {
  defaultWindow = window;
}

/**
 * display an error message and quit the application
 * on confirmation.
 * Use this whenever the application state is unknown and thus
 * continuing could lead to data loss
 *
 * @export
 * @param {ITermination} error
 */
export function terminate(error: IError, state: any, allowReport?: boolean, source?: string) {
  const app = appIn || remote.app;
  const dialog = dialogIn || remote.dialog;
  let win = remote !== undefined ? remote.getCurrentWindow() : defaultWindow;
  if (truthy(win) && !win.isVisible()) {
    win = null;
  }

  const contextNow = { ...context };

  log('error', 'unrecoverable error', { error, process: process.type });

  try {
    let detail = (error.stack || '');
    if (error.path) {
      detail = 'File: ' + error.path + '\n' + detail;
    }
    if (error.details) {
      detail = error.details + '\n' + detail;
    }
    const buttons = ['Ignore', 'Quit'];
    if ((allowReport !== false) && !outdated && !errorIgnored) {
      buttons.push('Report and Quit');
    }
    let action = dialog.showMessageBox(win, {
      type: 'error',
      buttons,
      defaultId: buttons.length - 1,
      title: 'An unrecoverable error occurred',
      message: error.message,
      detail,
      noLink: true,
    });

    if (action === 2) {
      // Report
      createErrorReport('Crash', error, contextNow, ['bug', 'crash'], state, source);
    } else if (action === 0) {
      // Ignore
      action = dialog.showMessageBox(win, {
        type: 'error',
        buttons: ['Quit', 'I won\'t whine'],
        title: 'Are you sure?',
        message: 'This error was unhandled and so there is ' +
                 'no way to know what subsequent errors this ' +
                 'may cause. You may lose data!\n' +
                 'We ask that you refrain from reporting issues ' +
                 'that happen from here on out in this session.',
        noLink: true,
      });
      if (action === 1) {
        errorIgnored = true;
        return;
      }
    }
    if (error.extension !== undefined) {
      action = dialog.showMessageBox(win, {
        type: 'error',
        buttons: ['Disable', 'Keep'],
        title: 'Extension crashed',
        message: `This crash was caused by an extension (${error.extension}). ` +
                 'Do you want to disable this extension?',
        noLink: true,
      });
      if (action === 0) {
        // can't access the store at this point because we won't be waiting for the store
        // to be persisted
        fs.writeFileSync(path.join(app.getPath('temp'), '__disable_' + error.extension), '');
      }
    }
  } catch (err) {
    // if the crash occurs before the application is ready, the dialog module can't be
    // used (except for this function)
    dialog.showErrorBox('An unrecoverable error occurred',
      error.message + '\n' + error.details +
      '\nIf you think this is a bug, please report it to the ' +
      'issue tracker (github)');
  }

  app.exit(1);
  throw new UserCanceled();
}

/**
 * render error message for internal processing (issue tracker and such).
 * It's important this doesn't translate the error message or lose information
 */
export function toError(input: any, options?: IErrorOptions): IError {
  let ten = getFixedT('en');
  try {
    ten('dummy');
  } catch (err) {
    // can't actually be sure if i18next is initialized - especially if this is the
    // main process. We could use require('i18next').isInitialized but no clue if
    // that's reliable.
    ten = tinput => tinput;
  }

  const t = (text: string) => ten(text, { replace: (options || {}).replace });

  if (input instanceof Error) {
    return { message: t(input.message), stack: input.stack };
  }

  switch (typeof input) {
    case 'object': {
      // object, but not an Error
      let message: string;
      let stack: string;
      if (!truthy(input) || (getAllPropertyNames(input).length === 0)) {
        // this is bad...
        message = `An empty error message was thrown: "${inspect(input)}"`;
      } else if ((input.error !== undefined) && (input.error instanceof Error)) {
        message = input.error.message;
        stack = input.error.stack;
      } else {
        message = input.message;
        if (input.message === undefined) {
          if (input.error !== undefined) {
            // not sure what this is but need to ensure not to drop any information
            message = inspect(input.error);
          } else if (Object.keys(input).length > 0) {
            // wtf is this???
            message = inspect(input);
          } else {
            message = 'An error occurred';
          }
        }
        stack = input.stack;
      }

      let attributes = Object.keys(input || {})
          .filter(key => key[0].toUpperCase() === key[0]);
      // if there are upper case characters, this is a custom, not properly typed, error object
      // with upper case attributes, intended to be displayed to the user.
      // Otherwise, who knows what this is, just send everything.
      if (attributes.length === 0) {
        attributes = getAllPropertyNames(input || {})
          .filter(key => ['message', 'error', 'stack'].indexOf(key) === -1);
      }

      const details = attributes.length === 0 ? undefined : attributes
          .map(key => key + ':\t' + input[key])
          .join('\n');

      return {message, stack, details};
    }
    case 'string': {
      return { message: 'String exception: ' + t(input) };
    }
    default: {
      return { message: 'Unknown exception: ' + inspect(input) };
    }
  }
}

export function withContext(id: string, value: string, fun: () => Promise<any>) {
  context[id] = value;
  return fun().finally(() => {
    delete context[id];
  });
}

export function getErrorContext(): IErrorContext {
  return { ...context };
}
