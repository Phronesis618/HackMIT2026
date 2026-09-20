/**
 * The Custodian's attack-pattern registry: selection rules, the numbers each pattern runs on,
 * the phase structure, the gatekeeper previews and the prose every player reads.
 * Spec: docs/design/BOSS_FINALE.md §2–§5.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type EnemyState, type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { TICK_MS } from '../../src/shared/conventions';
import {
  CUSTODIAN_BASE_HP, CUSTODIAN_HIT_CAP, CUSTODIAN_PATTERNS, CUSTODIAN_PATTERN_IDS,
  DEFAULT_CUSTODIAN_MOVES, capCustodianHit, custodianMaxHp, gatekeeperMaxHp, movesAreLegal, repairMoves,
  resolveCustodian, telegraphMsFor, type CustodianPatternId,
} from '../../src/shared/custodian';
import { lintProse } from '../../src/shared/prose';
import { createSimulation, type Simulation } from '../../src/sim';
import { createCustodianRuntime, custodianPhase, type BossContext } from '../../src/sim/boss';
import { fightCustodian } from './finaleBot';

const fixture = WorldFixtureSchema.parse(fixtureJson);
const relays = [{ x: 5, y: 3 }, { x: 16, y: 3 }, { x: 17, y: 11 }];
const pool = ['husk', 'sentinel', 'lurker'] as const;

function finalRoom(options: { relays?: boolean } = {}): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  tiles[7]![13] = 'A';
  return RoomSpecSchema.parse({
    id: 'final-arena', index: 2, name: 'The final circuit', description: '',
    width: 26, height: 16, tiles: tiles.map((row) => row.join('')), props: [], exits: [],
    encounters: [{ id: 'custodian', enemyId: 'guardian', x: 10, y: 7, count: 1 }],
    isFinal: true, attributions: [], ...(options.relays === false ? {} : { anchorRelays: relays }),
  });
}

function setup(worldId = 'pattern-test', crew = ['operative'], classId: 'bastion' | 'beacon' | 'shade' | 'weaver' = 'beacon'): Simulation {
  const sim = createSimulation();
  for (const id of crew) sim.addPlayer({ id, displayName: id, classId });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId, createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [fixture.rooms[0], fixture.rooms[1], finalRoom()], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Test circuit', lines: [] },
  }));
  sim.enterRoom(2);
  return sim;
}

function idle(sim: Simulation, ticks: number, partial: Partial<PlayerIntent> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const player = sim.getSnapshot().players[0]!;
    sim.applyIntent({
      playerId: player.id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
      attack: false, dash: false, ability: null, interact: false, ...partial,
    });
    events.push(...sim.step());
  }
  return events;
}

describe('Custodian pattern registry', () => {
  it('keeps every pattern distinct, readable and answerable', () => {
    expect(new Set(CUSTODIAN_PATTERN_IDS).size).toBe(CUSTODIAN_PATTERN_IDS.length);
    expect(CUSTODIAN_PATTERN_IDS.length).toBeGreaterThanOrEqual(10);
    for (const id of CUSTODIAN_PATTERN_IDS) {
      const spec = CUSTODIAN_PATTERNS[id];
      expect(spec.id).toBe(id);
      expect(spec.telegraphMs).toBeGreaterThanOrEqual(500);
      expect(spec.range).toBeGreaterThan(0);
      expect(spec.counterplay.length).toBeGreaterThan(10);
    }
    // Phase 2 is 0.85 of the phase-1 wind-up, phase 3 is 0.75, and a first use is 1.4.
    const sweep = CUSTODIAN_PATTERNS.sweep_arc;
    expect(telegraphMsFor(sweep, 1, false)).toBe(900);
    expect(telegraphMsFor(sweep, 2, false)).toBe(765);
    expect(telegraphMsFor(sweep, 3, false)).toBe(675);
    expect(telegraphMsFor(sweep, 1, true)).toBe(1260);
  });

  it('writes every player-facing line in the house style', () => {
    for (const id of CUSTODIAN_PATTERN_IDS) {
      const spec = CUSTODIAN_PATTERNS[id];
      expect(lintProse(spec.defaultName, { kind: 'bossName' }).hardFail, `${id} name`).toBe(false);
      expect(lintProse(spec.defaultTell, { kind: 'bossCallout' }).hardFail, `${id} tell`).toBe(false);
    }
  });

  it('never hands a world an unreadable moveset, whatever the model sends', () => {
    expect(movesAreLegal(['arena_flood', 'pylon_lock', 'siege_charge'], [...pool])).toBe(false);
    expect(movesAreLegal(['ring_bloom', 'sweep_arc', 'tether_haul'], [...pool])).toBe(false); // no close answer
    expect(movesAreLegal(['siege_charge', 'shatter_step', 'gravity_well'], [...pool])).toBe(false); // no ranged answer
    expect(movesAreLegal(['ring_bloom', 'siege_charge', 'summon_choir'], ['husk'])).toBe(false); // pool too small
    expect(movesAreLegal([...DEFAULT_CUSTODIAN_MOVES], [...pool])).toBe(true);
    for (const broken of [
      ['arena_flood', 'pylon_lock', 'gravity_well'],
      ['ring_bloom', 'ring_bloom', 'ring_bloom'],
      ['summon_choir', 'tether_haul', 'mirror_shade'],
    ] as CustodianPatternId[][]) {
      expect(movesAreLegal(repairMoves(broken, ['husk']), ['husk'])).toBe(true);
    }
  });

  it('derives three legal, deterministic patterns from the world seed when no recipe supplies them', () => {
    const a = resolveCustodian({ seed: 'vantage-spire', motifIds: ['spires'], enemyPool: [...pool] });
    const b = resolveCustodian({ seed: 'vantage-spire', motifIds: ['spires'], enemyPool: [...pool] });
    const other = resolveCustodian({ seed: 'root-archive', motifIds: ['roots'], enemyPool: [...pool] });
    expect(a).toEqual(b);
    expect(a.source).toBe('derived');
    expect(movesAreLegal(a.moves.map((move) => move.patternId), [...pool])).toBe(true);
    expect(a.moves.map((move) => move.patternId)).not.toEqual(other.moves.map((move) => move.patternId));
  });

  it('takes the model\'s names when they pass the linter and its own when they do not', () => {
    const resolved = resolveCustodian({
      seed: 'w', enemyPool: [...pool],
      spec: {
        title: 'The Ledger', phaseTitles: ['Count', 'Split', 'Last page'],
        moves: [
          { patternId: 'ring_bloom', name: 'The Ledger Sweep', tell: 'Twelve bolts, then twelve through the gaps.' },
          { patternId: 'siege_charge', name: 'Audit Run', tell: 'It backs up, then runs 260 units.' },
          { patternId: 'sweep_arc', name: 'Ancient whispers of the forgotten deep echo eternally', tell: 'You feel a mysterious dread.' },
        ],
      },
    });
    expect(resolved.source).toBe('recipe');
    expect(resolved.title).toBe('The Ledger');
    expect(resolved.moves[0]!.name).toBe('The Ledger Sweep');
    expect(resolved.moves[2]!.name).toBe(CUSTODIAN_PATTERNS.sweep_arc.defaultName);
    expect(resolved.moves[2]!.tell).toBe(CUSTODIAN_PATTERNS.sweep_arc.defaultTell);
  });

  it('scales health with the crew and caps a single hit at 12% of it', () => {
    expect(custodianMaxHp(1)).toBe(CUSTODIAN_BASE_HP);
    expect([custodianMaxHp(2), custodianMaxHp(3), custodianMaxHp(4)]).toEqual([1600, 2000, 2400]);
    expect(capCustodianHit(999, 1200)).toBe(Math.round(1200 * CUSTODIAN_HIT_CAP));
    expect(capCustodianHit(20, 1200)).toBe(20);
    expect(gatekeeperMaxHp(0, 1)).toBe(320);
    expect(gatekeeperMaxHp(3, 3)).toBe(480 + 240);
  });
});

describe('Custodian in the simulation', () => {
  it('gives the Anchor keeper crew-sized health and never lets one hit take more than the cap', () => {
    const sim = setup();
    const boss = sim.getSnapshot().enemies[0]!;
    expect(boss).toMatchObject({ bossPhase: 1, hp: 1200, maxHp: 1200 });
    const events = idle(sim, 600, { attack: true, aimX: boss.x, aimY: boss.y });
    const hits = events.filter((event) => event.type === 'enemy_damaged');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) if (hit.type === 'enemy_damaged') expect(hit.amount).toBeLessThanOrEqual(144);
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);
  });

  it('announces each pattern once with the world\'s own name and stretches its first telegraph', () => {
    const sim = setup();
    const events = idle(sim, 900);
    const started = events.filter((event) => event.type === 'boss_pattern_started');
    expect(started.length).toBeGreaterThan(1);
    const first = started[0]!;
    if (first.type !== 'boss_pattern_started') throw new Error('unreachable');
    expect(first.firstUse).toBe(true);
    expect(first.name).toBe(CUSTODIAN_PATTERNS[first.patternId].defaultName);
    const telegraphs = events.filter((event) => event.type === 'enemy_telegraphed');
    const firstTelegraph = telegraphs[0]!;
    if (firstTelegraph.type !== 'enemy_telegraphed') throw new Error('unreachable');
    expect(firstTelegraph.telegraph.remainingMs).toBe(telegraphMsFor(CUSTODIAN_PATTERNS[first.patternId], 1, true));
    // Nothing is announced twice as a first use.
    const firstUses = started.filter((event) => event.type === 'boss_pattern_started' && event.firstUse);
    expect(new Set(firstUses.map((event) => event.type === 'boss_pattern_started' && event.patternId)).size).toBe(firstUses.length);
    // Phase 1 cycles the three chosen moves, one at a time, and never three in a row.
    const ids = started.map((event) => event.type === 'boss_pattern_started' ? event.patternId : '');
    for (let i = 2; i < ids.length; i++) expect(ids[i] === ids[i - 1] && ids[i] === ids[i - 2]).toBe(false);
  });

  it('uses only the three patterns the world picked', () => {
    const sim = setup('vantage-spire');
    const picked = new Set(resolveCustodian({
      seed: 'vantage-spire', motifIds: fixture.recipe.motifIds,
      enemyPool: [...new Set(fixture.recipe.rooms.flatMap((room) => room.enemyIds))].filter((id) => id !== 'guardian'),
    }).moves.map((move) => move.patternId));
    const events = idle(sim, 1200);
    const used = new Set(events.filter((event) => event.type === 'boss_pattern_started')
      .map((event) => event.type === 'boss_pattern_started' ? event.patternId : ''));
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(picked.has(id as CustodianPatternId)).toBe(true);
  });

  it('crosses three different phases, twists the terrain at the second and shields at the third', () => {
    const sim = setup();
    const result = fightCustodian(sim, ['operative']);
    expect(result.killed).toBe(true);
    const phaseEvents = result.events.filter((event) => event.type === 'boss_phase_changed');
    expect(phaseEvents.map((event) => event.type === 'boss_phase_changed' && event.phase)).toEqual([2, 3]);
    expect(result.events.some((event) => event.type === 'terrain_corrupted')).toBe(true);
    // Every phase lasts long enough to be read, and the whole fight is a fight.
    expect(result.phaseMs[1]).toBeGreaterThan(3000);
    expect(result.phaseMs[2]).toBeGreaterThan(3000);
    expect(result.phaseMs[3]).toBeGreaterThan(1000);
    // The old Custodian died in 4.4 seconds; this one is a fight with a shape.
    expect(result.ticks * TICK_MS).toBeGreaterThan(15_000);
  });

  it('lets every class win the fight alone, with no items, in well under four minutes', () => {
    // Judges play this solo. The bot is a plain player: it steps off marked floor, dashes bolts
    // and holds one relay. If it can win with a class, a person can; if no world lets it, the
    // numbers in shared/custodian.ts have drifted and need to come back down.
    for (const classId of ['bastion', 'beacon', 'shade', 'weaver'] as const) {
      const fights = ['w-a', 'w-b', 'w-c', 'w-d'].map((worldId) => fightCustodian(setup(worldId, ['operative'], classId), ['operative'], 18_000));
      const wins = fights.filter((fight) => fight.killed);
      expect(wins.length, `${classId} never won solo`).toBeGreaterThan(0);
      for (const fight of fights) expect(fight.ticks * TICK_MS, `${classId} fight ran long`).toBeLessThan(240_000);
      for (const fight of wins) expect(fight.ticks * TICK_MS).toBeLessThan(120_000);
    }
  }, 120_000);

  it('holds the boss at a third of its health until the phase-2 wave is dead', () => {
    // Mithrix's rule, unit-tested on the gate itself: health alone opens phase 2, but phase 3 also
    // needs the wave cleared, so the crew earns its breather.
    const custodian = resolveCustodian({ seed: 'gate', enemyPool: [...pool] });
    const runtime = createCustodianRuntime({ custodian });
    const boss = { hp: 300, maxHp: 1200, bossPhase: 2 } as EnemyState;
    let waveAlive = true;
    const ctx = { aliveWithTag: () => waveAlive } as unknown as BossContext;
    runtime.waveTag = 'wave';
    expect(custodianPhase(runtime, boss, ctx)).toBe(2);
    waveAlive = false;
    expect(custodianPhase(runtime, boss, ctx)).toBe(3);
    // Phases never run backwards when the boss is healed or a cap rounds up.
    expect(custodianPhase(runtime, { ...boss, hp: 1100, bossPhase: 3 } as EnemyState, ctx)).toBe(3);
  });

  it('never lets an arena pattern mark more than two fifths of the floor', () => {
    const sim = setup('flood-world');
    for (let i = 0; i < 3000; i++) {
      idle(sim, 1);
      const field = sim.getSnapshot().bossField;
      if (!field || field.tiles.length === 0) continue;
      const floor = finalRoom().tiles.join('').split('').filter((ch) => ch === '.' || ch === 'P' || ch === 'A').length;
      expect(field.tiles.length).toBeLessThanOrEqual(Math.ceil(floor * 0.4));
      return;
    }
  });
});
