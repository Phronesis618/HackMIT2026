/**
 * S1 — attunements and the skill tree are real. One sim test per effect with the exact
 * numbers `ATTUNEMENT_EFFECT_INFO` promises, the purchase flow, determinism, and the
 * byte-identical guarantee for a crew that bought nothing.
 *
 * Every effect test runs the same scenario twice — a plain operative and one who bought the
 * node — and asserts the exact relation between the two. That keeps the tests true under
 * world laws and tier scaling without hard-coding every intermediate multiplier.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type Attunement, type GameEvent, type PlayerIntent, type RoomEncounter, type RoomSpec,
} from '../../src/shared/contracts';
import { ABILITY_UNLOCK_COST, ANCHOR_HOLD_MS, DASH_COOLDOWN_MS, LORE_READ_MS, ROOM_CLEAR_REWARD, TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { ATTUNEMENT_EFFECT_IDS, ATTUNEMENT_EFFECT_INFO, type AttunementEffectId } from '../../src/shared/registry';
import { TERRAIN_DAMAGE_SOURCE } from '../../src/shared/terrain';
import { buildSkillTree, skillPurchaseCheck } from '../../src/shared/skills';
import {
  ANCHOR_GRACE_MUL, BOLT_WARD_MUL, CLEAR_SURGE_HASTE_MS, DASH_TRAIL_DAMAGE, DASH_TRAIL_MS, DASH_TRAIL_TICK_MS, FIRST_STRIKE_MUL,
  GUARDIAN_BANE_MUL, HASTE_ATTACK_COOLDOWN_MUL, HASTE_MOVE_MUL, HAZARD_WARD_MUL, MELEE_WARD_MUL, NO_EFFECTS, RELIC_MEND_HP,
  REMAINS_CHARGE, anchorRateMul, effectsFor, incomingDamageMul, outgoingDamageMul,
} from '../../src/sim/effects';
import { createSimulation, type Simulation } from '../../src/sim';

// The fixture's own world laws are stripped: these cases measure one attunement effect against
// the base rules, and vantage-spire really runs the_many/committed_strike/thin_air.
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };
const P1 = 'op-a';
const P2 = 'op-b';

/** Every attunement the registry knows, named in one made-up world's voice. */
const ALL_ATTUNEMENTS: Attunement[] = ATTUNEMENT_EFFECT_IDS.map((effectId) => ({
  effectId, name: `Test ${effectId}`, description: `Test boon ${effectId}.`,
}));

function attunementsFor(ids: AttunementEffectId[]): Attunement[] {
  return ids.map((id) => ALL_ATTUNEMENTS.find((a) => a.effectId === id)!);
}

/** The node id the tree gives the i-th attunement of a world. */
const nodeFor = (ids: AttunementEffectId[], id: AttunementEffectId) => `attune.${ids.indexOf(id)}.${id}`;

interface RoomOptions {
  encounters?: RoomEncounter[];
  hazard?: Array<[number, number]>;
  relics?: Array<{ x: number; y: number; fragmentIndex: number }>;
  isFinal?: boolean;
  spawn?: [number, number];
}

/** 26x16 arena; spawn (5,7); exit east; Anchor at (13,7) when final. */
function arena(index: number, options: RoomOptions = {}): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  const [sx, sy] = options.spawn ?? [5, 7];
  tiles[sy]![sx] = 'P';
  for (const [x, y] of options.hazard ?? []) tiles[y]![x] = '~';
  if (options.isFinal) tiles[7]![13] = 'A';
  else tiles[7]![24] = 'X';
  return RoomSpecSchema.parse({
    id: `arena-${index}`, index, name: `Arena ${index}`, description: '', width: 26, height: 16,
    tiles: tiles.map((row) => row.join('')), encounters: options.encounters ?? [], props: [], attributions: [],
    relics: (options.relics ?? []).map((r, i) => ({ id: `relic-${index}-${i}`, ...r })),
    exits: options.isFinal ? [] : [{ x: 24, y: 7, toRoomIndex: (index + 1) % 3, direction: 'east' }],
    isFinal: options.isFinal ?? false,
  });
}

