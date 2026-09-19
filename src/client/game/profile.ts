/**
 * Device-local player profile (shards + permanent unlocks). Owner: Agent A (foundation
 * adapter). Validated on load; the starting grant is applied exactly once per profile.
 * Storage is injectable so tests use an in-memory map. Not tamper-proof; never cross-device.
 */
import { PlayerProfileSchema, type PlayerProfile } from '../../shared/contracts';
import { STARTING_SHARDS } from '../../shared/registry';
import type { ProfileStore } from '../../shared/session';
import type { KeyValueStorage } from '../chronicle/localStore';

export const PROFILE_STORAGE_KEY = 'relay.profile.v1';

export function createLocalProfileStore(storage: KeyValueStorage, playerId: string, now: () => number = Date.now): ProfileStore {
  let profile = load(storage, playerId, now);
  return {
    get: () => profile,
    save(next) {
      profile = PlayerProfileSchema.parse(next);
      try {
        storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      } catch {
        /* quota / private mode: keep in memory */
      }
    },
  };
}

export function createMemoryProfileStore(playerId: string, now: () => number = Date.now): ProfileStore {
  const data = new Map<string, string>();
  return createLocalProfileStore(
    { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) },
    playerId,
    now,
  );
}

function load(storage: KeyValueStorage, playerId: string, now: () => number): PlayerProfile {
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = PlayerProfileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* fall through to a fresh profile */
  }
  const fresh: PlayerProfile = {
    version: 1,
    playerId,
    shards: STARTING_SHARDS,
    unlockedAbilityIds: [],
    startingGrantApplied: true,
    runsPlayed: 0,
    updatedAt: now(),
  };
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    /* ignore */
  }
  return fresh;
}
