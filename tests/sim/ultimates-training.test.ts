/** Ultimates (R), dash trail direction, and the Training Range rules. */
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, type GameEvent, type PlayerIntent, type PreparedWorld } from '../../src/shared/contracts';
import { ABILITY_UNLOCK_COST, TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { CLASS_ABILITIES, ULT_CHARGE_MAX, type ClassId } from '../../src/shared/registry';
import { createSimulation, type Simulation } from '../../src/sim';
import { TRAINING_RESPAWN_MS, TRAINING_ROOM_ID, trainingRoom } from '../../src/sim/training';

const playerId = 'test-ult-player';

function intent(partial: Partial<PlayerIntent> = {}): PlayerIntent {
  return { playerId, seq: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false, ...partial };
}

const palette = {
  background: '#07090f', floor: '#141c2e', floorAlt: '#182238', wall: '#1f2b47', wallEdge: '#2fa8c9',
  accent: '#7cf5ff', accentSoft: '#2fa8c9', glow: '#7cf5ff', hazard: '#ff5c7a', text: '#dbe4f7',
};

/** One open room: player at (2,3), three husks in a row to the east. */
function arena(): PreparedWorld {
  return PreparedWorldSchema.parse({
    worldId: 'test-ult-world', createdAt: 0,
    recipe: { title: 'Ult Arena', tagline: 't', themeSummary: 't', motifIds: ['spires'], palette,
      rooms: [{ name: 'Arena', description: '', motifIds: ['spires'], propIds: [], enemyIds: ['husk'], hazards: false }], contributionMappings: [], lore: [], attunements: [] },
    art: { paletteFamily: 'ink-neon', palette, motifIds: ['spires'], skyline: 'spires', fog: 0, glowIntensity: 0.5 },
    plannedRoomCount: 1,
    rooms: [{
      id: 'ult-room', index: 0, name: 'Arena', description: '', width: 16, height: 8,
      tiles: ['################', '#..............#', '#..............#', '#.P............#', '#..............#', '#..............#', '#.........A....#', '################'],
      props: [], encounters: [{ id: 'husks', enemyId: 'husk', x: 5, y: 3, count: 3 }], exits: [], isFinal: true, attributions: [],
    }],
    provenance: { source: 'fixture', label: 'TEST', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: 'Ult Arena', source: 'fixture', headline: 't', lines: [] },
  });
}

function setup(classId: ClassId): { sim: Simulation; events: GameEvent[]; step: (n: number, i?: PlayerIntent) => void; me: () => ReturnType<Simulation['getSnapshot']>['players'][0] } {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Ult', classId });
  sim.setWorld(arena());
  const events: GameEvent[] = [];
  events.push(...sim.enterRoom(0));
  const step = (n: number, i?: PlayerIntent): void => {
    for (let k = 0; k < n; k++) {
      if (i) sim.applyIntent(i);
      events.push(...sim.step());
    }
  };
  return { sim, events, step, me: () => sim.getSnapshot().players[0]! };
}

describe('ultimates', () => {
  it('start uncharged, charge from damage dealt, and R does nothing until full', () => {
    const { sim, events, step, me } = setup('bastion');
    expect(me().ultCharge).toBe(0);
    const husk = sim.getSnapshot().enemies[0]!;
    step(1, intent({ ability: 'r', aimX: husk.x, aimY: husk.y }));
    expect(events.some((e) => e.type === 'ability_used')).toBe(false);
    // Hit the nearest husk a few times (it spawns just outside reach, so it walks in first).
    for (let k = 0; k < 240 && (me().ultCharge ?? 0) === 0; k++) step(1, intent({ attack: true, aimX: husk.x, aimY: husk.y }));
    expect(me().ultCharge).toBeGreaterThan(0);
  });

  it.each([
    ['bastion', 'bastion.r.aegis_slam'],
    ['shade', 'shade.r.blade_storm'],
    ['beacon', 'beacon.r.solar_lance'],
    ['weaver', 'weaver.r.collapse'],
  ] as const)('%s fires its ultimate at full charge, hits enemies, resets charge', (classId, abilityId) => {
    const { sim, events, step, me } = setup(classId);
    // Grant a full charge the same way the training range does: deal enough damage. Cheaper: walk up and fight.
    const husk = () => sim.getSnapshot().enemies.find((e) => e.hp > 0)!;
    for (let k = 0; k < 900 && (me().ultCharge ?? 0) < ULT_CHARGE_MAX; k++) {
      const h = husk();
      const p = me();
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      const close = d < 40;
      step(1, intent({ moveX: close ? 0 : Math.sign(h.x - p.x), moveY: close ? 0 : Math.sign(h.y - p.y), attack: true, aimX: h.x, aimY: h.y }));
    }
    expect(me().ultCharge).toBe(ULT_CHARGE_MAX);
    const target = husk();
    const before = events.length;
    step(1, intent({ ability: 'r', aimX: target.x, aimY: target.y }));
    const used = events.slice(before).find((e) => e.type === 'ability_used');
    expect(used).toBeDefined();
    if (used?.type === 'ability_used') expect(used.abilityId).toBe(abilityId);
    expect(events.slice(before).some((e) => e.type === 'enemy_damaged')).toBe(true);
    expect(me().ultCharge).toBeLessThan(ULT_CHARGE_MAX);
    expect(me().abilityRCooldownMs).toBeGreaterThan(0);
    expect(CLASS_ABILITIES[classId].r).toBe(abilityId);
  });
});

describe('dash trail direction', () => {
  it('reports the direction of travel, not the aim direction', () => {
    const { events, step } = setup('bastion');
    // Aim far to the right, move down: the trail should point down (+y).
    step(1, intent({ moveX: 0, moveY: 1, dash: true, aimX: 1000, aimY: 0 }));
    const dash = events.find((e) => e.type === 'player_dashed');
    expect(dash).toBeDefined();
    if (dash?.type === 'player_dashed') expect(dash.facing).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('training range', () => {
  it('is entered from HQ only, unlocks E and R immediately, and returns via the exit', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: playerId, displayName: 'Trainee', classId: 'bastion' });
    const entered = sim.enterTraining();
    expect(entered[0]).toMatchObject({ type: 'room_entered', roomId: TRAINING_ROOM_ID });
    expect(sim.getPhase()).toBe('training');
    const snap = sim.getSnapshot();
    expect(snap.enemies).toHaveLength(trainingRoom.encounters.length);
    expect(snap.players[0]!.ultCharge).toBe(ULT_CHARGE_MAX);
    expect(snap.players[0]!.abilityEUnlocked).toBe(false); // not purchased...
    // ...but E works here anyway.
    const evs: GameEvent[] = [];
    sim.applyIntent(intent({ ability: 'e', aimX: 500, aimY: 200 }));
    evs.push(...sim.step());
    expect(evs.some((e) => e.type === 'ability_used' && e.abilityId === 'bastion.e.shockwave')).toBe(true);
    // Cannot enter training again from training; can return home through the exit tile.
    expect(sim.enterTraining()).toEqual([]);
    const exit = trainingRoom.exits[0]!;
    const target = tileToWorld(exit.x, exit.y);
    let reached = false;
    for (let k = 0; k < 2000 && !reached; k++) {
      const p = sim.getSnapshot().players[0]!;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      sim.applyIntent(intent({ moveX: dx / len, moveY: dy / len, aimX: target.x, aimY: target.y }));
      reached = sim.step().some((e) => e.type === 'exit_reached');
    }
    expect(reached).toBe(true);
    sim.returnToHeadquarters();
    expect(sim.getPhase()).toBe('headquarters');
    expect(sim.getSnapshot().players[0]!.ultCharge).toBe(0);
  });

  it('targets doze until approached, never down the player, and respawn after being defeated', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: playerId, displayName: 'Trainee', classId: 'bastion' });
    sim.enterTraining();
    for (let k = 0; k < 120; k++) sim.step();
    expect(sim.getSnapshot().enemies.every((e) => e.state === 'idle')).toBe(true);
    // Walk to the husk pen and fight it.
    const huskId = sim.getSnapshot().enemies.find((e) => e.enemyId === 'husk')!.id;
    const husk = () => sim.getSnapshot().enemies.find((e) => e.id === huskId)!;
    let minHp = 100;
    for (let k = 0; k < 1500 && husk().hp > 0; k++) {
      const h = husk();
      const p = sim.getSnapshot().players[0]!;
      minHp = Math.min(minHp, p.hp);
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      const close = d < 40;
      sim.applyIntent(intent({ moveX: close ? 0 : Math.sign(h.x - p.x), moveY: close ? 0 : Math.sign(h.y - p.y), attack: close, aimX: h.x, aimY: h.y }));
      sim.step();
    }
    expect(husk().hp).toBe(0);
    expect(minHp).toBeGreaterThan(0); // never downed
    for (let k = 0; k < Math.ceil(TRAINING_RESPAWN_MS / TICK_MS) + 5; k++) sim.step();
    expect(husk().hp).toBeGreaterThan(0);
    expect(sim.getSnapshot().players[0]!.state).not.toBe('down');
  });

  it('new operatives can afford exactly one E unlock at HQ', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: playerId, displayName: 'Rookie', classId: 'shade' });
    expect(sim.getSnapshot().players[0]!.resources).toBe(ABILITY_UNLOCK_COST);
    expect(sim.unlockAbility(playerId)).toHaveLength(1);
    expect(sim.unlockAbility(playerId)).toHaveLength(0);
  });
});
