/**
 * Each lesson's trigger and its dismissal, one at a time. The curriculum is
 * docs/design/ONBOARDING.md §4; this is the table read back as assertions.
 */
import { describe, expect, it } from 'vitest';
import { ABILITY_UNLOCK_COST } from '../../src/shared/conventions';
import type { EnemyState, GameSnapshot } from '../../src/shared/contracts';
import type { FloorRunState, RoomKind } from '../../src/shared/floors';
import { currentRoomKind, LESSON_BY_ID, terrainFeaturesOf, isBlocked, parseHintFlags } from '../../src/client/onboarding';
import type { LessonContext } from '../../src/client/onboarding';
import { context, ME, MATE, player, snapshot, uiModel } from './onboardingFixture';

const worldModel = (phase: 'headquarters' | 'expedition') => uiModel({
  phase,
  world: {
    worldId: 'w', title: 't', tagline: '', themeSummary: '',
    provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { source: 'fixture', worldTitle: 't', headline: '', lines: [] },
    committedRoomCount: 1, plannedRoomCount: 1, lore: [], attunements: [],
  },
});

const lesson = (id: string) => {
  const found = LESSON_BY_ID.get(id);
  if (!found) throw new Error(`no lesson ${id}`);
  return found;
};

const husk = (over: Partial<EnemyState> = {}): EnemyState =>
  ({ id: 'e1', enemyId: 'husk', x: 200, y: 200, facing: 0, hp: 10, maxHp: 10, state: 'chasing', ...over });

const floor = (over: Partial<FloorRunState> = {}): FloorRunState => ({
  biomeId: 'b1', roomId: 'r1', tier: 0, path: ['b1'], map: [], doorsLocked: false, biomeChoice: null, ...over,
});

const inRoomOfKind = (kind: RoomKind, over: Partial<FloorRunState> = {}): GameSnapshot => snapshot({
  floor: floor({ map: [{ roomId: 'r1', cell: { x: 0, y: 0 }, state: 'visited', kind, cleared: false, doors: [] }], ...over }),
});

describe('hub lessons', () => {
  const hq = (over: Parameters<typeof context>[0] = {}) => context({
    model: uiModel({ phase: 'headquarters', ...(over.model ? {} : {}) }),
    snapshot: snapshot({ phase: 'headquarters', worldId: null, roomId: null, roomIndex: null }),
    ...over,
  });

  it('hub.move waits 1.5 s and goes away once the operative walks', () => {
    expect(lesson('hub.move').trigger(hq({ phaseMs: 1000 }))).toBe(false);
    expect(lesson('hub.move').trigger(hq({ phaseMs: 2000 }))).toBe(true);
    expect(lesson('hub.move').trigger(hq({ phaseMs: 2000, facts: { moved: true } }))).toBe(false);
    expect(lesson('hub.move').satisfied?.(hq({ facts: { moved: true } }))).toBe(true);
  });

  it('hub.weapon waits for movement, or twelve seconds of standing still', () => {
    expect(lesson('hub.weapon').trigger(hq({ phaseMs: 3000 }))).toBe(false);
    expect(lesson('hub.weapon').trigger(hq({ phaseMs: 3000, facts: { moved: true } }))).toBe(true);
    expect(lesson('hub.weapon').trigger(hq({ phaseMs: 13_000 }))).toBe(true);
    expect(lesson('hub.weapon').trigger(hq({ phaseMs: 13_000, facts: { tookWeapon: true } }))).toBe(false);
  });

  it('hub.idea follows the weapon and ends on a contribution', () => {
    expect(lesson('hub.idea').trigger(hq({ phaseMs: 3000, facts: { tookWeapon: true } }))).toBe(true);
    expect(lesson('hub.idea').trigger(hq({ phaseMs: 3000, facts: { tookWeapon: true, contributed: true } }))).toBe(false);
    expect(lesson('hub.idea').satisfied?.(hq({ facts: { contributed: true } }))).toBe(true);
  });

  it('hub.prepare is host-only and stops once a world exists', () => {
    const ready = { phaseMs: 3000, facts: { tookWeapon: true, contributed: true } } as const;
    expect(lesson('hub.prepare').trigger(hq(ready))).toBe(true);
    expect(lesson('hub.prepare').trigger(hq({ ...ready, isHost: false }))).toBe(false);
  });

  it('hub.gate appears only once a world is prepared', () => {
    expect(lesson('hub.gate').trigger(hq())).toBe(false);
    expect(lesson('hub.gate').trigger(context({ model: worldModel('headquarters') }))).toBe(true);
  });

  it('hub.guest only speaks to a co-op guest, and only once their own part is done', () => {
    const done = { phaseMs: 3000, facts: { contributed: true } } as const;
    expect(lesson('hub.guest').trigger(hq(done))).toBe(false); // solo
    expect(lesson('hub.guest').trigger(hq({ ...done, isCoOp: true, isHost: true }))).toBe(false); // the host
    expect(lesson('hub.guest').trigger(hq({ phaseMs: 3000, isCoOp: true, isHost: false }))).toBe(false); // too early
    expect(lesson('hub.guest').trigger(hq({ ...done, isCoOp: true, isHost: false }))).toBe(true);
  });

  it('a guest is never told to prepare a world or to open the gate', () => {
    const guest = { isCoOp: true, isHost: false, phaseMs: 3000, facts: { tookWeapon: true, contributed: true } } as const;
    expect(lesson('hub.prepare').trigger(hq(guest))).toBe(false);
    expect(lesson('hub.gate').trigger(context({ model: worldModel('headquarters'), isCoOp: true, isHost: false }))).toBe(false);
  });

  it('hub.receipt waits for a world to exist, not for the one-tick event', () => {
    expect(lesson('hub.receipt').trigger(hq())).toBe(false);
    expect(lesson('hub.receipt').trigger(context({ model: worldModel('headquarters') }))).toBe(true);
    // Out in the run there is no receipt on screen to point at.
    expect(lesson('hub.receipt').trigger(context({ model: worldModel('expedition') }))).toBe(false);
  });
});

