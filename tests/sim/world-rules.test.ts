/**
 * World rules: the closed set of gameplay modifiers a recipe may carry. Each one must change
 * how a run PLAYS, measurably, and only on expeditions.
 */
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, type GameEvent, type PlayerIntent, type PreparedWorld } from '../../src/shared/contracts';
import { HAZARD_DAMAGE, TICK_MS } from '../../src/shared/conventions';
import { ENEMY_INFO, WORLD_RULE_IDS, WORLD_RULE_INFO, type WorldRuleId } from '../../src/shared/registry';
import { createSimulation, type Simulation } from '../../src/sim';

const playerId = 'rules-player';
const intent = (partial: Partial<PlayerIntent> = {}): PlayerIntent => ({
  playerId, seq: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false, ...partial,
});
const palette = {
  background: '#07090f', floor: '#141c2e', floorAlt: '#182238', wall: '#1f2b47', wallEdge: '#2fa8c9',
  accent: '#7cf5ff', accentSoft: '#2fa8c9', glow: '#7cf5ff', hazard: '#ff5c7a', text: '#dbe4f7',
};

/**
 * One room, 20x8. Player spawns at (2,3). A hazard strip '~' at x=4..5, a lantern prop at (2,5),
 * a lone husk far east at (16,3) and a swarmling encounter at (14,5).
 */
function world(rules: WorldRuleId[], enemyX = 16, swarm = true): PreparedWorld {
  const tiles = [
    '####################',
    '#..................#',
    '#..................#',
    '#.P.~~.............#',
    '#...~~.............#',
    '#..................#',
    '#.................A#',
    '####################',
  ];
  return PreparedWorldSchema.parse({
    worldId: `rules-${rules.join('-') || 'none'}`, createdAt: 0,
    recipe: {
      title: 'Rules Arena', tagline: 't', themeSummary: 't', motifIds: ['spires'], palette,
      rooms: [{ name: 'Arena', description: '', motifIds: ['spires'], propIds: ['lantern'], enemyIds: ['husk', 'swarmling'], hazards: true }],
      contributionMappings: [], lore: [], attunements: [], rules,
    },
    art: { paletteFamily: 'ink-neon', palette, motifIds: ['spires'], skyline: 'spires', fog: 0, glowIntensity: 0.5 },
    plannedRoomCount: 1,
    rooms: [{
      id: 'rules-room', index: 0, name: 'Arena', description: '', width: 20, height: 8, tiles,
      props: [{ id: 'lamp', propId: 'lantern', x: 2, y: 5 }],
      encounters: [{ id: 'husk', enemyId: 'husk', x: enemyX, y: 3, count: 1 }, ...(swarm ? [{ id: 'swarm', enemyId: 'swarmling' as const, x: 14, y: 5, count: 2 }] : [])],
      exits: [], isFinal: true, attributions: [],
    }],
    provenance: { source: 'fixture', label: 'TEST', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: 'Rules Arena', source: 'fixture', headline: 't', lines: [] },
  });
}

function start(rules: WorldRuleId[], enemyX?: number, swarm = true): { sim: Simulation; events: GameEvent[] } {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Rules', classId: 'bastion' });
  sim.setWorld(world(rules, enemyX, swarm));
  const events: GameEvent[] = [...sim.enterRoom(0)];
  return { sim, events };
}
const run = (sim: Simulation, events: GameEvent[], ticks: number, i: PlayerIntent = intent()): void => {
  for (let k = 0; k < ticks; k++) {
    sim.applyIntent({ ...i, seq: k + 1 });
    events.push(...sim.step());
  }
};
const me = (sim: Simulation) => sim.getSnapshot().players.find((p) => p.id === playerId)!;
const husk = (sim: Simulation) => sim.getSnapshot().enemies.find((e) => e.enemyId === 'husk')!;

