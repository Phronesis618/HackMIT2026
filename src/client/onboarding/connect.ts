/**
 * The bridge. One call from `main.tsx`, the same additive shape `connectFloorsUi` already
 * uses: it subscribes to the session's snapshots and events and to the UI store, assembles a
 * `LessonContext`, and ticks the engine. It writes nothing anyone else reads.
 *
 * No simulation change, no protocol change, so no desync risk, and no edit to
 * `GameController`.
 */
import type { GameEvent, GameSnapshot, PreparedWorld, RoomSpec } from '../../shared/contracts';
import type { GameSession } from '../../shared/session';
import { createRoomProvider, type RoomProvider } from '../../sim';
import type { UiModel } from '../../shared/ui';
import type { UiStore } from '../game/uiStore';
import { FULL_MAP_KEYS } from '../game/input';
import { departureBus, isDeparting } from '../ui/HeadquartersDeparture';
import { OnboardingEngine } from './engine';
import { clearOnboarding, loadOnboarding, saveOnboarding, type KeyValueStorage } from './localStore';
import { onboardingBus } from './bus';
import { emptyFacts, type LessonContext, type RunFacts } from './types';

/** Which terrain feature each tile character belongs to (mirrors `client/render/terrain.ts`). */
const TILE_FEATURE: Readonly<Record<string, string>> = {
  B: 'breakable_walls', ':': 'rubble', '+': 'conduits', '~': 'hazard_floor',
  '*': 'canisters', o: 'pits', '^': 'vents', '-': 'cover', '=': 'bridges', '>': 'bridges',
};

/** The distinct terrain features written into a room's tile grid, before anything breaks. */
export function terrainFeaturesOf(room: RoomSpec | null): string[] {
  if (!room) return [];
  const out = new Set<string>();
  for (const row of room.tiles) for (const tile of row) {
    const feature = TILE_FEATURE[tile];
    if (feature) out.add(feature);
  }
  return [...out];
}

/** `?hints=off` silences the layer for this tab; `?hints=reset` wipes the device's memory. */
export function parseHintFlags(search: string): { off: boolean; reset: boolean } {
  const value = new URLSearchParams(search).get('hints');
  return { off: value === 'off', reset: value === 'reset' };
}

export interface OnboardingConnectOptions {
  storage?: KeyValueStorage;
  search?: string;
  /** Something is covering the stage (the menu, in practice). Injected so tests stay pure. */
  isOverlayOpen?: () => boolean;
  now?: () => number;
}

/**
 * Is the player being asked to do something else right now? A prompt that arrives during a
 * wind-up is worse than no prompt at all (docs/design/ONBOARDING.md §3, rule 7).
 */
export function isBlocked(snapshot: GameSnapshot | null, model: UiModel, localPlayerId: string, overlayOpen: boolean): boolean {
  if (overlayOpen) return true;
  if (isDeparting(departureBus.get())) return true;
  if (!snapshot) return false;
  if (snapshot.floor?.biomeChoice) return true;
  if (snapshot.bossField?.live) return true;
  if (snapshot.enemies.some((enemy) => (enemy.telegraph?.remainingMs ?? 0) > 0)) return true;
  if (Object.keys(snapshot.terrain?.canisters ?? {}).length > 0) return true;
  // Downed: the HUD strip is already telling them what is happening to them.
  if (snapshot.players.find((p) => p.id === localPlayerId)?.state === 'down') return true;
  return model.phase === 'debrief' || model.phase === 'preparing';
}

