import Modal from '../../../controls/Modal';
import Table from '../../../controls/Table';
import Toggle from '../../../controls/Toggle';
import { Button } from '../../../controls/TooltipControls';
import { ITableAttribute } from '../../../types/ITableAttribute';
import { ComponentEx, connect, translate } from '../../../util/ComponentEx';
import { setdefault } from '../../../util/util';

import { confirmExternalChanges, setExternalChangeAction } from '../actions/session';

import { FileAction, IFileEntry } from '../types/IFileEntry';

import * as I18next from 'i18next';
import update from 'immutability-helper';
import * as React from 'react';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';

export interface IBaseProps {
}

interface IConnectedProps {
  changes: IFileEntry[];
}

interface IActionProps {
  onChangeAction: (fileNames: string[], action: FileAction) => void;
  onClose: (changes: IFileEntry[], cancel: boolean) => void;
}

interface IPossibleAction {
  key: string;
  text: string;
  allText: string;
}

const nop = () => undefined;

const possibleActions: { [type: string]: IPossibleAction[] } = {
  refchange: [
    { key: 'import', text: 'Save change (use deployed file)', allText: 'Save all changes' },
    { key: 'drop', text: 'Revert change (use staging file)', allText: 'Revert all changes' },
    { key: 'newest', text: 'Use newer file', allText: 'Use newer file for all changes' },
  ],
  valchange: [
    { key: 'nop', text: 'Save change', allText: 'Save all changes' },
    // TODO: implement a "restore from archive" option
  ],
  deleted: [
    { key: 'delete', text: 'Save change', allText: 'Save all changes' },
    { key: 'restore', text: 'Revert change', allText: 'Revert all changes' },
  ],
  srcdeleted: [
    { key: 'drop', text: 'Save change', allText: 'Save all changes' },
    { key: 'import', text: 'Revert change', allText: 'Revert all changes' },
  ],
};

type IProps = IBaseProps & IConnectedProps & IActionProps;

interface ISourceMap {
 [source: string]: IFileEntry[];
}

function bySource(prev: ISourceMap, value: IFileEntry): ISourceMap {
  setdefault(prev, value.source, []).push(value);
  return prev;
}

interface ISourceEntry {
  id: string;
  filePaths: string[];
  action: FileAction;
  type: 'refchange' | 'valchange' | 'deleted' | 'srcdeleted';
  modTypeId: string;
}

function transform(source: string, files: IFileEntry[]): ISourceEntry {
  return {
    id: source,
    filePaths: files.map(file => file.filePath),
    action: files[0].action,
    modTypeId: files[0].modTypeId,
    type: files[0].type,
  };
}

interface IComponentState {
  showFiles: boolean;
}

class ExternalChangeDialog extends ComponentEx<IProps, IComponentState> {
  private setAll = {
    refchange: (evt: React.MouseEvent<any>) => {
      this.setAllFunc('refchange', evt.currentTarget.href.split('#')[1]);
    },
    valchange: (evt: React.MouseEvent<any>) => {
      this.setAllFunc('valchange', evt.currentTarget.href.split('#')[1]);
    },
    deleted: (evt: React.MouseEvent<any>) => {
      this.setAllFunc('deleted', evt.currentTarget.href.split('#')[1]);
    },
    srcdeleted: (evt: React.MouseEvent<any>) => {
      this.setAllFunc('srcdeleted', evt.currentTarget.href.split('#')[1]);
    },
  };

  constructor(props: IProps) {
    super(props);
    this.state = { showFiles: false };
  }

