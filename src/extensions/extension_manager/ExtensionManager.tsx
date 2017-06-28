import { setExtensionEnabled } from '../../actions/app';
import { IExtensionState, IState } from '../../types/IState';
import { ITableAttribute } from '../../types/ITableAttribute';
import { ComponentEx, connect, translate } from '../../util/ComponentEx';
import { getSafe } from '../../util/storeHelper';
import { spawnSelf } from '../../util/util';
import MainPage from '../../views/MainPage';
import Table, { ITableRowAction } from '../../views/Table';

import getTableAttributes from './tableAttributes';
import { IExtension, IExtensionWithState } from './types';

import * as Promise from 'bluebird';
import { remote } from 'electron';
import * as fs from 'fs-extra-promise';
import * as _ from 'lodash';
import * as path from 'path';
import * as React from 'react';
import { Alert, Button } from 'react-bootstrap';
import * as Redux from 'redux';

interface IConnectedProps {
  extensionConfig: { [extId: string]: IExtensionState };
}

interface IActionProps {
  onSetExtensionEnabled: (extId: string, enabled: boolean) => void;
}

type IProps = IConnectedProps & IActionProps;

interface IComponentState {
  extensions: { [extId: string]: IExtension };
  oldExtensionConfig: { [extId: string]: IExtensionState };
}

function getAllDirectories(searchPath: string): Promise<string[]> {
  return fs.readdirAsync(searchPath)
    .filter<string>(fileName =>
      fs.statAsync(path.join(searchPath, fileName))
        .then(stat => stat.isDirectory()));
}

function applyExtensionInfo(id: string, bundled: boolean, values: any): IExtension {
  return {
    name: values.name || id,
    author: values.author || 'Unknown',
    version: values.version || '0.0.0',
    description: values.description || 'Missing',
    bundled,
  };
}

function readExtensionInfo(extensionPath: string,
                           bundled: boolean): Promise<{ id: string, info: IExtension }> {
  const id = path.basename(extensionPath);
  return fs.readFileAsync(path.join(extensionPath, 'info.json'))
    .then(info => ({
      id, info: applyExtensionInfo(id, bundled, JSON.parse(info.toString())),
    }))
    .catch(err => ({
      id, info: applyExtensionInfo(id, bundled, {}),
    }));
}

class ExtensionManager extends ComponentEx<IProps, IComponentState> {
  private staticColumns: ITableAttribute[];
  private actions: ITableRowAction[];

  constructor(props: IProps) {
    super(props);
    this.initState({
      extensions: {},
      oldExtensionConfig: props.extensionConfig,
    });

    this.actions = [
      {
        icon: 'remove',
        title: 'Remove',
        action: this.removeExtension,
        condition: (instanceId: string) => !this.state.extensions[instanceId].bundled,
        singleRowAction: true,
      },
    ];

    this.staticColumns = getTableAttributes({
      onSetExtensionEnabled:
        (extId: string, enabled: boolean) => this.props.onSetExtensionEnabled(extId, enabled),
      onToggleExtensionEnabled:
        (extId: string) => {
          const { extensionConfig, onSetExtensionEnabled } = this.props;
          onSetExtensionEnabled(extId, !getSafe(extensionConfig, [extId, 'enabled'], true));
        },
    });
  }

  public componentDidMount() {
    this.readExtensions();
  }

  public render(): JSX.Element {
    const {t, extensionConfig} = this.props;
    const {extensions, oldExtensionConfig} = this.state;

    const extensionsWithState = this.mergeExt(extensions, extensionConfig);

    return (
      <MainPage>
        <MainPage.Body>
          {!_.isEqual(extensionConfig, oldExtensionConfig) ? this.renderReload() : null}
          <Table
            tableId='extensions'
            data={extensionsWithState}
            actions={this.actions}
            staticElements={this.staticColumns}
            multiSelect={false}
          />
        </MainPage.Body>
      </MainPage>
    );
  }

  private renderReload(): JSX.Element {
    const {t} = this.props;
    return (
      <Alert bsStyle='warning' style={{ display: 'flex' }}>
        <p style={{ flexGrow: 1 }}>{t('You need to restart Vortex to apply changes.')}</p>
        <Button onClick={this.restart}>{t('Restart')}</Button>
      </Alert>
    );
  }

  private restart = () => {
    spawnSelf(['--wait']);
    remote.app.exit(0);
  }

  private mergeExt(extensions: { [id: string]: IExtension },
                   extensionConfig: { [id: string]: IExtensionState })
                   : { [id: string]: IExtensionWithState } {
    return Object.keys(extensions).reduce((prev, id) => {
      prev[id] = {
        ...extensions[id],
        enabled: getSafe(extensionConfig, [id, 'enabled'], true),
      };
      return prev;
    }, {});
  }

  private removeExtension = (extId: string) => {
    // TODO: placeholder
    console.log('remove extension\n', extId);
  }

  private readExtensions() {
    const bundledPath = path.resolve(__dirname, '..', '..', 'bundledPlugins');
    const extensionsPath = path.join(remote.app.getPath('userData'), 'plugins');
    const extensions: { [extId: string]: IExtension } = {};

    let bundledExtensions;
    let dynamicExtensions;

    getAllDirectories(bundledPath)
      .map((extPath: string) => path.join(bundledPath, extPath))
      .map((fullPath: string) => readExtensionInfo(fullPath, true))
      .then(extensionInfo => {
        bundledExtensions = extensionInfo;
        return getAllDirectories(extensionsPath);
      })
      .map((extPath: string) => path.join(extensionsPath, extPath))
      .map((fullPath: string) => readExtensionInfo(fullPath, false))
      .then(extensionInfo => {
        dynamicExtensions = extensionInfo;
      })
      .then(() => {
        this.nextState.extensions = [].concat(bundledExtensions, dynamicExtensions)
          .reduce((prev, value) => {
            prev[value.id] = value.info;
            return prev;
          }, {});
      });
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    extensionConfig: state.app.extensions || {},
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onSetExtensionEnabled: (extId: string, enabled: boolean) =>
      dispatch(setExtensionEnabled(extId, enabled)),
  };
}

export default
  translate(['common'], { wait: false })(
    connect(mapStateToProps, mapDispatchToProps)(
      ExtensionManager)) as React.ComponentClass<{}>;