describe('control lessons', () => {
  it('run.attack needs a live hostile and stops on the first swing', () => {
    expect(lesson('run.attack').trigger(context({ snapshot: snapshot({ enemies: [] }) }))).toBe(false);
    expect(lesson('run.attack').trigger(context({ snapshot: snapshot({ enemies: [husk()] }) }))).toBe(true);
    expect(lesson('run.attack').trigger(context({ snapshot: snapshot({ enemies: [husk({ state: 'dead' })] }) }))).toBe(false);
    expect(lesson('run.attack').trigger(context({ snapshot: snapshot({ enemies: [husk()] }), facts: { attacked: true } }))).toBe(false);
  });

  it('run.dash is adaptive: it waits for the player to take a hit', () => {
    expect(lesson('run.dash').trigger(context({}))).toBe(false);
    expect(lesson('run.dash').trigger(context({ facts: { tookDamage: true } }))).toBe(true);
    expect(lesson('run.dash').trigger(context({ facts: { tookDamage: true, dashed: true } }))).toBe(false);
    expect(lesson('run.dash').satisfied?.(context({ facts: { dashed: true } }))).toBe(true);
  });

  it('run.ability_q waits for the first cleared room', () => {
    expect(lesson('run.ability_q').trigger(context({}))).toBe(false);
    expect(lesson('run.ability_q').trigger(context({ facts: { roomsCleared: 1 } }))).toBe(true);
    expect(lesson('run.ability_q').trigger(context({ facts: { roomsCleared: 1, usedQ: true } }))).toBe(false);
  });

  it('run.unlock_e waits until the unlock is affordable and E is still locked', () => {
    const hud = (resources: number, abilityEUnlocked = false) => uiModel({
      hud: { hp: 1, maxHp: 1, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 0, resources, abilityEUnlocked },
    });
    const cleared = { roomsCleared: 1 };
    expect(lesson('run.unlock_e').trigger(context({ model: hud(ABILITY_UNLOCK_COST - 1), facts: cleared }))).toBe(false);
    expect(lesson('run.unlock_e').trigger(context({ model: hud(ABILITY_UNLOCK_COST), facts: cleared }))).toBe(true);
    expect(lesson('run.unlock_e').trigger(context({ model: hud(ABILITY_UNLOCK_COST, true), facts: cleared }))).toBe(false);
    // Affordable from the start of a run; it still waits for the first cleared room.
    expect(lesson('run.unlock_e').trigger(context({ model: hud(ABILITY_UNLOCK_COST) }))).toBe(false);
  });

  it('run.ability_r waits for a full ultimate charge', () => {
    const charged = (ultCharge: number) => uiModel({
      hud: { hp: 1, maxHp: 1, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 0, ultCharge },
    });
    expect(lesson('run.ability_r').trigger(context({ model: charged(99) }))).toBe(false);
    expect(lesson('run.ability_r').trigger(context({ model: charged(100) }))).toBe(true);
    expect(lesson('run.ability_r').trigger(context({ model: charged(100), facts: { usedR: true } }))).toBe(false);
  });

  it('run.map waits for the third room of a floors run', () => {
    const floors = uiModel({ floor: { run: floor(), biomeName: 'b', biomeTagline: '', pathNames: ['b'], depth: 1, depthCount: 5, roomCount: 10, roomsVisited: 1, choice: null } });
    expect(lesson('run.map').trigger(context({ model: floors, facts: { roomsEntered: 2 } }))).toBe(false);
    expect(lesson('run.map').trigger(context({ model: floors, facts: { roomsEntered: 3 } }))).toBe(true);
    expect(lesson('run.map').trigger(context({ facts: { roomsEntered: 3 } }))).toBe(false);
    expect(lesson('run.map').trigger(context({ model: floors, facts: { roomsEntered: 3, openedMap: true } }))).toBe(false);
  });

  it('coop.revive needs a downed teammate and a standing local player', () => {
    const down = snapshot({ players: [player(ME), player(MATE, { state: 'down' })] });
    expect(lesson('coop.revive').trigger(context({ snapshot: down, facts: { teammateDown: true } }))).toBe(true);
    const bothDown = snapshot({ players: [player(ME, { state: 'down' }), player(MATE, { state: 'down' })] });
    expect(lesson('coop.revive').trigger(context({ snapshot: bothDown, facts: { teammateDown: true } }))).toBe(false);
    expect(lesson('coop.revive').satisfied?.(context({ facts: { revivedSomeone: true } }))).toBe(true);
  });
});

