/**
 * Tiny external store for UiModel. React reads it with useSyncExternalStore; the
 * GameController is the only writer. No framework dependency in this file.
 */
import type { UiModel } from '../../shared/ui';

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
