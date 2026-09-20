/**
 * BrowserChronicle — glues the pure reducer (src/chronicle) to device-local storage.
 * Agent A's controller calls `ingest` with authoritative events; Agent C owns the
 * reducer rules, this adapter and the memory wall UI.
 */
import { MemoryRecordSchema, type GameEvent, type MemoryRecord } from '../../shared/contracts';
import {
  createChronicleState, reduceChronicle, refreshChronicleReceipt,
  type ChronicleContext, type ChronicleState, type ChronicleWorldContext,
} from '../../chronicle';
import { clearHubState, createHubState, hubStateBus, loadHubState, reduceHubState, saveHubState, type HubState, type HubStateBus } from './hubState';
import {
  clearChronicleProgress, clearMemories, loadChronicleProgress, loadMemories,
  saveChronicleProgress, saveMemories, type KeyValueStorage,
} from './localStore';
import type { ClassId } from '../../shared/registry';

export interface BrowserIngestContext extends Omit<ChronicleContext, 'now'> {
  /** Hub state (relay.hub.v1) is only reduced when the local player and live classes are known. */
  localPlayerId?: string;
  classByPlayerId?: Readonly<Partial<Record<string, ClassId>>>;
}

export interface BrowserChronicle {
  getMemories(): MemoryRecord[];
  getHubState(): HubState;
  /** Reduce events into memories (and hub state), persist, return the newly created memories. */
  ingest(events: GameEvent[], ctx: BrowserIngestContext): MemoryRecord[];
  refreshReceipt(world: ChronicleWorldContext): void;
  attachThumbnail(memoryId: string, dataUrl: string): void;
  clear(): void;
  subscribe(listener: (memories: MemoryRecord[]) => void): () => void;
}

export function createBrowserChronicle(storage: KeyValueStorage, now: () => number = Date.now, hub: HubStateBus = hubStateBus): BrowserChronicle {
  let state: ChronicleState = { ...createChronicleState(loadMemories(storage)), ...loadChronicleProgress(storage) };
  hub.set(loadHubState(storage));
  const listeners = new Set<(m: MemoryRecord[]) => void>();
  const notify = (): void => {
    for (const l of listeners) l(state.memories);
  };

  return {
    getMemories: () => state.memories,
    getHubState: () => hub.get(),
    ingest(events, ctx) {
      const at = now();
      const result = reduceChronicle(state, events, { players: ctx.players, world: ctx.world, now: at });
      const floorEvents = events.some((event) => event.type === 'biome_entered'
        || event.type === 'biome_choice_offered' || (event.type === 'room_entered' && event.kind));
      if (events.length > 0 && (state.floors || result.state.floors || floorEvents)) {
        saveChronicleProgress(storage, result.state);
      }
      state = result.state;
      if (result.created.length > 0) {
        saveMemories(storage, state.memories);
        notify();
      }
      if (ctx.localPlayerId) {
        const before = hub.get();
        const after = reduceHubState(before, events, {
          now: at, localPlayerId: ctx.localPlayerId, players: ctx.players, classByPlayerId: ctx.classByPlayerId ?? {},
          world: ctx.world ? { worldId: ctx.world.worldId, title: ctx.world.title, provenanceSource: ctx.world.provenanceSource } : null,
        });
        if (after !== before) {
          hub.set(after);
          saveHubState(storage, after);
        }
      }
      return result.created;
    },
    refreshReceipt(world) {
      const updated = refreshChronicleReceipt(state, world);
      if (updated === state) return;
      state = updated;
      saveMemories(storage, state.memories);
      notify();
    },
    attachThumbnail(memoryId, dataUrl) {
      if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl) || !MemoryRecordSchema.shape.thumbnailDataUrl.safeParse(dataUrl).success) return;
      const idx = state.memories.findIndex((m) => m.id === memoryId);
      if (idx < 0) return;
      const memories = [...state.memories];
      memories[idx] = { ...memories[idx]!, thumbnailDataUrl: dataUrl };
      state = { ...state, memories };
      saveMemories(storage, memories);
      notify();
    },
    clear() {
      state = { ...state, memories: [] };
      clearMemories(storage);
      clearChronicleProgress(storage);
      hub.set(createHubState());
      clearHubState(storage);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export { MEMORIES_STORAGE_KEY, loadMemories, saveMemories, clearMemories } from './localStore';
export type { KeyValueStorage } from './localStore';
export type { ChronicleWorldContext } from '../../chronicle';
export { HUB_STORAGE_KEY, hubStateBus, loadHubState, saveHubState, clearHubState } from './hubState';
export type { HubState, HubStateBus } from './hubState';