  public render(): JSX.Element {
    const { t, changes } = this.props;
    const { showFiles } = this.state;

    const refChanged = changes.filter(change => change.type === 'refchange');
    const valChanged = changes.filter(change => change.type === 'valchange');
    const deleted = changes.filter(change => change.type === 'deleted');
    const srcDeleted = changes.filter(change => change.type === 'srcdeleted');

    const renderFunc = showFiles ? this.renderFiles : this.renderSources;
    return (
      <Modal id='ext-change-dialog' show={changes.length > 0} onHide={nop}>
        <Modal.Header>
          <Modal.Title>{t('External Changes')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className='padded-text' style={{ flex: 0 }} >
              {t('Mod files were changed outside Vortex. '
                + 'You can undo these changes now or apply them permanently.')}
            </div>
            {renderFunc(refChanged, valChanged, deleted, srcDeleted)}
          </div>
          <Toggle checked={showFiles} onToggle={this.toggleShowFiles}>
            {t('Show individual files')}
          </Toggle>
        </Modal.Body>
        <Modal.Footer>
          <Button
            id='btn-cancel-activation'
            tooltip={t('Cancel deployment')}
            onClick={this.cancel}
          >
            {t('Cancel')}
          </Button>
          <Button
            id='btn-confirm-activation'
            tooltip={t('Confirm changes')}
            onClick={this.confirm}
          >
            {t('Confirm')}
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private renderSources = (refChanged: IFileEntry[], valChanged: IFileEntry[],
                           deleted: IFileEntry[], srcDeleted: IFileEntry[]): JSX.Element => {
    const { t } = this.props;

    const rcmap = refChanged.reduce(bySource, {});
    const vcmap = valChanged.reduce(bySource, {});
    const dmap = deleted.reduce(bySource, {});
    const sdmap = srcDeleted.reduce(bySource, {});

    const rc = Object.keys(rcmap).map(source => transform(source, rcmap[source]));
    const vc = Object.keys(vcmap).map(source => transform(source, vcmap[source]));
    const d = Object.keys(dmap).map(source => transform(source, dmap[source]));
    const sd = Object.keys(sdmap).map(source => transform(source, sdmap[source]));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* this.renderChangedSources(t('These mods were modified'), 'valchange', vc) */}
        {this.renderChangedSources(t('File content modified '
                    + '("Save" will apply the changed file from the game directory permanently, '
                    + '"Revert" will restore the original file from the mod directory)'),
          'refchange', rc)}
        {this.renderChangedSources(t('Source files were deleted '
          + '("Save" will remove the files permanenly, "Revert" will restore them)'),
          'srcdeleted', sd)}
        {this.renderChangedSources(t('Links were deleted '
          + '("Save" will remove the files permanently, "Revert" will restore them)'),
          'deleted', d)}
      </div>
    );
  }

  private renderFiles = (refChanged: IFileEntry[], valChanged: IFileEntry[],
                         deleted: IFileEntry[], srcDeleted: IFileEntry[]): JSX.Element => {
    const { t, changes } = this.props;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* this.renderChangedFile(t('These files were modified'), 'valchange', valChanged) */}
        {this.renderChangedFile(t('File content modified'
                    + '("Save" will apply the changed file from the game directory permanently, '
                    + '"Revert" will restore the original file from the mod directory)'),
          'refchange', refChanged)}
        {this.renderChangedFile(t('Source files were deleted'
          + '("Save" will remove the files permanenly, "Revert" will restore them)'),
          'srcdeleted', srcDeleted)}
        {this.renderChangedFile(t('Links were deleted'
          + '("Save" will remove the files permanently, "Revert" will restore them)'),
          'deleted', deleted)}
      </div>
    );
  }

  private renderChangedSources = (text: string, type: string, entries: ISourceEntry[]) => {
    const { t } = this.props;
    if (entries.length === 0) {
      return null;
    }

    const columns = this.genSourceColumns(type);

    const actions = possibleActions[type];

    return (
      <div style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column' }}>
        {text}
        <p>{actions.map(action => (
          <a
            key={action.key}
            onClick={this.setAll[type]}
            href={'#' + action.key}
            style={{ marginRight: 10 }}
          >{t(action.allText)}
          </a>
        ))
        }</p>
        <div style={{ overflowY: 'auto', flex: '1 1 0' }}>
          <Table
            tableId={`external-change-${type}`}
            data={entries}
            actions={[]}
            staticElements={columns}
            showHeader={false}
            showDetails={false}
          />
        </div>
      </div>
    );
  }

  private renderChangedFile = (text: string, type: string, entries: IFileEntry[]) => {
    const { t } = this.props;
    if (entries.length === 0) {
      return null;
    }

    const columns = this.genColumns(type);

    const actions = possibleActions[type];

    return (
      <div style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column' }}>
        {text}
        <p>{actions.map(action => (
          <a
            key={action.key}
            onClick={this.setAll[type]}
            href={'#' + action.key}
            style={{ marginRight: 10 }}
          >{t(action.allText)}
          </a>
        ))
        }</p>
        <div style={{ overflowY: 'auto', flex: '1 1 0' }}>
          <Table
            tableId={`external-change-${type}`}
            data={entries}
            actions={[]}
            staticElements={columns}
            showDetails={false}
          />
        </div>
      </div>
    );
  }

  private genSourceColumns(type: string): ITableAttribute[] {
    const { onChangeAction } = this.props;

    return [
      {
        id: 'name',
        name: 'Mod Name',
        description: 'Mod Name',
        calc: (source: ISourceEntry) => source.id,
        placement: 'table',
        edit: {},
      }, {
        id: 'file_count',
        name: 'File Count',
        description: 'Number of files in this mod that were changed',
        calc: (source: ISourceEntry, t: I18next.TranslationFunction) =>
          t('{{count}} file', {
            count: source.filePaths !== undefined ? source.filePaths.length : 0 }),
        placement: 'table',
        edit: {},
      }, {
        id: 'action',
        name: 'Action',
        description: 'the action to take on files in this mod',
        calc: (source: ISourceEntry) => {
          const action = possibleActions[type].find(act => act.key === source.action);
          if (action === undefined) {
            this.context.api.showErrorNotification('Invalid action', {
              type,
              action: source.action,
            });
            return 'INVALID!';
          }
          return action.text;
        },
        placement: 'table',
        edit: {
          inline: true,
          actions: false,
          choices: () => possibleActions[type],
          onChangeValue: (source: ISourceEntry, value: any) => {
            let newAction = value;
            if (value === undefined) {
              const typeActions = possibleActions[type];
              const idx = typeActions.findIndex(act => act.key === source.action);

              newAction = typeActions[(idx + 1) % typeActions.length].key as FileAction;
            }
            // TODO: the way source is created, filePaths should never be undefined and
            //   I wasn't able to reproduce a case where it was, but we did get a crash
            //   report where it was.
            if (source.filePaths !== undefined) {
              source.filePaths.forEach(filePath => onChangeAction([filePath], newAction));
            }
          },
        },
      },
    ];
  }

  private genColumns(type: string): ITableAttribute[] {
    const { onChangeAction } = this.props;

    return [
      {
        id: 'name',
        name: 'File Name',
        description: 'file name',
        calc: (file: IFileEntry) => file.filePath,
        placement: 'table',
        edit: {},
      }, {
        id: 'staged_changed',
        name: 'Staged file modified',
        description: 'Last time the stage file (the one in the mod staging folder) was modified',
        calc: (file: IFileEntry, t) => (file.sourceModified !== undefined) ? file.sourceModified.toLocaleString() : '',
        placement: 'table',
        edit: {},
      }, {
        id: 'deployment_changed',
        name: 'Deployed file modified',
        description: 'Last time the deployed file (the one in the game folder) was modified',
        calc: (file: IFileEntry) => (file.destModified !== undefined) ? file.destModified.toLocaleString() : '',
        placement: 'table',
        edit: {},
      }, {
        id: 'action',
        name: 'Action',
        description: 'the action to take on the file',
        calc: (file: IFileEntry) => {
          const action = possibleActions[type].find(act => act.key === file.action);
          if (action === undefined) {
            this.context.api.showErrorNotification('Invalid action', {
              type,
              action: file.action,
            });
            return 'INVALID!';
          }

          return action.text;
        },
        placement: 'table',
        edit: {
          inline: true,
          actions: false,
          choices: () => possibleActions[type],
          onChangeValue: (file: IFileEntry, value: any) => {
            if (value === undefined) {
              const typeActions = possibleActions[type];
              const idx = typeActions.findIndex(act => act.key === file.action);
              onChangeAction([file.filePath],
                             typeActions[(idx + 1) % typeActions.length].key as FileAction);
            } else {
              onChangeAction([file.filePath], value);
            }
          },
        },
      },
    ];
  }

  private toggleShowFiles = () => {
    this.setState(update(this.state, { showFiles: { $set: !this.state.showFiles } }));
  }

  private setAllFunc = (changeType: string, action: FileAction) => {
    const { changes, onChangeAction } = this.props;
    onChangeAction(
      changes
        .filter((entry) => entry.type as string === changeType)
        .map((entry) => entry.filePath),
      action,
    );
  }

  private cancel = () => {
    this.props.onClose([], true);
  }

  private confirm = () => {
    this.props.onClose(this.props.changes, false);
  }
}

function mapStateToProps(state: any): IConnectedProps {
  return {
    changes: state.session.mods.changes,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onChangeAction: (fileName: string[], action: FileAction) =>
      dispatch(setExternalChangeAction(fileName, action)),
    onClose: (changes: IFileEntry[], cancel: boolean) =>
      dispatch(confirmExternalChanges(changes, cancel)),
  };
}

export default translate(['common'], { wait: false })(
  connect(mapStateToProps, mapDispatchToProps)(ExternalChangeDialog),
) as React.ComponentClass<IBaseProps>;
