import { IExtensionContext } from '../../types/IExtensionContext';
import { activeGameId } from '../profile_management/selectors';

import RSSDashlet from './Dashlet';
import { REPLACEABLE_GAMEID } from './constants';

function init(context: IExtensionContext): boolean {
  const t = context.api.translate;
  context.registerDashlet('News', 1, 3, 250, RSSDashlet, undefined, () => ({
    title: t('Latest News'),
    emptyText: t('No News'),
    url: 'https://www.nexusmods.com/rss/news/',
    maxLength: 400,
    extras: [
      { attribute: 'nexusmods:comments', icon: 'comments', text: '{{ value }} comments'},
    ],
  }), undefined);

  context.registerDashlet(
      'Latest Mods', 1, 3, 300, RSSDashlet,
      state => activeGameId(state) !== undefined, () => {
        return {
          title: t('New Files'),
          emptyText: t('No New Files'),
          url: `https://www.nexusmods.com/${REPLACEABLE_GAMEID}/rss/newtoday/`,
          maxLength: 400,
          extras: [
            { attribute: 'nexusmods:endorsements', icon: 'endorse-yes', text: '{{ value }}' },
            { attribute: 'nexusmods:downloads', icon: 'download', text: '{{ value }}' },
          ],
        };
      }, undefined);

  return true;
}

export default init;