describe('first-encounter notes', () => {
  it('note.doors fires while a room is sealed', () => {
    expect(lesson('note.doors').trigger(context({ snapshot: snapshot({ floor: floor({ doorsLocked: true }) }) }))).toBe(true);
    expect(lesson('note.doors').trigger(context({ snapshot: snapshot({ floor: floor() }) }))).toBe(false);
  });

  it('a room-kind note fires on the kind it names, and no other', () => {
    for (const kind of ['rest', 'treasure', 'lore', 'elite', 'exit'] as const) {
      expect(lesson(`note.room.${kind}`).trigger(context({ snapshot: inRoomOfKind(kind) }))).toBe(true);
      expect(lesson(`note.room.${kind}`).trigger(context({ snapshot: inRoomOfKind('combat') }))).toBe(false);
    }
    expect(currentRoomKind(context({ snapshot: inRoomOfKind('rest') }))).toBe('rest');
    expect(currentRoomKind(context({ snapshot: snapshot() }))).toBeNull();
  });

  it('note.choice covers the gap between clearing the exit room and opening the door panel', () => {
    const cleared = inRoomOfKind('exit');
    expect(lesson('note.choice').trigger(context({ snapshot: cleared }))).toBe(true);
    const sealed = inRoomOfKind('exit', { doorsLocked: true });
    expect(lesson('note.choice').trigger(context({ snapshot: sealed }))).toBe(false);
    const choosing = inRoomOfKind('exit', { biomeChoice: { fromBiomeId: 'b1', options: ['b2'], votes: {}, hostPlayerId: null, chosenBiomeId: null } });
    expect(lesson('note.choice').trigger(context({ snapshot: choosing }))).toBe(false);
  });

  it('note.gatekeeper fires on a boss-shaped guardian outside the Anchor room', () => {
    const guardian = husk({ enemyId: 'guardian', bossPhase: 1 });
    expect(lesson('note.gatekeeper').trigger(context({ snapshot: snapshot({ floor: floor(), enemies: [guardian] }) }))).toBe(true);
    const anchored = snapshot({ floor: floor(), enemies: [guardian], anchor: { x: 0, y: 0, state: 'dormant', progress: 0 } });
    expect(lesson('note.gatekeeper').trigger(context({ snapshot: anchored }))).toBe(false);
  });

  it('the terrain note for a feature reads the room\'s own tiles', () => {
    expect(lesson('note.terrain.pits').trigger(context({ terrainHere: ['pits'] }))).toBe(true);
    expect(lesson('note.terrain.pits').trigger(context({ terrainHere: ['vents'] }))).toBe(false);
    const text = lesson('note.terrain.pits').text as (ctx: LessonContext) => string;
    expect(text(context({ terrainHere: ['pits'] }))).toBe('Open pit: dash across, or knock something in');
  });

  it('only announces a law the simulation actually applies', () => {
    const withLaw = (active: boolean) => uiModel({
      world: {
        worldId: 'w', title: 't', tagline: '', themeSummary: '',
        provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
        receipt: { source: 'fixture', worldTitle: 't', headline: '', lines: [] },
        committedRoomCount: 1, plannedRoomCount: 1, lore: [], attunements: [],
        laws: [{ lawId: 'thin_air', name: 'Thin Air', description: '', effect: 'Movement speed +20%.', active }],
      },
    });
    expect(lesson('note.law.thin_air').trigger(context({ model: withLaw(true) }))).toBe(true);
    expect(lesson('note.law.thin_air').trigger(context({ model: withLaw(false) }))).toBe(false);
    const text = lesson('note.law.thin_air').text as (ctx: LessonContext) => string | null;
    expect(text(context({ model: withLaw(true) }))).toBe('Thin Air: Movement speed +20%.');
    expect(text(context({ model: withLaw(false) }))).toBeNull();
  });

  it('the finale notes follow the collapse clock', () => {
    const stage = (s: 'collapse' | 'extraction') => snapshot({
      collapse: { stage: s, remainingMs: 1000, totalMs: 2000, ringDepth: 0, portalRoomId: 'p', lostRoomIds: [], offer: [], chosenKey: null },
    });
    expect(lesson('note.collapse').trigger(context({ snapshot: stage('collapse') }))).toBe(true);
    expect(lesson('note.collapse').trigger(context({ snapshot: stage('extraction') }))).toBe(false);
    expect(lesson('note.relic').trigger(context({ snapshot: stage('extraction') }))).toBe(true);
  });
});