/** Room 0 is an empty pay-room (stepping into it clears it for ROOM_CLEAR_REWARD); the test room is 1; room 2 is the final. */
const PAY_ROOMS = 1;

function world(testRooms: RoomOptions[], attunements: Attunement[]) {
  const rooms = [arena(0), ...testRooms.map((options, i) => arena(PAY_ROOMS + i, options))];
  if (rooms.length < 3) rooms.push(arena(2, { isFinal: true, encounters: [{ id: 'gate', enemyId: 'guardian', x: 10, y: 7, count: 1 }] }));
  return PreparedWorldSchema.parse({
    worldId: 'effects-world', createdAt: 0, recipe: { ...fixture.recipe, attunements }, art: fixture.art, rooms,
    plannedRoomCount: rooms.length,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Effects arena', lines: [] },
  });
}

function me(sim: Simulation, id = P1) {
  return sim.getSnapshot().players.find((p) => p.id === id)!;
}

function input(sim: Simulation, partial: Partial<PlayerIntent> = {}, id = P1) {
  const p = me(sim, id);
  sim.applyIntent({
    playerId: id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: p.x + 100, aimY: p.y,
    attack: false, dash: false, ability: null, interact: false, ...partial,
  });
}

function frames(sim: Simulation, count: number, partial?: Partial<PlayerIntent>): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    if (partial) input(sim, partial);
    events.push(...sim.step());
  }
  return events;
}

function walkTo(sim: Simulation, x: number, y: number, extra: Partial<PlayerIntent> = {}, id = P1) {
  for (let i = 0; i < 900; i++) {
    const p = me(sim, id);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= 5) return;
    input(sim, { moveX: (x - p.x) / d, moveY: (y - p.y) / d, aimX: x, aimY: y, ...extra }, id);
    sim.step();
  }
  throw new Error('walk did not reach target');
}

/** Empty rooms clear on the first step; each one pays the crew. */
function earn(sim: Simulation, rooms: number) {
  for (let i = 0; i < rooms; i++) {
    sim.enterRoom(i);
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'room_cleared' }));
  }
}

/**
 * A sim with `players` in a world whose attunements are `ids`; `buy` lists the node ids P1
 * buys after earning enough. Ends inside test room 0 (`PAY_ROOMS`).
 */
function scenario(rooms: RoomOptions[], ids: AttunementEffectId[], buy: string[], players: string[] = [P1], classId: 'bastion' | 'beacon' = 'bastion') {
  const sim = createSimulation();
  for (const id of players) sim.addPlayer({ id, displayName: id, classId });
  sim.setWorld(world(rooms, attunementsFor(ids)));
  earn(sim, PAY_ROOMS);
  for (const node of buy) expect(sim.purchaseSkill(P1, node), `buy ${node}`).toBe(true);
  sim.enterRoom(PAY_ROOMS);
  return sim;
}

/** Runs one scenario plain and once with the nodes bought. */
function pair(rooms: RoomOptions[], ids: AttunementEffectId[], buy: string[], players?: string[], classId?: 'bastion' | 'beacon') {
  return { plain: scenario(rooms, ids, [], players, classId), boosted: scenario(rooms, ids, buy, players, classId) };
}

const husk = (x: number, y = 7, id = 'husk'): RoomEncounter => ({ id, enemyId: 'husk', x, y, count: 1 });

function firstPlayerHit(sim: Simulation, from: (e: Extract<GameEvent, { type: 'player_damaged' }> & { sourceEnemyId: string }) => boolean, max = 1200, drive: Partial<PlayerIntent> = {}): number {
  for (let i = 0; i < max; i++) {
    for (const e of frames(sim, 1, drive)) {
      if (e.type === 'player_damaged' && e.playerId === P1 && e.sourceEnemyId !== null && from({ ...e, sourceEnemyId: e.sourceEnemyId })) return e.amount;
    }
  }
  throw new Error('player was never hit');
}

