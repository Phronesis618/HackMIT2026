import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema, type GameSnapshot, type PlayerIntent, type PreparedWorld, type RoomEncounter } from '../../src/shared/contracts';
import { DASH_COOLDOWN_MS, PLAYER_MAX_HP } from '../../src/shared/conventions';
import { LAW_BUDGET_RANGE, LAW_INFO, WORLD_LAW_IDS, type WorldLaw, type WorldLawId } from '../../src/shared/laws';
import { CLASS_IDS, ENEMY_INFO, MOTIF_IDS, type ClassId } from '../../src/shared/registry';
import { createSimulation } from '../../src/sim';
import { CLASS_COMBAT } from '../../src/sim/combat';
import { NEUTRAL_LAWS, LAW_ROOM_ENEMY_CAP, applyEncounterLaws, deriveWorldLaws, resolveLaws, worldLawsView } from '../../src/sim/laws';
import { FloorsBot, floorsWorld, makeProvider, steerIntent } from './floorsBot';

const law = (lawId: WorldLawId, intensity = 0.5): WorldLaw => ({ lawId, name: lawId, description: LAW_INFO[lawId].summary.slice(0, 160), intensity });

/** A real fight for the class tests: a pack, a ranged pair and a swarm, spread over the first room. */
const ARENA: RoomEncounter[] = [
  { id: 'arena-husks', enemyId: 'husk', x: 12, y: 3, count: 3 },
  { id: 'arena-sentinel', enemyId: 'sentinel', x: 20, y: 7, count: 1 },
  { id: 'arena-spewer', enemyId: 'spewer', x: 18, y: 2, count: 1 },
  { id: 'arena-swarm', enemyId: 'swarmling', x: 16, y: 13, count: 3 },
];

