/**
 * Tiny external store for UiModel. React reads it with useSyncExternalStore; the
 * GameController is the only writer. No framework dependency in this file.
 */
import type { GameSession } from '../../shared/session';
import type { UiActions, UiModel } from '../../shared/ui';
import { floorUiFrom, floorUiKey } from '../ui/floorsModel';

export interface UiStore {
  get(): UiModel;
  set(update: Partial<UiModel> | ((prev: UiModel) => UiModel)): void;
  subscribe(listener: () => void): () => void;
}

export function createUiStore(initial: UiModel): UiStore {
  let model = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => model,
    set(update) {
      model = typeof update === 'function' ? update(model) : { ...model, ...update };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---- floors (agent F3) -------------------------------------------------------------
// Additive bridge: publishes `UiModel.floor` from the session's snapshots and adds
// `chooseBiome` to the UI actions, without touching GameController. One call from main.tsx.

export function connectFloorsUi(session: GameSession, store: UiStore, actions?: UiActions): () => void {
  let lastKey = '';
  if (actions) actions.chooseBiome = (biomeId) => session.chooseBiome?.(biomeId);
  return session.onSnapshot((snapshot) => {
    const key = snapshot.phase === 'expedition' ? floorUiKey(snapshot) : '';
    if (key === lastKey) return;
    lastKey = key;
    const solo = session.mode === 'local';
    store.set({
      floor: key === '' ? null : floorUiFrom(snapshot, session.getWorld(), {
        playerId: session.localPlayerId, solo, isHost: session.getIsHost?.() ?? solo,
      }),
    });
  });
}