describe('effectsFor', () => {
  it('resolves nothing for a fresh operative and exactly the bought, implemented effects otherwise', () => {
    const ids: AttunementEffectId[] = ['hazard_ward', 'relic_mend'];
    const ctx = { title: 'T', attunements: attunementsFor(ids) };
    expect(effectsFor({ classId: 'bastion' }, ctx)).toBe(NO_EFFECTS);
    expect(effectsFor({ classId: 'bastion', skillNodeIds: [] }, ctx)).toBe(NO_EFFECTS);
    const fx = effectsFor({ classId: 'bastion', skillNodeIds: ['core.salvage', 'attune.1.relic_mend', 'core.plating'] }, ctx);
    expect([...fx.ids].sort()).toEqual(['relic_mend', 'salvage_bonus']);
    // Owning a node from a different world's tree, or a planned node, grants nothing.
    expect(effectsFor({ classId: 'bastion', skillNodeIds: ['attune.0.dash_echo', 'core.plating'] }, ctx)).toBe(NO_EFFECTS);
    expect(effectsFor({ classId: 'bastion', skillNodeIds: ['attune.0.hazard_ward'] }, null)).toBe(NO_EFFECTS);
  });

  it('every attunement in the registry is implemented and carries its own number in its summary', () => {
    const numbers: Record<AttunementEffectId, string> = {
      hazard_ward: '40%', bolt_ward: '25%', melee_ward: '25%', relic_mend: '25 Integrity', remains_charge: '40 ultimate',
      clear_surge: '4 seconds', first_strike: 'double', guardian_bane: '20%', dash_echo: '8 per second', anchor_grace: 'half',
    };
    for (const id of ATTUNEMENT_EFFECT_IDS) {
      expect(ATTUNEMENT_EFFECT_INFO[id].status, id).toBe('implemented');
      expect(ATTUNEMENT_EFFECT_INFO[id].summary, id).toContain(numbers[id]);
    }
    expect(HAZARD_WARD_MUL).toBe(0.6);
    expect(BOLT_WARD_MUL).toBe(0.75);
    expect(MELEE_WARD_MUL).toBe(0.75);
    expect(RELIC_MEND_HP).toBe(25);
    expect(REMAINS_CHARGE).toBe(40);
    expect(CLEAR_SURGE_HASTE_MS).toBe(4000);
    expect(FIRST_STRIKE_MUL).toBe(2);
    expect(GUARDIAN_BANE_MUL).toBe(1.2);
    expect(DASH_TRAIL_MS).toBe(1500);
    expect(DASH_TRAIL_DAMAGE / (DASH_TRAIL_TICK_MS / 1000)).toBe(8);
    expect(ANCHOR_GRACE_MUL).toBe(2);
  });

  it('classifies every damage source: all terrain and the collapse are hazard, bolts are ranged, the rest melee', () => {
    const ctx = { title: 'T', attunements: attunementsFor(['hazard_ward', 'bolt_ward', 'melee_ward']) };
    const all = effectsFor({ classId: 'bastion', skillNodeIds: ['core.salvage', 'attune.0.hazard_ward', 'attune.1.bolt_ward', 'attune.2.melee_ward'] }, ctx);
    for (const source of Object.values(TERRAIN_DAMAGE_SOURCE)) expect(incomingDamageMul(all, source, false), source).toBe(0.6);
    expect(incomingDamageMul(all, 'collapse', false)).toBe(0.6);
    expect(incomingDamageMul(all, 'sentinel-0', true)).toBe(0.75);
    expect(incomingDamageMul(all, 'husk-0', false)).toBe(0.75);
    expect(incomingDamageMul(all, 'anchor-pulse', false)).toBe(1);
    expect(incomingDamageMul(NO_EFFECTS, 'terrain:hazard', false)).toBe(1);
    // The Custodian's flood and corrupted floor hit under the boss's own id, flagged as floor:
    // hazard_ward covers them, and melee_ward must not stack a second reduction on top.
    expect(incomingDamageMul(all, 'custodian-0', false, 'terrain')).toBe(0.6);
    const meleeOnly = effectsFor({ classId: 'bastion', skillNodeIds: ['attune.2.melee_ward'] }, ctx);
    expect(incomingDamageMul(meleeOnly, 'custodian-0', false)).toBe(0.75);
    expect(incomingDamageMul(meleeOnly, 'custodian-0', false, 'terrain')).toBe(1);
    const bane = effectsFor({ classId: 'bastion', skillNodeIds: ['core.salvage', 'attune.0.guardian_bane', 'attune.1.first_strike'] },
      { title: 'T', attunements: attunementsFor(['guardian_bane', 'first_strike']) });
    expect(outgoingDamageMul(bane, { enemyId: 'guardian', hp: 100, maxHp: 100 })).toBe(2.4);
    expect(outgoingDamageMul(bane, { enemyId: 'guardian', hp: 99, maxHp: 100 })).toBe(1.2);
    expect(outgoingDamageMul(bane, { enemyId: 'husk', hp: 99, maxHp: 100 })).toBe(1);
    expect(anchorRateMul([NO_EFFECTS, bane])).toBe(1);
    expect(anchorRateMul([NO_EFFECTS, effectsFor({ classId: 'bastion', skillNodeIds: ['core.salvage', 'attune.0.anchor_grace'] },
      { title: 'T', attunements: attunementsFor(['anchor_grace']) })])).toBe(2);
  });
});

