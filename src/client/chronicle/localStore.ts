/**
 * Device-local persistence for memories (Agent C). Validates on load so a corrupt or
 * stale entry never crashes the wall. Storage is injectable for tests.
 */
import { MemoryRecordListSchema, type MemoryRecord } from '../../shared/contracts';

export const MEMORIES_STORAGE_KEY = 'relay.memories.v1';
const MAX_STORED = 200;

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
    if (parsed.success) return parsed.data;
    // Salvage valid entries individually rather than dropping everything.
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const one = MemoryRecordListSchema.element.safeParse(item);
      return one.success ? [one.data] : [];
    });
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
  storage.removeItem(key);
}
