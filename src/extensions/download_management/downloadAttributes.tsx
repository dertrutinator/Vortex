import ProgressBar from '../../controls/ProgressBar';
import DateTimeFilter from '../../controls/table/DateTimeFilter';
import GameFilter from '../../controls/table/GameFilter';
import TextFilter from '../../controls/table/TextFilter';

import { IExtensionApi } from '../../types/IExtensionContext';
import { ITableAttribute } from '../../types/ITableAttribute';
import * as fs from '../../util/fs';
import { getCurrentLanguage } from '../../util/i18n';
import { getSafe } from '../../util/storeHelper';
import { bytesToString, truthy } from '../../util/util';

import { gameName } from '../gamemode_management/selectors';

import DownloadProgressFilter from './views/DownloadProgressFilter';
import FileTime from './views/FileTime';
import { IDownload } from './types/IDownload';
import getDownloadGames from './util/getDownloadGames';
import DownloadGameList from './views/DownloadGameList';

import * as I18next from 'i18next';
import * as path from 'path';
import * as React from 'react';
import * as url from 'url';
import { IDownloadViewProps } from './views/DownloadView';


function progress(props) {
  const {t, download} = props;
  const {state} = download;
  const received = download.received || 0;
  const size = download.size || 1;

  switch (state) {
    case 'init': return <span>{t('Pending')}</span>;
    case 'finished': return <span>{t('Finished')}</span>;
    case 'failed': return <span>{t('Failed')}</span>;
    case 'redirect': return <span>{t('Redirected')}</span>;
    case 'paused': return <span>{t('Paused')}</span>;
    default: return (
        <ProgressBar now={received} max={size} showPercentage showTimeLeft />
      );
  }
}

function calc(props) {
  const {download} = props;
  const {state, received, size} = download;

  if (state === 'started') {
    return (received / Math.max(size, 1));
  } else {
    return state;
  }
}

function downloadTime(download: IDownload) {
  return (download.fileTime !== undefined)
    ? new Date(download.fileTime)
    : undefined;
}

function nameFromUrl(input: string) {
  if (input === undefined) {
    return undefined;
  }

  const pathname = url.parse(input).pathname;
  if (!truthy(pathname)) {
    return undefined;
  }

  try {
    return decodeURI(path.basename(pathname));
  } catch (err) {
    return path.basename(pathname);
  }
}


function createColumns(api: IExtensionApi, props: () => IDownloadViewProps): ITableAttribute<IDownload>[] {
  let lang: string;
  let collator: Intl.Collator;

  const getCollator = (locale: string) => {
    if ((collator === undefined) || (locale !== lang)) {
      lang = locale;
      collator = new Intl.Collator(locale, { sensitivity: 'base' });
    }
    return collator;
  }

  return [
    {
      id: 'filename',
      name: 'Filename',
      description: 'Filename of the download',
      icon: '',
      calc: (attributes: IDownload) =>
        attributes.localPath
        || nameFromUrl(getSafe(attributes, ['urls', 0], undefined)),
      placement: 'both',
      isToggleable: true,
      edit: {},
      isSortable: true,
      sortFunc: (lhs: string, rhs: string, locale: string): number =>
        getCollator(locale).compare(lhs, rhs),
      filter: new TextFilter(true),
    }, {
      id: 'logicalname',
      name: 'Name',
      description: 'Readable Name',
      icon: '',
      calc: (attributes: IDownload) =>
        getSafe(attributes, ['modInfo', 'name'], '') || attributes.localPath,
      placement: 'both',
      isToggleable: true,
      edit: {},
      isSortable: true,
      sortFunc: (lhs: string, rhs: string, locale: string): number =>
        getCollator(locale).compare(lhs, rhs),
      isDefaultVisible: false,
      filter: new TextFilter(true),
    }, {
      id: 'game',
      name: 'Game',
      description: 'The game(s) this download is associated with',
      help: 'You can associate a download with multiple compatible games so it will show up '
          + 'when managing those games as well.',
      icon: 'game',
      customRenderer: (download: IDownload, detailCell: boolean,
                       t: I18next.TranslationFunction) => {
        const { downloads, knownGames } = props();
        const { store } = api;
        // TODO: awkward!
        const id = Object.keys(downloads).find(dlId => downloads[dlId] === download);
        if (detailCell) {
          return (
            <DownloadGameList
              t={t}
              id={id}
              currentGames={getDownloadGames(download)}
              games={knownGames}
              fileName={download.localPath}
            />);
        } else {
          const games = getDownloadGames(download);
          const name = gameName(store.getState(), games[0]);
          const more = games.length > 1 ? '...' : '';
          return (
            <div>
              {name}{more}
            </div>
          );
        }
      },
      calc: (attributes: IDownload) => getDownloadGames(attributes),
      placement: 'both',
      isToggleable: true,
      edit: {},
      isSortable: true,
      filter: new GameFilter(),
      sortFunc: (lhs: string, rhs: string, locale: string): number =>
        getCollator(locale).compare(lhs, rhs),
    }, {
      id: 'filetime',
      name: 'Downloaded',
      description: 'Time the file was last modified',
      icon: 'calendar-plus-o',
      customRenderer: (attributes: IDownload, detail: boolean, t) => {
        const { gameMode, downloadPath } = props();
        const time = downloadTime(attributes);

        if ((time === undefined)
            && ((getDownloadGames(attributes)[0] !== gameMode)
                || (attributes.localPath === undefined))) {
          return null;
        }
        return (
          <FileTime
            t={t}
            time={time}
            download={attributes}
            downloadPath={downloadPath}
            detail={detail}
            language={getCurrentLanguage()}
          />
        );
      },
      calc: (attributes: IDownload) => {
        const { downloadPath, downloads, gameMode, onSetAttribute } = props();
        const time = downloadTime(attributes);

        if (time !== undefined) {
          return time;
        }

        if ((getDownloadGames(attributes)[0] !== gameMode)
          || (attributes.localPath === undefined)) {
          return null;
        }
        return fs.statAsync(path.join(downloadPath, attributes.localPath))
        .then(stat => {
          const id = Object.keys(downloads).find(key => downloads[key] === attributes);
          onSetAttribute(id, stat.mtimeMs);
          return Promise.resolve(stat.mtime);
        })
        .catch(() => undefined);
      },
      placement: 'both',
      isToggleable: true,
      edit: {},
      isSortable: true,
      filter: new DateTimeFilter(),
    }, {
      id: 'filesize',
      name: 'File Size',
      description: 'Total size of the file',
      icon: 'chart-bars',
      customRenderer: (download: IDownload, detailCell: boolean, t: I18next.TranslationFunction) =>
        <span>{download.size !== undefined ? bytesToString(download.size) : '???'}</span>,
      calc: (download: IDownload) => download.size,
      placement: 'table',
      isToggleable: true,
      edit: {},
      isSortable: true,
    }, {
      id: 'progress',
      name: 'Progress',
      description: 'Download progress',
      icon: 'clock-o',
      customRenderer: (download: IDownload, detailCell: boolean, t: I18next.TranslationFunction) =>
        progress({ download, t }),
      calc: (download: IDownload, t: I18next.TranslationFunction) => calc({ download, t }),
      placement: 'table',
      isToggleable: true,
      edit: {},
      isSortable: true,
      filter: new DownloadProgressFilter(),
    }
  ];
}

export default createColumns;