describe('attunement effects in the simulation', () => {
  const buyFirst = (ids: AttunementEffectId[], id: AttunementEffectId) => ['core.salvage', nodeFor(ids, id)];

  it('hazard_ward: a hazard floor burns for 40% less', () => {
    const ids: AttunementEffectId[] = ['hazard_ward'];
    const rooms = [{ hazard: [[6, 7], [7, 7], [8, 7]] as Array<[number, number]> }];
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'hazard_ward'));
    const burn = (sim: Simulation) => firstPlayerHit(sim, (e) => e.sourceEnemyId === TERRAIN_DAMAGE_SOURCE.hazard, 600, { moveX: 1 });
    const base = burn(plain);
    expect(base).toBeGreaterThan(0);
    expect(burn(boosted)).toBe(Math.round(base * HAZARD_WARD_MUL));
  });

  it('bolt_ward: an enemy bolt hits for 25% less', () => {
    const ids: AttunementEffectId[] = ['bolt_ward'];
    const rooms = [{ encounters: [{ id: 'sentinel', enemyId: 'sentinel' as const, x: 11, y: 7, count: 1 }] }];
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'bolt_ward'));
    const hit = (sim: Simulation) => firstPlayerHit(sim, (e) => e.sourceEnemyId.startsWith('sentinel'), 1500);
    const base = hit(plain);
    expect(base).toBeGreaterThan(0);
    expect(hit(boosted)).toBe(Math.round(base * BOLT_WARD_MUL));
  });

  it('melee_ward: a melee swing hits for 25% less', () => {
    const ids: AttunementEffectId[] = ['melee_ward'];
    const rooms = [{ encounters: [husk(6)] }];
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'melee_ward'));
    const hit = (sim: Simulation) => firstPlayerHit(sim, (e) => e.sourceEnemyId.startsWith('husk'), 600);
    const base = hit(plain);
    expect(base).toBeGreaterThan(0);
    expect(hit(boosted)).toBe(Math.round(base * MELEE_WARD_MUL));
  });

  it('relic_mend: reading a relic restores exactly 25 Integrity', () => {
    const ids: AttunementEffectId[] = ['relic_mend'];
    const relicIndex = fixture.recipe.lore.findIndex((f) => f.kind === 'relic');
    const rooms = [{ hazard: [[6, 7], [7, 7], [8, 7]] as Array<[number, number]>, relics: [{ x: 12, y: 7, fragmentIndex: relicIndex }] }];
    const read = (sim: Simulation) => {
      // Stand in the fire until well below full, then read the relic in peace.
      const band = tileToWorld(7, 7);
      walkTo(sim, band.x, band.y);
      for (let i = 0; i < 1200 && me(sim).hp > me(sim).maxHp - 2 * RELIC_MEND_HP; i++) frames(sim, 1);
      expect(me(sim).hp).toBeLessThanOrEqual(me(sim).maxHp - 2 * RELIC_MEND_HP);
      const target = tileToWorld(12, 7);
      walkTo(sim, target.x - 30, target.y);
      frames(sim, 30); // let the burn clock and hit state settle
      const before = me(sim).hp;
      const events = frames(sim, Math.ceil(LORE_READ_MS / TICK_MS) + 5, { interact: true, aimX: target.x, aimY: target.y });
      expect(events.some((e) => e.type === 'lore_discovered' && e.kind === 'relic')).toBe(true);
      return me(sim).hp - before;
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'relic_mend'));
    expect(read(plain)).toBe(0);
    expect(read(boosted)).toBe(RELIC_MEND_HP);
  });

  it('remains_charge: recovering remains adds exactly 40 ultimate charge', () => {
    const ids: AttunementEffectId[] = ['remains_charge'];
    const rooms = [{ encounters: [husk(6)] }];
    // The husk falls within touch range, so its remains are recovered the tick they drop;
    // both runs are otherwise identical, so the gap between them is the remains alone.
    const recover = (sim: Simulation) => {
      const before = me(sim).ultCharge!;
      const events = frames(sim, 40, { attack: true, aimX: me(sim).x + 40 });
      expect(events.some((e) => e.type === 'enemy_defeated')).toBe(true);
      expect(events.some((e) => e.type === 'lore_discovered' && e.kind === 'remains')).toBe(true);
      return me(sim).ultCharge! - before;
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'remains_charge'));
    expect(recover(boosted) - recover(plain)).toBe(REMAINS_CHARGE);
  });

  it('clear_surge: clearing a room grants 4 s of haste — 30% faster, attacks 20% sooner — then nothing', () => {
    const ids: AttunementEffectId[] = ['clear_surge'];
    const rooms = [{ encounters: [husk(6)] }];
    const stride = (sim: Simulation) => {
      const x0 = me(sim).x;
      frames(sim, 1, { moveX: 1 });
      return me(sim).x - x0;
    };
    const clear = (sim: Simulation) => {
      const events = frames(sim, 40, { attack: true, aimX: me(sim).x + 40 });
      expect(events.some((e) => e.type === 'room_cleared')).toBe(true);
      frames(sim, 30); // attack recovery
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'clear_surge'));
    clear(plain);
    clear(boosted);
    const walk = stride(plain);
    expect(stride(boosted)).toBeCloseTo(walk * HASTE_MOVE_MUL, 6);
    frames(plain, 1, { attack: true });
    frames(boosted, 1, { attack: true });
    expect(me(boosted).attackCooldownMs).toBeCloseTo(me(plain).attackCooldownMs * HASTE_ATTACK_COOLDOWN_MUL, 6);
    frames(plain, Math.ceil(CLEAR_SURGE_HASTE_MS / TICK_MS));
    frames(boosted, Math.ceil(CLEAR_SURGE_HASTE_MS / TICK_MS));
    expect(stride(boosted)).toBeCloseTo(stride(plain), 6);
  });

  it('first_strike: the opening hit on an untouched enemy deals double, the next does not', () => {
    const ids: AttunementEffectId[] = ['first_strike'];
    const rooms = [{ encounters: [{ id: 'sentinel', enemyId: 'sentinel' as const, x: 6, y: 7, count: 1 }] }];
    const hits = (sim: Simulation) => {
      const amounts: number[] = [];
      for (let i = 0; i < 60 && amounts.length < 2; i++) {
        for (const e of frames(sim, 1, { attack: true, aimX: me(sim).x + 40 })) if (e.type === 'enemy_damaged') amounts.push(e.amount);
      }
      return amounts;
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'first_strike'));
    const [first, second] = hits(plain);
    const [firstBoosted, secondBoosted] = hits(boosted);
    expect(firstBoosted).toBe(Math.round(first! * FIRST_STRIKE_MUL));
    expect(secondBoosted).toBe(second);
  });

  it('guardian_bane: a gatekeeper-grade Guardian takes 20% more from you; a husk does not', () => {
    const ids: AttunementEffectId[] = ['guardian_bane'];
    const rooms = [{ encounters: [{ id: 'gate', enemyId: 'guardian' as const, x: 7, y: 7, count: 1 }, husk(5, 9)] }];
    const firstHit = (sim: Simulation, enemyId: string, aim: { x: number; y: number }) => {
      for (let i = 0; i < 60; i++) {
        for (const e of frames(sim, 1, { attack: true, aimX: aim.x, aimY: aim.y })) if (e.type === 'enemy_damaged' && e.enemyId === enemyId) return e.amount;
      }
      throw new Error(`never hit ${enemyId}`);
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'guardian_bane'));
    const guardian = plain.getSnapshot().enemies.find((e) => e.enemyId === 'guardian')!;
    const base = firstHit(plain, guardian.id, guardian);
    expect(firstHit(boosted, guardian.id, guardian)).toBe(Math.round(base * GUARDIAN_BANE_MUL));
    const h = plain.getSnapshot().enemies.find((e) => e.enemyId === 'husk')!;
    frames(plain, 30); frames(boosted, 30);
    expect(firstHit(boosted, h.id, h)).toBe(firstHit(plain, h.id, h));
  });

  it('dash_echo: the dash leaves a trail that burns 8 per second for 1.5 s; the husk it passes takes it', () => {
    const ids: AttunementEffectId[] = ['dash_echo'];
    const rooms = [{ encounters: [husk(7, 7)] }];
    const burn = (sim: Simulation) => {
      const events = frames(sim, 1, { dash: true, moveX: 1 });
      expect(events.some((e) => e.type === 'player_dashed')).toBe(true);
      const ticks = Math.ceil(DASH_TRAIL_MS / TICK_MS) + 20;
      return frames(sim, ticks).filter((e): e is Extract<GameEvent, { type: 'enemy_damaged' }> => e.type === 'enemy_damaged' && e.byPlayerId === P1);
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'dash_echo'));
    expect(burn(plain)).toEqual([]);
    const hits = burn(boosted);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(DASH_TRAIL_MS / DASH_TRAIL_TICK_MS);
    for (const hit of hits) expect(hit.amount).toBe(DASH_TRAIL_DAMAGE);
  });

  it('anchor_grace: the Anchor plants in half the ticks', () => {
    const ids: AttunementEffectId[] = ['anchor_grace'];
    const rooms: RoomOptions[] = [{}, { isFinal: true, encounters: [husk(20, 12, 'gate')], spawn: [12, 7] }];
    const plant = (sim: Simulation) => {
      expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'room_cleared' })); // the empty room 1 pays out
      sim.enterRoom(2);
      // A final room always holds a Guardian; the crew must clear before the Anchor listens.
      for (let i = 0; i < 6000 && !sim.getSnapshot().roomCleared; i++) {
        const p = me(sim);
        const enemy = sim.getSnapshot().enemies.filter((e) => e.hp > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (!enemy) { sim.step(); continue; }
        const d = Math.hypot(enemy.x - p.x, enemy.y - p.y);
        input(sim, { aimX: enemy.x, aimY: enemy.y, moveX: d > 40 ? (enemy.x - p.x) / d : 0, moveY: d > 40 ? (enemy.y - p.y) / d : 0, attack: true, ability: p.abilityQCooldownMs === 0 ? 'q' : null });
        sim.step();
      }
      expect(sim.getSnapshot().roomCleared).toBe(true);
      expect(sim.getPhase(), `hp ${me(sim).hp}`).toBe('expedition');
      const anchor = sim.getSnapshot().anchor!;
      walkTo(sim, anchor.x - 20, anchor.y);
      frames(sim, 30);
      let ticks = 0;
      for (; ticks < 400 && sim.getPhase() === 'expedition'; ticks++) frames(sim, 1, { interact: true, aimX: anchor.x, aimY: anchor.y });
      expect(sim.getSnapshot().anchor!.state).toBe('planted');
      return ticks;
    };
    const { plain, boosted } = pair(rooms, ids, buyFirst(ids, 'anchor_grace'));
    const full = plant(plain);
    expect(full).toBe(Math.ceil(ANCHOR_HOLD_MS / TICK_MS));
    expect(plant(boosted)).toBe(Math.ceil(ANCHOR_HOLD_MS / ANCHOR_GRACE_MUL / TICK_MS));
  });

  it('core nodes: Second Wind shortens the dash cooldown 25%; Salvager pays 1 more per clear', () => {
    const { plain, boosted } = pair([{ encounters: [husk(6)] }], [], ['core.wind', 'core.salvage']);
    frames(plain, 1, { dash: true, moveX: -1 });
    frames(boosted, 1, { dash: true, moveX: -1 });
    expect(me(plain).dashCooldownMs).toBeGreaterThan(0);
    expect(me(boosted).dashCooldownMs).toBeCloseTo(me(plain).dashCooldownMs * 0.75, 6);
    expect(DASH_COOLDOWN_MS * 0.75).toBe(600);
    const before = { plain: me(plain).resources!, boosted: me(boosted).resources! };
    for (const sim of [plain, boosted]) {
      walkTo(sim, tileToWorld(5, 7).x, tileToWorld(5, 7).y);
      expect(frames(sim, 60, { attack: true, aimX: me(sim).x + 40 }).some((e) => e.type === 'room_cleared')).toBe(true);
    }
    expect(me(plain).resources! - before.plain).toBe(ROOM_CLEAR_REWARD);
    expect(me(boosted).resources! - before.boosted).toBe(ROOM_CLEAR_REWARD + 1);
  });
});