export function connectOnboarding(session: GameSession, store: UiStore, options: OnboardingConnectOptions = {}): () => void {
  const storage = options.storage;
  const flags = parseHintFlags(options.search ?? '');
  const now = options.now ?? (() => Date.now());

  if (flags.reset && storage) clearOnboarding(storage);
  const engine = new OnboardingEngine({
    state: storage && !flags.reset ? loadOnboarding(storage) : undefined,
    onPersist: (state) => { if (storage) saveOnboarding(storage, state); },
    onView: (view) => onboardingBus.publish(view),
  });
  if (flags.off) engine.setSessionOff(true);
  onboardingBus.attach(engine);
  onboardingBus.publish(engine.getView());

  const facts: RunFacts = emptyFacts('boot');
  let pending: GameEvent[] = [];
  let lastPhase: UiModel['phase'] | null = null;
  let phaseStartedMs = now();
  let lastPosition: { x: number; y: number } | null = null;
  const roomsSeen = new Set<string>();
  let rooms: { worldId: string; provider: RoomProvider | null } | null = null;
  let terrainRoomId: string | null = null;
  let terrainHere: string[] = [];

  const currentRoom = (world: PreparedWorld | null, snapshot: GameSnapshot): RoomSpec | null => {
    if (!world) return null;
    if (!snapshot.floor) return snapshot.roomIndex === null ? null : world.rooms[snapshot.roomIndex] ?? null;
    if (rooms?.worldId !== world.worldId) rooms = { worldId: world.worldId, provider: createRoomProvider(world) };
    try {
      return rooms.provider?.getRoom({ biomeId: snapshot.floor.biomeId, roomId: snapshot.floor.roomId }) ?? null;
    } catch {
      return null;
    }
  };

  const ingest = (events: readonly GameEvent[]): void => {
    for (const event of events) {
      switch (event.type) {
        case 'player_attacked': if (event.playerId === session.localPlayerId) facts.attacked = true; break;
        case 'player_dashed': if (event.playerId === session.localPlayerId) facts.dashed = true; break;
        case 'player_damaged': if (event.playerId === session.localPlayerId) facts.tookDamage = true; break;
        case 'ability_used': {
          // Ability ids are `<class>.<slot>.<name>`; `attack` and `dash` have no slot.
          if (event.playerId !== session.localPlayerId) break;
          const slot = event.abilityId.split('.')[1];
          if (slot === 'q') facts.usedQ = true;
          else if (slot === 'e') facts.usedE = true;
          else if (slot === 'r') facts.usedR = true;
          break;
        }
        case 'ability_unlocked': if (event.playerId === session.localPlayerId) facts.unlockedE = true; break;
        case 'player_revived': if (event.byPlayerId === session.localPlayerId) facts.revivedSomeone = true; break;
        case 'contribution_submitted': if (event.playerId === session.localPlayerId) facts.contributed = true; break;
        case 'room_entered':
          roomsSeen.add(event.roomId);
          facts.roomsEntered = roomsSeen.size;
          break;
        case 'room_cleared': facts.roomsCleared += 1; break;
        default: break;
      }
    }
    pending = pending.concat(events);
  };

  const observe = (snapshot: GameSnapshot): void => {
    const model = store.get();
    const nowMs = now();

    if (model.phase !== lastPhase) {
      lastPhase = model.phase;
      phaseStartedMs = nowMs;
      lastPosition = null;
    }

    const me = snapshot.players.find((p) => p.id === session.localPlayerId) ?? null;
    if (me) {
      if (lastPosition && Math.hypot(me.x - lastPosition.x, me.y - lastPosition.y) > 2) facts.moved = true;
      lastPosition = { x: me.x, y: me.y };
    }
    // A class taken at an armory stand, or picked from the rail chips.
    const stationId = model.headquarters?.activeStationId;
    if (stationId && ['bastion', 'shade', 'beacon', 'weaver'].includes(stationId)) facts.tookWeapon = true;
    if (model.contributions.some((c) => c.playerId === session.localPlayerId)) facts.contributed = true;
    facts.teammateDown = snapshot.players.some((p) => p.id !== session.localPlayerId && p.state === 'down');

    const world = session.getWorld();
    const runId = snapshot.worldId ?? 'hub';
    if (runId !== facts.runId) {
      facts.runId = runId;
      facts.roomsCleared = 0;
      roomsSeen.clear();
      facts.roomsEntered = 0;
      facts.tookDamage = false;
    }

    const roomKey = `${snapshot.worldId ?? ''}:${snapshot.roomId ?? ''}`;
    if (roomKey !== terrainRoomId) {
      terrainRoomId = roomKey;
      terrainHere = terrainFeaturesOf(currentRoom(world, snapshot));
    }

    const ctx: LessonContext = {
      nowMs,
      phase: model.phase,
      phaseMs: nowMs - phaseStartedMs,
      snapshot,
      model,
      localPlayerId: session.localPlayerId,
      events: pending,
      facts,
      world,
      terrainHere,
      isHost: session.getIsHost?.() ?? session.mode === 'local',
      isCoOp: session.mode === 'remote',
      blocked: isBlocked(snapshot, model, session.localPlayerId, options.isOverlayOpen?.() ?? false),
    };
    engine.tick(ctx);
    pending = [];
  };

  const disposers: Array<() => void> = [
    session.onEvents(ingest),
    session.onSnapshot(observe),
  ];

  if (typeof window !== 'undefined') {
    const onKey = (event: KeyboardEvent): void => {
      if (FULL_MAP_KEYS.includes(event.code)) facts.openedMap = true;
    };
    window.addEventListener('keydown', onKey);
    disposers.push(() => window.removeEventListener('keydown', onKey));
  }

  return () => {
    for (const dispose of disposers) dispose();
    onboardingBus.attach(null);
  };
}
