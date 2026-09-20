/**
 * Device-local persistence for memories (Agent C). Validates on load so a corrupt or
 * stale entry never crashes the wall. Storage is injectable for tests.
 */
import { z } from 'zod';
import type { ChronicleState } from '../../chronicle';
import { MemoryRecordListSchema, type MemoryRecord } from '../../shared/contracts';

export const MEMORIES_STORAGE_KEY = 'relay.memories.v1';
export const CHRONICLE_PROGRESS_STORAGE_KEY = 'relay.chronicle-progress.v1';
const MAX_STORED = 200;

const ChronicleProgressSchema = z.object({
  version: z.literal(1),
  seenEventIds: z.array(z.string()),
  floors: z.record(z.string(), z.object({
    biomes: z.array(z.object({
      biomeId: z.string(),
      biomeName: z.string(),
      tier: z.number().int().nonnegative(),
      roomsEntered: z.number().int().nonnegative(),
    })),
    pendingChoice: z.object({ fromBiomeId: z.string(), options: z.array(z.string()) }).nullable(),
    currentRoomKind: z.string().nullable(),
    currentRoomName: z.string().nullable(),
    firsts: z.array(z.string()),
    extras: z.number().int().nonnegative(),
  })).optional(),
});

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadMemories(storage: KeyValueStorage, key = MEMORIES_STORAGE_KEY): MemoryRecord[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = MemoryRecordListSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data.slice(-MAX_STORED);
    // Salvage valid entries individually rather than dropping everything.
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const one = MemoryRecordListSchema.element.safeParse(item);
      return one.success ? [one.data] : [];
    }).slice(-MAX_STORED);
  } catch {
    return [];
  }
}

export function saveMemories(storage: KeyValueStorage, memories: MemoryRecord[], key = MEMORIES_STORAGE_KEY): void {
  const trimmed = memories.length > MAX_STORED ? memories.slice(memories.length - MAX_STORED) : memories;
  try {
    storage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded (thumbnails). Drop thumbnails and retry once.
    const slim = trimmed.map(({ thumbnailDataUrl: _thumb, ...rest }) => rest);
    try {
      storage.setItem(key, JSON.stringify(slim));
    } catch {
      /* give up silently; memories stay in-memory for this session */
    }
  }
}

export function clearMemories(storage: KeyValueStorage, key = MEMORIES_STORAGE_KEY): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled; the in-memory wall still clears.
  }
}

export function loadChronicleProgress(storage: KeyValueStorage): Pick<ChronicleState, 'seenEventIds' | 'floors'> {
  try {
    const raw = storage.getItem(CHRONICLE_PROGRESS_STORAGE_KEY);
    if (raw) {
      const parsed = ChronicleProgressSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Storage can be disabled or corrupt.
  }
  return { seenEventIds: [] };
}

export function saveChronicleProgress(storage: KeyValueStorage, state: ChronicleState): void {
  try {
    storage.setItem(CHRONICLE_PROGRESS_STORAGE_KEY, JSON.stringify({
      version: 1, seenEventIds: state.seenEventIds, floors: state.floors,
    }));
  } catch {
    // Progress stays in memory when storage is unavailable.
  }
}

export function clearChronicleProgress(storage: KeyValueStorage): void {
  try {
    storage.removeItem(CHRONICLE_PROGRESS_STORAGE_KEY);
  } catch {
    // The in-memory state remains usable when storage is disabled.
  }
}
