/**
 * Pure state machine behind the world-forming overlay, kept separate from React so it can
 * be unit-tested with plain timestamps. Transitions:
 *
 *   idle ──busy──▶ forming ──(world arrived ∧ min beat elapsed)──▶ reveal ──(timeout)──▶ idle
 *        ◀──── in a run / dismissed / request failed ────
 *
 * The overlay never invents data: "busy" and "worldId" come straight from the UI model.
 */
export const MIN_FORMING_MS = 1600;
export const REVEAL_MS = 4200;

export interface OverlayState {
  kind: 'idle' | 'forming' | 'reveal';
  /** When the current stage began. */
  since: number;
  /** World shown by the current/last reveal, so the same world is never revealed twice. */
  revealedWorldId: string | null;
}

export interface OverlayInput {
  busy: boolean;
  worldId: string | null;
  inRun: boolean;
  now: number;
}

export const INITIAL_OVERLAY_STATE: OverlayState = { kind: 'idle', since: 0, revealedWorldId: null };

export function stepOverlay(state: OverlayState, input: OverlayInput): OverlayState {
  const { busy, worldId, inRun, now } = input;
  if (inRun) {
    // Leaving the sanctuary always clears the overlay; the world in play counts as seen.
    return state.kind === 'idle' && state.revealedWorldId === (worldId ?? state.revealedWorldId)
      ? state
      : { kind: 'idle', since: now, revealedWorldId: worldId ?? state.revealedWorldId };
  }
  const fresh = worldId !== null && worldId !== state.revealedWorldId;
  switch (state.kind) {
    case 'idle':
      if (busy) return { ...state, kind: 'forming', since: now };
      if (fresh) return { kind: 'reveal', since: now, revealedWorldId: worldId };
      return state;
    case 'forming':
      if (busy) return state;
      if (fresh) {
        return now - state.since >= MIN_FORMING_MS ? { kind: 'reveal', since: now, revealedWorldId: worldId } : state;
      }
      return { ...state, kind: 'idle', since: now };
    case 'reveal':
      if (busy) return { ...state, kind: 'forming', since: now };
      if (now - state.since >= REVEAL_MS) return { ...state, kind: 'idle', since: now };
      return state;
  }
}

export function dismissOverlay(state: OverlayState, now: number): OverlayState {
  return { ...state, kind: 'idle', since: now };
}