describe('world rules', () => {
  it('every registry rule is implemented and documented', () => {
    for (const id of WORLD_RULE_IDS) {
      expect(WORLD_RULE_INFO[id].status).toBe('implemented');
      expect(WORLD_RULE_INFO[id].summary.length).toBeGreaterThan(10);
    }
  });

  it('bulwark and frenzy scale hostile toughness at spawn; dense_swarm adds bodies', () => {
    expect(husk(start([]).sim).maxHp).toBe(ENEMY_INFO.husk.maxHp);
    expect(husk(start(['bulwark']).sim).maxHp).toBe(Math.round(ENEMY_INFO.husk.maxHp * 1.35));
    expect(husk(start(['frenzy']).sim).maxHp).toBe(Math.round(ENEMY_INFO.husk.maxHp * 0.8));
    const plain = start([]).sim.getSnapshot().enemies.filter((e) => e.enemyId === 'swarmling').length;
    const dense = start(['dense_swarm']).sim.getSnapshot().enemies.filter((e) => e.enemyId === 'swarmling').length;
    expect(dense).toBe(plain + 1);
  });

  it('frenzy hostiles close distance faster than bulwark hostiles', () => {
    const fast = start(['frenzy']);
    const slow = start(['bulwark']);
    const fastStart = husk(fast.sim).x;
    const slowStart = husk(slow.sim).x;
    run(fast.sim, fast.events, 60);
    run(slow.sim, slow.events, 60);
    const fastTravel = fastStart - husk(fast.sim).x;
    const slowTravel = slowStart - husk(slow.sim).x;
    expect(fastTravel).toBeGreaterThan(slowTravel * 1.2);
  });

  it('low_visibility hostiles hold position until an operative comes close', () => {
    const murk = start(['low_visibility']);
    const x0 = husk(murk.sim).x;
    run(murk.sim, murk.events, 90);
    expect(Math.abs(husk(murk.sim).x - x0)).toBeLessThan(1);
    expect(husk(murk.sim).state).toBe('idle');
    const clear = start([]);
    const c0 = husk(clear.sim).x;
    run(clear.sim, clear.events, 90);
    expect(c0 - husk(clear.sim).x).toBeGreaterThan(40);
  });

  it('hazard floor bites while you stand in it, harder under unstable_ground', () => {
    const plain = start([], 18);
    run(plain.sim, plain.events, 22, intent({ moveX: 1 })); // ~70px east: onto the hazard strip (cols 4-5)
    const hpBeforeStanding = me(plain.sim).hp;
    run(plain.sim, plain.events, Math.round(1500 / TICK_MS));
    const plainLoss = hpBeforeStanding - me(plain.sim).hp;
    expect(plainLoss).toBeGreaterThanOrEqual(HAZARD_DAMAGE);
    expect(plain.events.some((e) => e.type === 'player_damaged' && e.sourceEnemyId === 'hazard')).toBe(true);

    const unstable = start(['unstable_ground'], 18);
    run(unstable.sim, unstable.events, 22, intent({ moveX: 1 }));
    const before: number = me(unstable.sim).hp;
    run(unstable.sim, unstable.events, Math.round(1500 / TICK_MS));
    const after: number = me(unstable.sim).hp;
    expect(before - after).toBeGreaterThan(plainLoss);
  });

  it('regen_fields mends operatives standing in lantern light', () => {
    const { sim, events } = start(['regen_fields'], 18, false); // no swarm: only the floor and the lamp act
    // Take a hazard bite first so there is something to heal, then step back into the lamp.
    run(sim, events, 22, intent({ moveX: 1 }));
    run(sim, events, Math.round(1500 / TICK_MS));
    const hurt = me(sim).hp;
    expect(hurt).toBeLessThan(me(sim).maxHp);
    run(sim, events, Math.round(700 / TICK_MS), intent({ moveX: -1, moveY: 1 })); // back west, toward the lantern at (2,5)
    run(sim, events, Math.round(2500 / TICK_MS));
    expect(me(sim).hp).toBeGreaterThan(hurt);
    expect(events.some((e) => e.type === 'player_healed')).toBe(true);
  });

  it('scavenger pays extra for kills and room clears; kills always pay registry shards on expeditions', () => {
    const settle = (rules: WorldRuleId[]): number => {
      const { sim, events } = start(rules, 4);
      const before = me(sim).resources ?? 0;
      for (let k = 0; k < 2400 && sim.getSnapshot().enemies.some((e) => e.hp > 0); k++) {
        const target = sim.getSnapshot().enemies.find((e) => e.hp > 0)!;
        sim.applyIntent(intent({ seq: k + 1, attack: true, aimX: target.x, aimY: target.y, moveX: Math.sign(target.x - me(sim).x), moveY: Math.sign(target.y - me(sim).y) }));
        events.push(...sim.step());
      }
      expect(sim.getSnapshot().enemies.every((e) => e.hp <= 0)).toBe(true);
      return (me(sim).resources ?? 0) - before;
    };
    const plain = settle([]);
    const greedy = settle(['scavenger']);
    expect(plain).toBeGreaterThan(0);
    expect(greedy).toBeGreaterThan(plain);
  });

  it('gravity_well dashes carry further', () => {
    const measure = (rules: WorldRuleId[]): number => {
      const { sim, events } = start(rules, 18);
      const x0 = me(sim).x;
      run(sim, events, 1, intent({ moveX: 1, dash: true }));
      run(sim, events, 20, intent({ moveX: 0 }));
      return me(sim).x - x0;
    };
    expect(measure(['gravity_well'])).toBeGreaterThan(measure([]) * 1.2);
  });
});
