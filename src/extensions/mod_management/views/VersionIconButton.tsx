import { IconButton } from '../../../controls/TooltipControls';
import { ComponentEx } from '../../../util/ComponentEx';
import { getSafe } from '../../../util/storeHelper';

import { IDownload } from '../../download_management/types/IDownload';

import { IModWithState } from '../types/IModProps';
import { UpdateState } from '../util/modUpdateState';

import * as I18next from 'i18next';
import * as React from 'react';

export interface IBaseProps {
  t: I18next.TranslationFunction;
  gameMode: string;
  mod: IModWithState;
  state: UpdateState;
  downloads: { [archiveId: string]: IDownload };
  mods: { [modId: string]: any };
  downloadPath: string;
}

type IProps = IBaseProps;

/**
 * VersionIcon Button
 *
 * @class VersionIconButton
 */
class VersionIconButton extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { mod, state } = this.props;

    const tooltip = this.getStateTooltip(state);
    const icon = this.getStateIcon(state);

    if (icon === undefined) {
      return null;
    }

    return (
      <IconButton
        className='btn-embed'
        id={`btn-version-${mod.id}`}
        tooltip={tooltip}
        icon={icon}
        onClick={this.trigger}
      />
    );
  }

  private getStateTooltip(state: UpdateState) {
    const { t, mod } = this.props;

    const newVersion = getSafe(mod.attributes, ['newestVersion'], '?');

    switch (state) {
      case 'bug-update':
        return t('Mod should be updated because the installed version is bugged');
      case 'bug-disable':
        return t('Mod should be disabled or downgraded because this version has been '
          + 'marked as "bugged" by the author');
      case 'update': return t('Mod can be updated (Current version: {{newVersion}})', {
        replace: { newVersion },
      });
      case 'update-site':
        return t('Mod can be updated (but you will have to pick the file yourself)');
      case 'install':
        return t('The newest file is already downloaded.');
      default: return undefined;
    }
  }

  private getStateIcon(state: UpdateState) {
    switch (state) {
      case 'bug-update': return 'bug';
      case 'bug-disable': return 'ban';
      case 'update': return 'auto-update';
      case 'update-site': return 'open-in-browser';
      default: return undefined;
    }
  }

  private trigger = () => {
    const { gameMode, mod, state } = this.props;
    const newestFileId = getSafe(mod.attributes, ['newestFileId'], undefined);
    const downloadGame = getSafe(mod.attributes, ['downloadGame'], gameMode);

    if ((state === 'update') || (state === 'bug-update')) {
      this.context.api.events.emit('mod-update',
        downloadGame, getSafe(mod.attributes, ['modId'], undefined), newestFileId);
    } else if ((state === 'update-site') || (state === 'bug-update-site')) {
      this.context.api.events.emit('open-mod-page',
        downloadGame, getSafe(mod.attributes, ['modId'], undefined));
    }
  }
}

export default VersionIconButton as React.ComponentClass<IBaseProps>;
