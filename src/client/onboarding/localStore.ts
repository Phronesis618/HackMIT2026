/**
 * Device-local memory for the onboarding layer. Validates on load so a corrupt or stale
 * entry costs one lesson's memory rather than the whole file — the same salvage rule
 * `src/client/chronicle/localStore.ts` uses for the memory wall.
 *
 * Storage is injectable so the tests never touch a browser.
 */
import { z } from 'zod';
import type { FieldNote, LessonGroup } from './types';

export const ONBOARDING_STORAGE_KEY = 'relay.onboarding.v1';

const MAX_NOTES = 120;
const GROUPS = ['hub', 'controls', 'rooms', 'terrain', 'laws', 'finale'] as const;

const NoteSchema = z.object({
  id: z.string().min(1).max(80),
  group: z.enum(GROUPS),
  keys: z.array(z.string().min(1).max(12)).max(4).default([]),
  text: z.string().min(1).max(160),
  atMs: z.number().nonnegative(),
});

const StampsSchema = z.record(z.string().min(1).max(80), z.number().nonnegative());

export const OnboardingStateSchema = z.object({
  version: z.literal(1),
  /** The global off switch (menu page, or `?hints=off`). */
  off: z.boolean(),
  /** Lesson id -> when its prompt was last shown. */
  seen: StampsSchema,
  /** Lesson id -> when the player actually did the thing. Retires the lesson for good. */
  satisfied: StampsSchema,
  /** The Field Notes page, in the order the notes arrived. */
  notes: z.array(NoteSchema).max(MAX_NOTES),
});

/** `notes` is widened to `FieldNote[]` so the readonly `keys` of a live note fits straight in. */
export type OnboardingState = Omit<z.infer<typeof OnboardingStateSchema>, 'notes'> & { notes: FieldNote[] };

export function emptyState(): OnboardingState {
  return { version: 1, off: false, seen: {}, satisfied: {}, notes: [] };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Keep only the well-formed `id -> number` pairs out of something shaped roughly like a record. */
function salvageStamps(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (key.length > 0 && key.length <= 80 && typeof at === 'number' && Number.isFinite(at) && at >= 0) out[key] = at;
  }
  return out;
}

function salvageNotes(value: unknown): FieldNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const one = NoteSchema.safeParse(item);
    return one.success ? [one.data as FieldNote] : [];
  }).slice(-MAX_NOTES);
}

export function loadOnboarding(storage: KeyValueStorage, key = ONBOARDING_STORAGE_KEY): OnboardingState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return emptyState();
  }
  if (!raw) return emptyState();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  const parsed = OnboardingStateSchema.safeParse(parsedJson);
  if (parsed.success) return { ...parsed.data, notes: parsed.data.notes.slice(-MAX_NOTES) };
  // Salvage field by field: a bad note must not cost the player every hint they have retired.
  const loose = (typeof parsedJson === 'object' && parsedJson !== null ? parsedJson : {}) as Record<string, unknown>;
  return {
    version: 1,
    off: loose.off === true,
    seen: salvageStamps(loose.seen),
    satisfied: salvageStamps(loose.satisfied),
    notes: salvageNotes(loose.notes),
  };
}

export function saveOnboarding(storage: KeyValueStorage, state: OnboardingState, key = ONBOARDING_STORAGE_KEY): void {
  const trimmed: OnboardingState = { ...state, notes: state.notes.slice(-MAX_NOTES) };
  try {
    storage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Storage can be full or disabled. The session keeps working from memory.
  }
}

export function clearOnboarding(storage: KeyValueStorage, key = ONBOARDING_STORAGE_KEY): void {
  try {
    storage.removeItem(key);
  } catch {
    // Same: the in-memory state is reset by the caller either way.
  }
}

export type { LessonGroup };
