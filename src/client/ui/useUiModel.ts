import { useSyncExternalStore } from 'react';
import type { UiModel } from '../../shared/ui';
import type { UiStore } from '../game/uiStore';

export function useUiModel(store: UiStore): UiModel {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
