/**
 * Hub state (relay.hub.v1): a pure reducer over real GameEvents plus device-local storage.
 * Every number asserted here is a count over the scripted events below — nothing is invented.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/shared/contracts';
import { createBrowserChronicle, type KeyValueStorage } from '../../src/client/chronicle';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import {
  HUB_MAX_STORED_RELICS, HUB_STORAGE_KEY, createHubState, createHubStateBus, HubStateSchema, loadHubState, reduceHubState, saveHubState,
  shelfRelics, type HubIngestContext,
} from '../../src/client/chronicle/hubState';

const LOCAL = 'local-1';
const ALLY = 'ally-1';
const WORLD = 'world-a';

const ctx: HubIngestContext = {
  now: 1_758_300_100_000,
  localPlayerId: LOCAL,
  players: [{ id: LOCAL, displayName: 'Jon' }, { id: ALLY, displayName: 'Priya' }],
  classByPlayerId: { [LOCAL]: 'shade', [ALLY]: 'beacon' },
  world: { worldId: WORLD, title: 'Vantage Spire', provenanceSource: 'fixture' },
};

let seq = 0;
function ev<T extends GameEvent['type']>(type: T, fields: Omit<Extract<GameEvent, { type: T }>, 'id' | 'tick' | 'timeMs' | 'type'>, timeMs = seq * 1000): GameEvent {
  seq += 1;
  return { id: `${seq}:0`, tick: seq, timeMs, type, ...fields } as unknown as GameEvent;
}

/** A scripted run: local Shade, downed twice (last hit by a warden), collapsed in room 3. */
function collapsedRun(worldId = WORLD, title = 'Vantage Spire'): GameEvent[] {
  return [
    ev('world_prepared', { worldId, worldTitle: title, source: 'fixture', playerIds: [LOCAL, ALLY] }),
    ev('room_entered', { worldId, roomIndex: 0, roomId: 'r0', roomName: 'Gate', playerIds: [LOCAL, ALLY] }),
    ev('enemy_damaged', { enemyId: 'husk', byPlayerId: LOCAL, amount: 12, remainingHp: 18 }),
    ev('enemy_defeated', { enemyId: 'husk', byPlayerId: LOCAL }),
    ev('room_cleared', { worldId, roomIndex: 0, roomId: 'r0', playerIds: [LOCAL, ALLY], reward: 1 }),
    ev('room_entered', { worldId, roomIndex: 1, roomId: 'r1', roomName: 'Hall', playerIds: [LOCAL, ALLY] }),
    ev('player_damaged', { playerId: LOCAL, amount: 30, remainingHp: 0, sourceEnemyId: 'sentinel' }),
    ev('player_downed', { playerId: LOCAL }),
    ev('player_revived', { playerId: LOCAL, byPlayerId: ALLY, hp: 40 }),
    ev('lore_discovered', { playerId: LOCAL, fragmentIndex: 2, kind: 'relic', title: 'Red wrench', source: 'Tarn, deck 4', text: 'A wrench.', x: 0, y: 0 }),
    ev('room_entered', { worldId, roomIndex: 2, roomId: 'r2', roomName: 'Deep', playerIds: [LOCAL, ALLY] }),
    ev('player_damaged', { playerId: LOCAL, amount: 40, remainingHp: 0, sourceEnemyId: 'warden' }),
    ev('player_downed', { playerId: LOCAL }),
    ev('player_downed', { playerId: ALLY }),
    ev('run_ended', { worldId, outcome: 'collapsed', playerIds: [LOCAL, ALLY] }),
  ];
}

