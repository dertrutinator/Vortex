import { IExtensionApi } from '../../../types/IExtensionContext';
import { log } from '../../../util/log';
import { getSafe } from '../../../util/storeHelper';

import { IMod } from '../types/IMod';

import testModReference from './testModReference';

import * as Promise from 'bluebird';
import * as _ from 'lodash';
import { alg, Graph } from 'graphlib';
import { ILookupResult, IReference, IRule, RuleType } from 'modmeta-db';

export class CycleError extends Error {
  private mCycles: string[][];
  constructor(cycles: string[][]) {
    super('Rules contain cycles');
    this.name = this.constructor.name;
    this.mCycles = cycles;
  }
  public get cycles(): string[][] {
    return this.mCycles;
  }
}

function findByRef(mods: IMod[], reference: IReference): IMod {
  return mods.find((mod: IMod) => testModReference(mod, reference));
}

let sortModsCache: { id: { gameId: string, mods: IMod[] }, sorted: Promise<IMod[]> } =
  { id: { gameId: undefined, mods: [] }, sorted: Promise.resolve([]) };

function sortMods(gameId: string, mods: IMod[], api: IExtensionApi): Promise<IMod[]> {
  if (mods.length === 0) {
    // don't flush the cache if the input is empty
    return Promise.resolve([]);
  }

  if ((sortModsCache.id.gameId === gameId)
    && _.isEqual(sortModsCache.id.mods, mods)) {
    return sortModsCache.sorted;
  }

  // if the graphlib library throws a custom exception it may not contain a stack trace, so prepare
  // one we can use
  const stackErr = new Error();

  const dependencies = new Graph();

  const modMapper = (mod: IMod) => {
    return api.lookupModMeta({
                fileMD5: getSafe(mod.attributes, ['fileMD5'], undefined),
                fileSize: getSafe(mod.attributes, ['size'], undefined),
                gameId,
              })
        .catch(() => [])
        .then((metaInfo: ILookupResult[]) => {
          const rules = [].concat(
            getSafe(metaInfo, [0, 'value', 'rules'], []),
            mod.rules || []);
          rules.forEach((rule: IRule) => {
            const ref = findByRef(mods, rule.reference);
            if (ref !== undefined) {
              if (rule.type === 'before') {
                dependencies.setEdge(mod.id, ref.id);
              } else if (rule.type === 'after') {
                dependencies.setEdge(ref.id, mod.id);
              }
            }
          });
          return Promise.resolve();
        });
  };

  mods.forEach(mod => { dependencies.setNode(mod.id); });

  let sorted = Promise.map(mods, modMapper)
    .catch((err: Error) => {
      log('error', 'failed to sort mods',
          {msg: err.message, stack: err.stack});
    })
    .then(() => {
      try {
        const res = alg.topsort(dependencies);
        api.dismissNotification('mod-cycle-warning');
        const lookup = mods.reduce((prev, mod) => {
          prev[mod.id] = mod;
          return prev;
        }, {});
        return Promise.resolve(res.map(id => lookup[id]));
      } catch (err) {
        // exception type not included in typings
        if (err instanceof (alg.topsort as any).CycleException) {
          let res = new CycleError(alg.findCycles(dependencies));
          res.stack = stackErr.stack;
          return Promise.reject(res);
        } else {
          return Promise.reject(err);
        }
      }
    });

  sortModsCache = { id: { gameId, mods }, sorted };

  return sorted;
}

export default sortMods;
