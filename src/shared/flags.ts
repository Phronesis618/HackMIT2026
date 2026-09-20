/**
 * Session feature flags that every machine in a session has to agree about.
 *
 * The SERVER is the authority. It reads `RELAY_LAWS` / `RELAY_FLOORS` from its environment and
 * reports them on `GET /api/config`; each client adopts what it is told at boot. Before this,
 * derived laws and the derived look needed `?laws=1` in every browser's URL or the crew played
 * one game while their screens drew another (docs/design/WORLD_MUTATORS.md).
 *
 * Env / URL flags remain the fallback for a client with no server (solo fixture play) — see the
 * per-flag rules in `lawsFlagEnabled` (src/sim/laws.ts) and `floorsRequested`
 * (src/client/transport/worldProviders.ts).
 *
 * Pure module state, no I/O: the server never calls `adoptServerFlags`, so its own behaviour is
 * unchanged.
 */

export interface SessionFlags {
  /** RELAY_LAWS: derive laws + a look for worlds whose recipe has none. */
  laws: boolean;
  /** RELAY_FLOORS: prepared worlds are floors worlds unless a request says otherwise. */
  floors: boolean;
}

/**
 * Floors and laws are the shipped game: both are ON unless something explicitly says otherwise.
 *
 * The flip happened once the evidence was in (docs/RELEASE_FLOORS_DEFAULT.md): the floors ending
 * was played end to end in a browser, co-op floors passes, and biome-1 survival measures 99%+.
 * The legacy 3-room path is still fully playable — it is what `RELAY_FLOORS=0` / `?floors=0` get.
 */
export const DEFAULT_SESSION_FLAGS: SessionFlags = { laws: true, floors: true };

const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);
const ON_VALUES = new Set(['1', 'true', 'on', 'yes']);

/**
 * Read one env / URL flag value. `undefined` (absent) means "nobody said", so the caller's
 * fallback wins; anything unrecognised is also treated as "nobody said" rather than as OFF, so a
 * typo cannot silently disable the headline feature.
 */
export function readFlagValue(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  const value = raw.trim().toLowerCase();
  if (OFF_VALUES.has(value)) return false;
  if (ON_VALUES.has(value)) return true;
  return fallback;
}

let authority: SessionFlags | null = null;

/** Called once at boot with what `/api/config` reported, or null when no server answered. */
export function adoptServerFlags(flags: SessionFlags | null): void {
  authority = flags;
}

/** What the server said about one flag, or null when nothing has been adopted. */
export function serverFlag(name: keyof SessionFlags): boolean | null {
  return authority === null ? null : authority[name];
}