function anchoredRun(worldId = 'world-b', title = 'Bramble Deck'): GameEvent[] {
  return [
    ev('world_prepared', { worldId, worldTitle: title, source: 'live', playerIds: [LOCAL] }),
    ev('room_entered', { worldId, roomIndex: 0, roomId: 'r0', roomName: 'Gate', playerIds: [LOCAL] }),
    ev('lore_discovered', { playerId: LOCAL, fragmentIndex: 0, kind: 'remains', title: 'Bones', source: 'nobody', text: 'x', x: 0, y: 0 }),
    ev('lore_discovered', { playerId: LOCAL, fragmentIndex: 1, kind: 'relic', title: 'Brass key', source: 'Oda Brandt, stores', text: 'A key.', x: 0, y: 0 }),
    ev('player_damaged', { playerId: LOCAL, amount: 7, remainingHp: 90, sourceEnemyId: null }),
    ev('room_cleared', { worldId, roomIndex: 0, roomId: 'r0', playerIds: [LOCAL], reward: 2 }),
    ev('anchor_planted', { worldId, roomIndex: 0, playerIds: [LOCAL] }),
    ev('run_ended', { worldId, outcome: 'anchored', playerIds: [LOCAL] }),
  ];
}

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('reduceHubState', () => {
  it('folds a collapsed run into LastRun with the stamped class and the attributed last down', () => {
    const state = reduceHubState(createHubState(), collapsedRun(), ctx);
    const run = state.lastRun!;
    expect(run.outcome).toBe('collapsed');
    expect(run.classId).toBe('shade');
    expect(run.worldTitle).toBe('Vantage Spire');
    expect(run.downs).toBe(2);
    expect(run.lastDownedByEnemyId).toBe('warden');
    expect(run.deepestRoomIndex).toBe(2);
    expect(run.deepestTier).toBe(-1);
    expect(run.biomesCleared).toBe(0);
    expect(run.roomsEntered).toBe(3);
    expect(run.roomsCleared).toBe(1);
    expect(run.enemiesDefeated).toBe(1);
    expect(run.damageDealt).toBe(12);
    expect(run.damageTaken).toBe(70);
    expect(run.revivesReceived).toBe(1);
    expect(run.revivesGiven).toBe(0);
    expect(run.loreRead).toBe(1);
    expect(run.crew.map((p) => p.displayName)).toEqual(['Jon', 'Priya']);
    expect(run.worldSource).toBe('fixture');
    expect(run.sourceEventIds.length).toBeGreaterThan(10);
    expect(state.current).toBeNull();
    expect(state.totals).toEqual({ runs: 1, anchors: 0, worldsVisited: 1, relics: 0 });
    expect(HubStateSchema.safeParse(state).success).toBe(true);
  });

  it('records per class only for the stamped class; unplayed classes stay at zero', () => {
    const state = reduceHubState(createHubState(), collapsedRun(), ctx);
    expect(state.records.shade.runs).toBe(1);
    expect(state.records.shade.collapses).toBe(1);
    expect(state.records.shade.timesDowned).toBe(2);
    expect(state.records.shade.nemesisCounts).toEqual({ warden: 1 });
    expect(state.records.shade.deepestRoomIndex).toBe(2);
    expect(state.records.bastion.runs).toBe(0);
    expect(state.records.beacon.runs).toBe(0);
    expect(state.records.weaver.runs).toBe(0);
  });

  it('tracks floors depth and gatekeeper clears in the last run and class record', () => {
    const events: GameEvent[] = [
      ev('world_prepared', { worldId: WORLD, worldTitle: 'Vantage Spire', source: 'fixture', playerIds: [LOCAL] }),
      ev('biome_entered', { worldId: WORLD, biomeId: 'b1', biomeName: 'Glass Warren', tier: 0, chosenByPlayerId: null, playerIds: [LOCAL] }),
      ev('room_entered', { worldId: WORLD, roomIndex: 0, roomId: 'b1:r00', roomName: 'Entry', playerIds: [LOCAL], biomeId: 'b1', floorRoomId: 'r00', kind: 'entrance' }),
      ev('biome_entered', { worldId: WORLD, biomeId: 'b2', biomeName: 'Copper Wall', tier: 1, chosenByPlayerId: LOCAL, playerIds: [LOCAL] }),
      ev('room_entered', { worldId: WORLD, roomIndex: 1, roomId: 'b2:r00', roomName: 'Gate', playerIds: [LOCAL], biomeId: 'b2', floorRoomId: 'r00', kind: 'exit' }),
      ev('room_cleared', { worldId: WORLD, roomIndex: 1, roomId: 'b2:r00', playerIds: [LOCAL], reward: 1 }),
      ev('run_ended', { worldId: WORLD, outcome: 'collapsed', playerIds: [LOCAL] }),
    ];
    const state = reduceHubState(createHubState(), events, ctx);
    expect(state.lastRun).toMatchObject({ deepestTier: 1, biomesCleared: 1 });
    expect(state.records.shade).toMatchObject({ deepestTier: 1, biomesCleared: 1 });
  });

  it('shelves a relic only from an anchored run, one per world, newest-left on the shelf', () => {
    let state = reduceHubState(createHubState(), collapsedRun(), ctx);
    expect(state.relics).toEqual([]);
    state = reduceHubState(state, anchoredRun(), ctx);
    expect(state.relics).toHaveLength(1);
    expect(state.relics[0]).toMatchObject({ id: 'relic-world-b-1', worldTitle: 'Bramble Deck', title: 'Brass key', recoveredBy: [{ id: LOCAL, displayName: 'Jon' }] });
    expect(state.totals).toEqual({ runs: 2, anchors: 1, worldsVisited: 2, relics: 1 });
    state = reduceHubState(state, anchoredRun('world-c', 'Cold Yard'), ctx);
    expect(shelfRelics(state).map((r) => r.worldTitle)).toEqual(['Cold Yard', 'Bramble Deck']);
    // Same world again replaces rather than duplicates.
    state = reduceHubState(state, anchoredRun('world-c', 'Cold Yard'), ctx);
    expect(state.relics).toHaveLength(2);
  });

  it('keeps at most 24 relics in the store and shows five on the shelf', () => {
    let state = createHubState();
    for (let n = 0; n < 30; n++) state = reduceHubState(state, anchoredRun(`w-${n}`, `World ${n}`), ctx);
    expect(state.relics).toHaveLength(HUB_MAX_STORED_RELICS);
    expect(shelfRelics(state).map((r) => r.worldTitle)).toEqual(['World 29', 'World 28', 'World 27', 'World 26', 'World 25']);
  });

  it('ignores already-seen event ids and returns the same object when nothing changes', () => {
    const events = collapsedRun();
    const once = reduceHubState(createHubState(), events, ctx);
    const twice = reduceHubState(once, events, ctx);
    expect(twice).toBe(once);
    expect(reduceHubState(once, [], ctx)).toBe(once);
  });

  it('records nothing when the run ended without a known class or without the local player', () => {
    const noClass = reduceHubState(createHubState(), collapsedRun(), { ...ctx, classByPlayerId: {} });
    expect(noClass.lastRun).toBeNull();
    expect(noClass.totals.runs).toBe(0);
    const absent = reduceHubState(createHubState(), collapsedRun(), { ...ctx, localPlayerId: 'someone-else' });
    expect(absent.lastRun).toBeNull();
  });

  it('ignores explicit training and other-world kills while a run is open', () => {
    const state = reduceHubState(createHubState(), collapsedRun().slice(0, 2), ctx);
    const kill: Extract<GameEvent, { type: 'enemy_defeated' }> = {
      type: 'enemy_defeated', id: 'kill:1', tick: 1, timeMs: 1000, enemyId: 'husk', byPlayerId: LOCAL, worldId: WORLD,
    };
    expect(reduceHubState(state, [{ ...kill, worldId: null }, { ...kill, worldId: 'another-world' }], ctx)).toBe(state);
    const next = reduceHubState(state, [kill], ctx);
    expect(next.current?.enemiesDefeated).toBe(1);
    expect(reduceHubState(next, [kill], ctx)).toBe(next);
  });
});