function fixtureWorld(name: string, laws?: WorldLaw[], arena = false): PreparedWorld {
  const fixture = WorldFixtureSchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../fixtures/worlds/${name}.json`), 'utf8')));
  if (arena) fixture.rooms[0]!.encounters = ARENA;
  return PreparedWorldSchema.parse({
    worldId: `test-${name}`, createdAt: 0, recipe: { ...fixture.recipe, ...(laws ? { laws } : {}) }, art: fixture.art, rooms: fixture.rooms,
    plannedRoomCount: fixture.plannedRoomCount,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', fixtureId: fixture.fixtureId, generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'test', lines: [] },
  });
}

describe('resolveLaws', () => {
  it('no laws resolve to NEUTRAL_LAWS exactly', () => {
    expect(resolveLaws([])).toEqual(NEUTRAL_LAWS);
    expect(resolveLaws(undefined)).toEqual(NEUTRAL_LAWS);
    expect(NEUTRAL_LAWS).toMatchObject({ walkSpeedMul: 1, attackMoveMul: 0.35, playerMaxHp: PLAYER_MAX_HP, playerDamageMul: 1, enemyCountMul: 1, lightRadius: null });
  });

  it('matches the documented numbers at intensity 0.5', () => {
    expect(resolveLaws([law('glass_lattice')])).toMatchObject({ playerMaxHp: 48, playerDamageMul: 1.8 });
    const echo = resolveLaws([law('long_echo')]);
    expect(echo.abilityCooldownMul).toBeCloseTo(0.675, 6);
    expect(echo.ultChargeMul).toBeCloseTo(0.75, 6);
    const strike = resolveLaws([law('committed_strike')]);
    expect(strike.attackMoveMul).toBeCloseTo(0.1, 6);
    expect(strike.playerDamageMul).toBeCloseTo(1.25, 6);
    expect(resolveLaws([law('committed_strike', 1)]).attackMoveMul).toBe(0);
    expect(resolveLaws([law('long_dark')]).lightRadius).toBe(215);
    const few = resolveLaws([law('few_and_terrible')]);
    expect([few.enemyCountMul, few.enemyHpMul, few.enemyDamageMul].map((n) => Math.round(n * 1000) / 1000)).toEqual([0.55, 2.2, 1.275]);
    const many = resolveLaws([law('the_many')]);
    expect([many.enemyCountMul, many.enemyHpMul, many.enemyDamageMul].map((n) => Math.round(n * 1000) / 1000)).toEqual([1.8, 0.525, 0.775]);
    expect(resolveLaws([law('thin_air')]).dashSpeedMul).toBeCloseTo(1.4, 6);
    expect(resolveLaws([law('tidal_drag')]).dashCooldownMul).toBeCloseTo(0.675, 6);
    expect(resolveLaws([law('first_light')]).firstStrikeMul).toBeCloseTo(2.5, 6);
  });

  it('enforces conflicts, caps and the budget through sanitizeLaws, and clamps intensity', () => {
    // the_many conflicts with few_and_terrible: the earlier law wins.
    expect(resolveLaws([law('few_and_terrible'), law('the_many')]).enemyCountMul).toBeCloseTo(0.55, 6);
    // combat cap 1: long_echo is dropped after glass_lattice.
    expect(resolveLaws([law('glass_lattice'), law('long_echo')]).abilityCooldownMul).toBe(1);
    // budget: +2 +2 = 4 > 3 drops the later +2 law.
    expect(resolveLaws([law('glass_lattice'), law('long_dark')]).lightRadius).toBeNull();
    expect(resolveLaws([law('glass_lattice', 9)])).toEqual(resolveLaws([law('glass_lattice', 1)]));
    expect(resolveLaws([law('glass_lattice', Number.NaN)]).playerMaxHp).toBe(48);
  });

  it('is pure and keeps every law set inside the hard bands', () => {
    for (const a of WORLD_LAW_IDS) for (const b of WORLD_LAW_IDS) for (const i of [0, 1]) {
      const picks = [law(a, i), law(b, i), law('committed_strike', i)];
      const resolved = resolveLaws(picks);
      expect(resolveLaws(picks)).toEqual(resolved);
      expect(resolved.playerMaxHp).toBeGreaterThanOrEqual(35);
      expect(resolved.playerDamageMul).toBeLessThanOrEqual(2.5);
      expect(resolved.enemyCountMul).toBeGreaterThanOrEqual(0.45);
      expect(resolved.walkSpeedMul).toBeGreaterThanOrEqual(0.75);
    }
  });
});

describe('encounter multipliers', () => {
  const group = (count: number, extra: Partial<RoomEncounter> = {}): RoomEncounter => ({ id: `g${count}`, enemyId: 'husk', x: 5, y: 5, count, ...extra });

  it('the_many never passes the room cap or the per-group limit; few_and_terrible never empties a group', () => {
    const many = resolveLaws([law('the_many', 1)]);
    const few = resolveLaws([law('few_and_terrible', 1)]);
    for (const counts of [[1], [3, 3], [6, 6], [2, 2, 2, 2, 2], [6, 6, 6], new Array(12).fill(1)] as number[][]) {
      const base = counts.map((count) => group(count));
      const baseTotal = counts.reduce((a, b) => a + b, 0);
      const more = applyEncounterLaws(base, many);
      const total = more.reduce((sum, e) => sum + e.count, 0);
      expect(total).toBeLessThanOrEqual(Math.max(LAW_ROOM_ENEMY_CAP, baseTotal));
      expect(total).toBeGreaterThanOrEqual(baseTotal);
      expect(more).toHaveLength(base.length);
      for (const e of [...more, ...applyEncounterLaws(base, few)]) expect(RoomSpecSchema.shape.encounters.element.safeParse(e).success).toBe(true);
      expect(applyEncounterLaws(base, few).reduce((sum, e) => sum + e.count, 0)).toBeLessThanOrEqual(baseTotal);
    }
    expect(applyEncounterLaws([group(3)], many)[0]!.count).toBe(6);
    expect(applyEncounterLaws([group(4)], few)[0]!.count).toBe(2);
  });

  it('spares bosses and gatekeepers, and is the identity under NEUTRAL_LAWS', () => {
    const base = [group(1, { enemyId: 'guardian' }), group(1, { role: 'gatekeeper' }), group(2)];
    expect(applyEncounterLaws(base, resolveLaws([law('the_many')])).map((e) => e.count)).toEqual([1, 1, 4]);
    expect(applyEncounterLaws(base, NEUTRAL_LAWS)).toEqual(base);
  });
});

/** A plain class-aware bot: close to weapon range, swing, use Q, dash when cornered. */
function runFight(classId: ClassId, laws: WorldLaw[] | undefined, maxTicks = 9000): { cleared: boolean; ticks: number; snapshots: string[]; snapshot: GameSnapshot } {
  const world = fixtureWorld('vantage-spire', laws, true);
  const sim = createSimulation({ deriveLaws: false });
  const crew = ['op-a', 'op-b'];
  for (const id of crew) sim.addPlayer({ id, displayName: id, classId });
  sim.setWorld(world);
  sim.enterRoom(0);
  const room = world.rooms[0]!;
  const spec = CLASS_COMBAT[classId];
  const snapshots: string[] = [];
  let seq = 0;
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const snapshot = sim.getSnapshot();
    if (ticks % 50 === 0) snapshots.push(JSON.stringify(snapshot));
    const living = snapshot.enemies.filter((enemy) => enemy.hp > 0);
    if (living.length === 0 || snapshot.players.every((p) => p.hp <= 0)) break;
    for (const player of snapshot.players) {
      if (player.hp <= 0) continue;
      const intent: PlayerIntent = { playerId: player.id, seq: seq++, moveX: 0, moveY: 0, aimX: player.x + 1, aimY: player.y, attack: false, dash: false, ability: null, interact: false };
      const downed = snapshot.players.find((other) => other.hp <= 0);
      const target = [...living].sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0]!;
      const d = Math.hypot(target.x - player.x, target.y - player.y);
      if (downed && d > 150) {
        const near = Math.hypot(downed.x - player.x, downed.y - player.y) < 30;
        Object.assign(intent, near ? { interact: true } : steerIntent(room, snapshot, player, downed, false));
      } else {
        const reach = spec.range + ENEMY_INFO[target.enemyId].radius - 6;
        if (d > reach) Object.assign(intent, steerIntent(room, snapshot, player, target, false));
        Object.assign(intent, { aimX: target.x, aimY: target.y, attack: d <= reach + 8, ability: d <= reach + 40 && (player.abilityQCooldownMs ?? 0) === 0 ? 'q' : (player.ultCharge ?? 0) >= 100 ? 'r' : null });
      }
      sim.applyIntent(intent);
    }
    sim.step();
  }
  const snapshot = sim.getSnapshot();
  return { cleared: snapshot.enemies.every((enemy) => enemy.hp <= 0), ticks, snapshots, snapshot };
}

describe('laws in the simulation', () => {
  it('a world with no laws, an empty list, or derivation off plays identically', () => {
    const bare = runFight('bastion', undefined, 1500);
    const empty = runFight('bastion', [], 1500);
    expect(empty.snapshots).toEqual(bare.snapshots);
  });

  it('is deterministic across two sims under laws (legacy rooms)', () => {
    const picks = [law('committed_strike'), law('the_many'), law('long_dark')];
    expect(runFight('shade', picks, 1500).snapshots).toEqual(runFight('shade', picks, 1500).snapshots);
  });

  it('glass_lattice sets Integrity on the way in and lifts it back at the Stillpoint', () => {
    const sim = createSimulation({ deriveLaws: false });
    sim.addPlayer({ id: 'op-a', displayName: 'a', classId: 'bastion' });
    sim.setWorld(fixtureWorld('vantage-spire', [law('glass_lattice')]));
    expect(sim.getSnapshot().players[0]).toMatchObject({ hp: 100, maxHp: 100 });
    sim.enterRoom(0);
    expect(sim.getSnapshot().players[0]).toMatchObject({ hp: 48, maxHp: 48 });
    sim.returnToHeadquarters();
    expect(sim.getSnapshot().players[0]).toMatchObject({ hp: 100, maxHp: 100 });
  });

  it('few_and_terrible / the_many change body count and health in legacy rooms', () => {
    const count = (laws?: WorldLaw[]) => {
      const sim = createSimulation({ deriveLaws: false });
      sim.addPlayer({ id: 'op-a', displayName: 'a', classId: 'bastion' });
      sim.setWorld(fixtureWorld('vantage-spire', laws));
      sim.enterRoom(0);
      return sim.getSnapshot().enemies;
    };
    const base = count();
    const many = count([law('the_many')]);
    const few = count([law('few_and_terrible')]);
    expect(many.length).toBeGreaterThan(base.length);
    expect(many.length).toBeLessThanOrEqual(Math.max(LAW_ROOM_ENEMY_CAP, base.length));
    expect(few.length).toBeLessThanOrEqual(base.length);
    expect(many[0]!.maxHp).toBe(Math.round(ENEMY_INFO[many[0]!.enemyId].maxHp * 0.525));
    expect(few[0]!.maxHp).toBe(Math.round(ENEMY_INFO[few[0]!.enemyId].maxHp * 2.2));
  });

  it('long_echo shortens Q and tidal_drag shortens the dash cooldown by the exact factor', () => {
    const sim = createSimulation({ deriveLaws: false });
    sim.addPlayer({ id: 'op-a', displayName: 'a', classId: 'bastion' });
    sim.setWorld(fixtureWorld('vantage-spire', [law('long_echo'), law('tidal_drag')]));
    sim.enterRoom(0);
    const me = sim.getSnapshot().players[0]!;
    sim.applyIntent({ playerId: 'op-a', seq: 0, moveX: 0, moveY: 0, aimX: me.x + 10, aimY: me.y, attack: false, dash: false, ability: 'q' });
    sim.step();
    sim.applyIntent({ playerId: 'op-a', seq: 1, moveX: 1, moveY: 0, aimX: me.x + 10, aimY: me.y, attack: false, dash: true, ability: null });
    sim.step();
    const after = sim.getSnapshot().players[0]!;
    expect(after.abilityQCooldownMs).toBeGreaterThan(CLASS_COMBAT.bastion.qCooldown * 0.675 - 120);
    expect(after.abilityQCooldownMs).toBeLessThanOrEqual(CLASS_COMBAT.bastion.qCooldown * 0.675);
    expect(after.dashCooldownMs).toBeLessThanOrEqual(DASH_COOLDOWN_MS * 0.675);
    expect(after.dashCooldownMs).toBeGreaterThan(DASH_COOLDOWN_MS * 0.675 - 60);
  });

  // The doc's flagged risk: committed_strike may break Shade (260 ms cadence, 220 ms swing).
  const COMBAT_LAWS: WorldLawId[] = ['committed_strike', 'glass_lattice', 'long_echo', 'few_and_terrible', 'the_many', 'tidal_drag', 'thin_air', 'first_light'];
  for (const classId of CLASS_IDS) {
    it(`${classId} still wins a fight under every combat law at full intensity`, () => {
      const baseline = runFight(classId, undefined);
      expect(baseline.cleared).toBe(true);
      for (const lawId of COMBAT_LAWS) {
        const result = runFight(classId, [law(lawId, 1)]);
        expect(result.cleared, `${classId} under ${lawId}`).toBe(true);
        expect(result.ticks, `${classId} under ${lawId} took ${result.ticks} vs ${baseline.ticks}`).toBeLessThan(Math.max(baseline.ticks * 4, 3000));
      }
    }, 120_000);
  }
});

describe('laws in floors worlds', () => {
  it('apply in floorgen rooms too, deterministically, and keep the room cap', () => {
    const play = () => {
      const base = floorsWorld('delta');
      const world = { ...base, recipe: { ...base.recipe, laws: [law('the_many', 1), law('committed_strike')] } };
      const sim = createSimulation({ deriveLaws: false });
      for (const id of ['op-a', 'op-b']) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
      sim.setHostPlayerId('op-a');
      sim.setWorld(world);
      const bot = new FloorsBot(sim, makeProvider(world), ['op-a', 'op-b']);
      sim.enterRoom(0);
      const plan = bot.plan();
      const combat = plan.rooms.find((room) => room.kind === 'combat')!;
      bot.travel(combat.id);
      const authored = bot.room().encounters.reduce((sum, e) => sum + e.count, 0);
      return { snapshot: JSON.stringify(bot.snapshot()), authored };
    };
    const a = play();
    const b = play();
    expect(a.snapshot).toEqual(b.snapshot);
    const enemies = (JSON.parse(a.snapshot) as GameSnapshot).enemies;
    expect(enemies.length).toBeGreaterThanOrEqual(a.authored);
    expect(enemies.length).toBeLessThanOrEqual(Math.max(LAW_ROOM_ENEMY_CAP, a.authored));
  }, 120_000);
});

describe('offline derivation', () => {
  it('gives the three fixtures different, legal law sets and looks', () => {
    const views = ['vantage-spire', 'crystal-tide', 'root-archive'].map((name) => worldLawsView(fixtureWorld(name), true));
    for (const view of views) {
      expect(view.derived).toBe(true);
      expect(view.laws).toHaveLength(2);
      const total = view.laws.reduce((sum, l) => sum + LAW_INFO[l.lawId].budget, 0);
      expect(total).toBeGreaterThanOrEqual(LAW_BUDGET_RANGE.min);
      expect(total).toBeLessThanOrEqual(LAW_BUDGET_RANGE.max);
      expect(view.laws.map((l) => l.lawId)).not.toContain('long_dark');
    }
    expect(new Set(views.map((view) => view.laws.map((l) => l.lawId).join('+'))).size).toBe(3);
    expect(new Set(views.map((view) => view.look!.paletteFamily)).size).toBe(3);
  });

  it('is deterministic, off by default, and never overrides a recipe that has laws', () => {
    const world = fixtureWorld('crystal-tide');
    expect(worldLawsView(world, true)).toEqual(worldLawsView(world, true));
    expect(worldLawsView(world, false)).toEqual({ laws: [], look: null, derived: false });
    expect(worldLawsView(world)).toEqual({ laws: [], look: null, derived: false });
    const picked = fixtureWorld('crystal-tide', [law('long_dark')]);
    expect(worldLawsView(picked, false).laws.map((l) => l.lawId)).toEqual(['long_dark']);
    expect(worldLawsView(picked, true).laws.map((l) => l.lawId)).toEqual(['long_dark']);
  });

  it('every motif pair derives two non-conflicting laws', () => {
    for (const a of MOTIF_IDS) for (const b of MOTIF_IDS) {
      const derived = deriveWorldLaws({ motifIds: [a, b], fog: 0.4, glowIntensity: 0.6 }, 7);
      expect(derived.laws, `${a}+${b}`).toHaveLength(2);
    }
  });
});
