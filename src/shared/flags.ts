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

let authority: SessionFlags | null = null;

/** Called once at boot with what `/api/config` reported, or null when no server answered. */
export function adoptServerFlags(flags: SessionFlags | null): void {
  authority = flags;
}

/** What the server said about one flag, or null when nothing has been adopted. */
export function serverFlag(name: keyof SessionFlags): boolean | null {
  return authority === null ? null : authority[name];
}