describe('relay.hub.v1 storage', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const state = reduceHubState(createHubState(), collapsedRun(), ctx);
    saveHubState(storage, state);
    expect(storage.data.has(HUB_STORAGE_KEY)).toBe(true);
    expect(loadHubState(storage)).toEqual(state);
  });

  it('loads corrupt JSON as empty state', () => {
    const storage = memoryStorage();
    storage.data.set(HUB_STORAGE_KEY, '{not json');
    expect(loadHubState(storage)).toEqual(createHubState());
    storage.data.set(HUB_STORAGE_KEY, '[1,2,3]');
    expect(loadHubState(storage)).toEqual(createHubState());
  });

  it('salvages valid records and relics from a partially broken store', () => {
    const storage = memoryStorage();
    const good = reduceHubState(createHubState(), [...collapsedRun(), ...anchoredRun()], ctx);
    const broken = {
      ...good,
      version: 1,
      lastRun: { outcome: 'won' },
      relics: [good.relics[0], { id: 'bad' }],
      records: { ...good.records, bastion: 'nope' },
      totals: 'nope',
    };
    storage.data.set(HUB_STORAGE_KEY, JSON.stringify(broken));
    const loaded = loadHubState(storage);
    expect(loaded.lastRun).toBeNull();
    expect(loaded.relics).toEqual([good.relics[0]]);
    expect(loaded.records.shade).toEqual(good.records.shade);
    expect(loaded.records.bastion.runs).toBe(0);
    expect(loaded.totals).toEqual({ runs: 2, anchors: 1, worldsVisited: 2, relics: 1 });
  });

  it('preserves legacy run counts and replay protection without blocking a new world', () => {
    const storage = memoryStorage();
    const events = collapsedRun();
    const state = reduceHubState(createHubState(), events, ctx);
    saveHubState(storage, { ...state, seenEventIds: events.map((event) => event.id) });
    const loaded = loadHubState(storage);
    expect(reduceHubState(loaded, events, ctx)).toBe(loaded);
    const nextEvents = anchoredRun('legacy-next').map((event, index) => ({ ...event, id: events[index]!.id }));
    const next = reduceHubState(loaded, nextEvents, ctx);
    expect(next.totals.runs).toBe(2);
    expect(next.records.shade.collapses).toBe(1);
    expect(next.records.shade.anchors).toBe(1);
    expect(next.lastRun?.worldId).toBe('legacy-next');
    saveHubState(storage, next);
    const reloaded = loadHubState(storage);
    expect(reduceHubState(reloaded, nextEvents, ctx)).toBe(reloaded);
  });

  it('continues a legacy in-flight run without recounting its saved prefix', () => {
    const storage = memoryStorage();
    const events = collapsedRun();
    const prefix = events.slice(0, 6);
    const state = reduceHubState(createHubState(), prefix, ctx);
    saveHubState(storage, { ...state, seenEventIds: prefix.map((event) => event.id) });
    const loaded = loadHubState(storage);
    expect(reduceHubState(loaded, prefix, ctx)).toBe(loaded);
    const finished = reduceHubState(loaded, events, ctx);
    expect(finished.lastRun).toMatchObject({ roomsEntered: 3, enemiesDefeated: 1, damageDealt: 12 });
    expect(finished.totals.runs).toBe(1);
  });

  it('loads old stored runs and records with floor fields omitted using defaults', () => {
    const storage = memoryStorage();
    const current = reduceHubState(createHubState(), collapsedRun(), ctx);
    const old = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    const oldLastRun = old.lastRun as Record<string, unknown>;
    delete oldLastRun.deepestTier;
    delete oldLastRun.biomesCleared;
    const oldRecords = old.records as Record<string, Record<string, unknown>>;
    for (const record of Object.values(oldRecords)) {
      delete record.deepestTier;
      delete record.biomesCleared;
    }
    const oldCurrent = old.current as Record<string, unknown> | null;
    if (oldCurrent) {
      delete oldCurrent.deepestTier;
      delete oldCurrent.biomesCleared;
      delete oldCurrent.currentRoomKind;
    }
    storage.data.set(HUB_STORAGE_KEY, JSON.stringify(old));
    const loaded = loadHubState(storage);
    expect(loaded.lastRun?.deepestTier).toBe(-1);
    expect(loaded.lastRun?.biomesCleared).toBe(0);
    expect(loaded.records.shade.deepestTier).toBe(-1);
    expect(loaded.records.shade.biomesCleared).toBe(0);
  });
});