describe('skill purchases', () => {
  const ids: AttunementEffectId[] = ['hazard_ward', 'bolt_ward', 'melee_ward'];

  it('charges the node cost, refuses what the operative cannot afford, and is idempotent', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: P1, displayName: P1, classId: 'bastion' });
    sim.setWorld(world([{}], attunementsFor(ids)));
    expect(me(sim).resources).toBe(ABILITY_UNLOCK_COST);
    expect(me(sim).skillNodeIds).toBeUndefined();
    // 3 resources: Salvager (2) yes, then the first attunement (3) no.
    expect(sim.purchaseSkill(P1, 'attune.0.hazard_ward')).toBe(false); // prerequisite missing
    expect(sim.purchaseSkill(P1, 'core.salvage')).toBe(true);
    expect(me(sim).resources).toBe(1);
    expect(me(sim).skillNodeIds).toEqual(['core.salvage']);
    expect(sim.purchaseSkill(P1, 'core.salvage')).toBe(false);
    expect(me(sim).resources).toBe(1);
    expect(sim.purchaseSkill(P1, 'attune.0.hazard_ward')).toBe(false); // 1 < 3
    expect(sim.purchaseSkill(P1, 'core.plating')).toBe(false); // planned
    expect(sim.purchaseSkill(P1, 'nope')).toBe(false);
    expect(sim.purchaseSkill(P1, 'core.root')).toBe(false); // innate
    earn(sim, 1);
    expect(me(sim).resources).toBe(1 + ROOM_CLEAR_REWARD + 1); // Salvager already pays
    expect(sim.purchaseSkill(P1, 'attune.1.bolt_ward')).toBe(false); // needs attune.0 first
    expect(sim.purchaseSkill(P1, 'attune.0.hazard_ward')).toBe(true);
    expect(me(sim).resources).toBe(2);
    expect(sim.purchaseSkill(P1, 'attune.0.hazard_ward')).toBe(false);
    expect(me(sim).skillNodeIds).toEqual(['core.salvage', 'attune.0.hazard_ward']);
    const tree = buildSkillTree('bastion', { title: 't', attunements: attunementsFor(ids) });
    expect(skillPurchaseCheck(tree, 'attune.1.bolt_ward', me(sim).skillNodeIds!, 2)).toBe('resources');
    expect(skillPurchaseCheck(tree, 'attune.2.melee_ward', me(sim).skillNodeIds!, 99)).toBe('requires');
  });

  it('co-op: a guest buys for themself only, with their own resources', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: P1, displayName: P1, classId: 'bastion' });
    sim.addPlayer({ id: P2, displayName: P2, classId: 'beacon' });
    sim.setHostPlayerId(P1);
    sim.setWorld(world([{}], attunementsFor(ids)));
    expect(sim.purchaseSkill(P2, 'core.salvage')).toBe(true);
    expect(me(sim, P2).resources).toBe(ABILITY_UNLOCK_COST - 2);
    expect(me(sim, P2).skillNodeIds).toEqual(['core.salvage']);
    expect(me(sim, P1).resources).toBe(ABILITY_UNLOCK_COST);
    expect(me(sim, P1).skillNodeIds).toBeUndefined();
    expect(sim.purchaseSkill('nobody', 'core.salvage')).toBe(false);
    // The host's purchase does not appear on the guest, and vice versa.
    expect(sim.purchaseSkill(P1, 'core.wind')).toBe(true);
    expect(me(sim, P1).skillNodeIds).toEqual(['core.wind']);
    expect(me(sim, P2).skillNodeIds).toEqual(['core.salvage']);
    // Snapshots validate with the additive field present.
    expect(() => GameSnapshotSchema.parse(sim.getSnapshot())).not.toThrow();
  });
});

