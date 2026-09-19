/**
 * BrowserChronicle — glues the pure reducer (src/chronicle) to device-local storage.
 * Agent A's controller calls `ingest` with authoritative events; Agent C owns the
 * reducer rules, this adapter and the memory wall UI.
 */
import { MemoryRecordSchema, type GameEvent, type MemoryRecord } from '../../shared/contracts';
import { createChronicleState, reduceChronicle, type ChronicleContext, type ChronicleState } from '../../chronicle';
import { clearMemories, loadMemories, saveMemories, type KeyValueStorage } from './localStore';

export interface BrowserChronicle {
  getMemories(): MemoryRecord[];
  /** Reduce events into memories, persist, return the newly created ones. */
  ingest(events: GameEvent[], ctx: Omit<ChronicleContext, 'now'>): MemoryRecord[];
  attachThumbnail(memoryId: string, dataUrl: string): void;
  clear(): void;
  subscribe(listener: (memories: MemoryRecord[]) => void): () => void;
}

export function createBrowserChronicle(storage: KeyValueStorage, now: () => number = Date.now): BrowserChronicle {
  let state: ChronicleState = createChronicleState(loadMemories(storage));
  const listeners = new Set<(m: MemoryRecord[]) => void>();
  const notify = (): void => {
    for (const l of listeners) l(state.memories);
  };

  return {
    getMemories: () => state.memories,
    ingest(events, ctx) {
      const result = reduceChronicle(state, events, { ...ctx, now: now() });
      state = result.state;
      if (result.created.length > 0) {
        saveMemories(storage, state.memories);
        notify();
      }
      return result.created;
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