describe('createBrowserChronicle hub integration', () => {
  it.each([false, true])('records successive fixture expeditions with reused event IDs (reload: %s)', async (reload) => {
    const storage = memoryStorage();
    const identity = { id: LOCAL, displayName: 'Jon', classId: 'shade' as const };
    let chronicle = createBrowserChronicle(storage, () => ctx.now, createHubStateBus());
    let events: GameEvent[] = [];
    const makeSession = (): LocalSession => {
      const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
      session.onEvents((batch) => {
        events.push(...batch);
        const world = session.getWorld();
        chronicle.ingest(batch, {
          players: [identity], localPlayerId: LOCAL, classByPlayerId: { [LOCAL]: identity.classId },
          world: world ? {
            worldId: world.worldId, title: world.recipe.title, provenanceSource: world.provenance.source, receipt: world.receipt,
          } : null,
        });
      });
      return session;
    };
    let session = makeSession();
    try {
      for (const run of [1, 2]) {
        if (run === 2 && reload) {
          session.dispose();
          chronicle = createBrowserChronicle(storage, () => ctx.now, createHubStateBus());
          session = makeSession();
        }
        events = [];
        const world = await session.requestWorld();
        session.enterPortal();
        session.returnToHeadquarters();
        const state = chronicle.getHubState();
        expect(state.totals).toMatchObject({ runs: run, worldsVisited: run });
        expect(state.lastRun).toMatchObject({ worldId: world.worldId, roomsEntered: 1, outcome: 'aborted' });
        expect(state.current).toBeNull();
        expect(chronicle.getMemories()).toHaveLength(run * 3);
        const loaded = loadHubState(storage);
        expect(loaded).toEqual(state);
        expect(reduceHubState(loaded, events, {
          ...ctx, world: { worldId: world.worldId, title: world.recipe.title, provenanceSource: world.provenance.source },
        })).toBe(loaded);
      }
    } finally {
      session.dispose();
    }
  });

  it('reduces hub state from ingested events, persists at run boundaries, and clears with the memories', () => {
    const storage = memoryStorage();
    const bus = createHubStateBus();
    const chronicle = createBrowserChronicle(storage, () => ctx.now, bus);
    const events = collapsedRun();
    chronicle.ingest(events.slice(0, 6), { players: [...ctx.players], world: null, localPlayerId: LOCAL, classByPlayerId: ctx.classByPlayerId });
    expect(bus.get().current?.roomsEntered).toBe(2);
    chronicle.ingest(events.slice(6), { players: [...ctx.players], world: null, localPlayerId: LOCAL, classByPlayerId: ctx.classByPlayerId });
    expect(chronicle.getHubState().lastRun?.outcome).toBe('collapsed');
    expect(loadHubState(storage).lastRun?.outcome).toBe('collapsed');
    chronicle.clear();
    expect(chronicle.getHubState()).toEqual(createHubState());
    expect(storage.data.has(HUB_STORAGE_KEY)).toBe(false);
  });

  it('does not touch hub state when the caller gives no local player id', () => {
    const bus = createHubStateBus();
    const chronicle = createBrowserChronicle(memoryStorage(), () => ctx.now, bus);
    chronicle.ingest(collapsedRun(), { players: [...ctx.players], world: null });
    expect(bus.get().totals.runs).toBe(0);
  });
});