describe('determinism and the no-purchase guarantee', () => {
  const ids: AttunementEffectId[] = ['dash_echo', 'hazard_ward', 'clear_surge'];
  const rooms: RoomOptions[] = [{ encounters: [husk(8), husk(9, 9, 'husk2')], hazard: [[7, 7]] }];

  function drive(sim: Simulation, ticks: number): GameEvent[] {
    const events: GameEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      const p = me(sim);
      events.push(...frames(sim, 1, { moveX: i % 40 < 20 ? 1 : -1, moveY: i % 90 < 45 ? 0.3 : -0.3, attack: i % 7 === 0, dash: i % 50 === 0, aimX: p.x + 60, aimY: p.y }));
    }
    return events;
  }

  it('two sims fed the same intents produce identical snapshots and events, with effects bought', () => {
    const buy = ['core.salvage', 'attune.0.dash_echo'];
    const a = scenario(rooms, ids, buy);
    const b = scenario(rooms, ids, buy);
    const ea = drive(a, 400);
    const eb = drive(b, 400);
    expect(JSON.stringify(a.getSnapshot())).toBe(JSON.stringify(b.getSnapshot()));
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(me(a).skillNodeIds).toEqual(buy);
  });

  it('a world without attunements, and a crew that bought nothing, snapshot byte-identically to a tree-less run', () => {
    // `skillNodeIds` never appears until a purchase; every other field is exactly what it was.
    const run = (attunements: Attunement[]) => {
      const sim = createSimulation();
      sim.addPlayer({ id: P1, displayName: P1, classId: 'bastion' });
      sim.setWorld(world(rooms, attunements));
      earn(sim, PAY_ROOMS);
      sim.enterRoom(PAY_ROOMS);
      const events = drive(sim, 300);
      return { snapshot: JSON.stringify(sim.getSnapshot()), events: JSON.stringify(events) };
    };
    const bare = run([]);
    const attuned = run(attunementsFor(ids));
    expect(bare.snapshot).not.toContain('skillNodeIds');
    expect(attuned.snapshot).toBe(bare.snapshot);
    expect(attuned.events).toBe(bare.events);
  });
});
