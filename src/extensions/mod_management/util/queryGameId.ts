import { showDialog } from '../../../actions';
import { ThunkStore } from '../../../types/IExtensionContext';
import { IState } from '../../../types/IState';
import { UserCanceled } from '../../../util/CustomErrors';
import { activeGameId, gameName } from '../../../util/selectors';

import * as Promise from 'bluebird';

/**
 * Determine which game to install a download for.
 * If the currently managed game is compatible, just pick that, otherwise ask the user
 */
function queryGameId(store: ThunkStore<any>, downloadGameIds: string[]): Promise<string> {
  const state: IState = store.getState();
  const gameMode = activeGameId(state);

  if (!Array.isArray(downloadGameIds)) {
    downloadGameIds = [ downloadGameIds ];
  }

  if (downloadGameIds.indexOf(gameMode) !== -1) {
    // the managed game is compatible to the archive so use that
    return Promise.resolve(gameMode);
  }

  const profiles = state.persistent.profiles;
  const profileGames = new Set<string>(
    Object.keys(profiles).map((profileId: string) => profiles[profileId].gameId));

  // we only offer to install for games that are managed because for others the user
  // doesn't have a direct way to configure the install directory
  const managed = downloadGameIds.filter(gameId => profileGames.has(gameId));

  // ask the user
  return new Promise<string>((resolve, reject) => {
    const options = [
      { label: 'Cancel', action: () => reject(new UserCanceled()) },
    ];
    if (gameMode !== undefined) {
      options.push({
        label: gameName(state, gameMode),
        action: () => resolve(gameMode),
      });
    }

    if (managed.length === 0) {
      store.dispatch(showDialog(
        'question', 'No compatible game being managed',
        {
          text:
            'The game(s) associated with this download are not managed, '
            + 'Install for the currently managed game?',
        }, options));
    } else {
      store.dispatch(showDialog(
        'question', 'Download is for a different game',
        {
          text:
            'This download is not marked compatible with the managed game. ' +
            'Which one do you want to install it for?',
        },
        options.concat(managed.map(gameId => (
          { label: gameName(store.getState(), gameId), action: () => resolve(gameId) }
        )))));
    }
  });
}

export default queryGameId;