describe('context helpers', () => {
  it('reads the distinct terrain features out of a tile grid', () => {
    const room = { tiles: ['###', '#~#', '#o#', '#*#'] } as never;
    expect(terrainFeaturesOf(room).sort()).toEqual(['canisters', 'hazard_floor', 'pits']);
    expect(terrainFeaturesOf(null)).toEqual([]);
  });

  it('blocks a prompt during a telegraph, a live boss pattern, a lit fuse and an overlay', () => {
    const model = uiModel();
    const base = snapshot({ enemies: [husk()] });
    expect(isBlocked(base, model, ME, false)).toBe(false);
    expect(isBlocked(base, model, ME, true)).toBe(true);
    // A wind-up that can reach the operative (who stands at 100,100) blocks...
    const near = snapshot({ enemies: [husk({ telegraph: { kind: 'melee', x: 130, y: 100, facing: 0, range: 40, arcRad: 1, remainingMs: 200 } })] });
    expect(isBlocked(near, model, ME, false)).toBe(true);
    // ...one across the room does not, or a busy room would never let the layer speak.
    const far = snapshot({ enemies: [husk({ telegraph: { kind: 'melee', x: 900, y: 900, facing: 0, range: 40, arcRad: 1, remainingMs: 200 } })] });
    expect(isBlocked(far, model, ME, false)).toBe(false);
    const boss = snapshot({ bossField: { patternId: null, tiles: [], live: true, remainingMs: 100, corrupted: [] } });
    expect(isBlocked(boss, model, ME, false)).toBe(true);
    // The operative stands at 100,100 = tile 3,3; a fuse on the next tile is a reason to shut up.
    const fuse = snapshot({ terrain: { brokenWalls: [], wallDamage: {}, canisters: { '3,4': { fuseMs: 200, depth: 0 } } } });
    expect(isBlocked(fuse, model, ME, false)).toBe(true);
    const farFuse = snapshot({ terrain: { brokenWalls: [], wallDamage: {}, canisters: { '30,30': { fuseMs: 200, depth: 0 } } } });
    expect(isBlocked(farFuse, model, ME, false)).toBe(false);
    const downed = snapshot({ players: [player(ME, { state: 'down' })] });
    expect(isBlocked(downed, model, ME, false)).toBe(true);
    expect(isBlocked(base, uiModel({ phase: 'debrief' }), ME, false)).toBe(true);
  });

  it('reads the hint flags off the URL', () => {
    expect(parseHintFlags('')).toEqual({ off: false, reset: false });
    expect(parseHintFlags('?hints=off')).toEqual({ off: true, reset: false });
    expect(parseHintFlags('?world=fixture&hints=reset')).toEqual({ off: false, reset: true });
  });
});
