import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  DEPARTURE_COUNTDOWN_MS, DEPARTURE_FLASH_HOLD_MS, departureStage, type DepartureStage,
} from '../../shared/headquarters';

/**
 * Departure ritual (HUB.md §8): device-local presentation state for the 2.4 s sequence
 * between "Enter portal" and the room change. The UI starts it, the renderer reads it,
 * F / Escape skip it. Nothing here touches the simulation: the ritual only delays the
 * moment `enterPortal` is actually sent.
 */
export interface DepartureState {
  startedAt: number;
  /** Wall-clock time the portal request was sent (ritual finished or skipped). */
  committedAt: number | null;
}

export interface DepartureBus {
  get(): DepartureState | null;
  subscribe(listener: () => void): () => void;
  /** Start the ritual; `commit` runs once, at 2.4 s or on skip. No-op while one is running. */
  begin(commit: () => void): boolean;
  skip(): void;
  /** Drop the state (e.g. the panel unmounted because the phase changed). */
  clear(): void;
  /** Ritual stage for `now`, or null when no ritual is running. */
  stage(now?: number): DepartureStage | null;
}

export function createDepartureBus(now: () => number = Date.now, schedule: (fn: () => void, ms: number) => unknown = setTimeout, cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)): DepartureBus {
  let state: DepartureState | null = null;
  let pending: (() => void) | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of listeners) listener(); };
  const commit = (): void => {
    if (!state || state.committedAt !== null) return;
    if (timer !== null) cancel(timer);
    timer = null;
    state = { ...state, committedAt: now() };
    const run = pending;
    pending = null;
    notify();
    run?.();
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(fn) {
      if (state && state.committedAt === null) return false;
      state = { startedAt: now(), committedAt: null };
      pending = fn;
      timer = schedule(commit, DEPARTURE_COUNTDOWN_MS);
      notify();
      return true;
    },
    skip: commit,
    clear() {
      if (timer !== null) cancel(timer);
      timer = null;
      pending = null;
      state = null;
      notify();
    },
    stage(at = now()) {
      if (!state) return null;
      if (state.committedAt !== null) return departureStage(DEPARTURE_COUNTDOWN_MS);
      return departureStage(at - state.startedAt);
    },
  };
}

/** The page-wide bus: UI panels start rituals here; the headquarters renderer reads it. */
export const departureBus: DepartureBus = createDepartureBus();

export function useDeparture(bus: DepartureBus): DepartureState | null {
  return useSyncExternalStore(bus.subscribe, bus.get, bus.get);
}

export function isDeparting(state: DepartureState | null): boolean {
  return state !== null && state.committedAt === null;
}

export const DEPARTURE_SKIP_KEYS: ReadonlySet<string> = new Set(['KeyF', 'Escape']);

/**
 * Full-screen white flash plus the skip hint. Mount it inside the stage wrapper so the
 * flash covers the canvas; it captures pointer input while the ritual runs.
 */
export function HeadquartersDeparture({ bus = departureBus, now = Date.now }: { bus?: DepartureBus; now?: () => number }) {
  const state = useDeparture(bus);
  const departing = isDeparting(state);
  useEffect(() => {
    if (!departing) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!DEPARTURE_SKIP_KEYS.has(event.code) || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      bus.skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [bus, departing]);
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!state) return;
    if (state.committedAt !== null) {
      const timer = setTimeout(() => bus.clear(), DEPARTURE_FLASH_HOLD_MS + 200);
      return () => clearTimeout(timer);
    }
    let handle = 0;
    const tick = (): void => { setFrame((frame) => frame + 1); handle = requestAnimationFrame(tick); };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [bus, state]);
  if (!state) return null;
  const stage = bus.stage(now());
  const flash = stage?.flash ?? 0;
  return (
    <div className={`hq-departure${state.committedAt !== null ? ' hq-departure--committed' : ''}`} role="status" aria-live="polite" data-testid="hq-departure">
      {departing && (
        <p className="hq-departure__hint"><kbd>F</kbd> or <kbd>Esc</kbd> leaves now</p>
      )}
      <div className="hq-departure__flash" style={{ opacity: state.committedAt !== null ? 1 : flash }} aria-hidden="true" />
    </div>
  );
}
