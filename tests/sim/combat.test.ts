/**
 * Combat, objectives and Bastion abilities on a tiny hand-built world so tests never
 * depend on walking bots or fixture layouts.
 */
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, type GameEvent, type PlayerIntent, type PlayerProfile, type PreparedWorld } from '../../src/shared/contracts';
import {
  ANCHOR_PLANT_MS,
  ATTACK_DAMAGE,
  RUN_END_RETURN_MS,
  TETHER_PULL_DISTANCE,
  TICK_MS,
  tileToWorld,
} from '../../src/shared/conventions';
import { ENEMY_INFO } from '../../src/shared/registry';
import { createSimulation, type Simulation } from '../../src/sim';
import { LocalSession } from '../../src/client/transport/LocalSession';
import type { ProfileStore } from '../../src/shared/session';
import type { WorldProvider } from '../../src/client/transport/worldProviders';

const me = { id: 'test-p1', displayName: 'Tester', classId: 'bastion' as const };

function intent(partial: Partial<PlayerIntent> = {}): PlayerIntent {
  return { playerId: me.id, seq: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false, ...partial };
}

const palette = {
  background: '#07090f',
  floor: '#141c2e',
  floorAlt: '#182238',
  wall: '#1f2b47',
  wallEdge: '#2fa8c9',
  accent: '#7cf5ff',
  accentSoft: '#2fa8c9',
  glow: '#7cf5ff',
  hazard: '#ff5c7a',
  text: '#dbe4f7',
};

/** Room 0: player at (2,3), one husk at (6,3), exit east. Room 1: final, no enemies, Anchor at (5,2). */
export function makeTestWorld(husks = 1): PreparedWorld {
  return PreparedWorldSchema.parse({
    worldId: 'test-world-combat',
    createdAt: 0,
    recipe: {
      title: 'Test Arena',
      tagline: 'test',
      themeSummary: 'test',
      motifIds: ['spires'],
      palette,
      rooms: [
        { name: 'Arena', description: '', motifIds: ['spires'], propIds: [], enemyIds: ['husk'], hazards: false },
        { name: 'Vault', description: '', motifIds: ['spires'], propIds: [], enemyIds: [], hazards: false },
      ],
      contributionMappings: [],
    },
    art: { paletteFamily: 'ink-neon', palette, motifIds: ['spires'], skyline: 'spires', fog: 0, glowIntensity: 0.5 },
    plannedRoomCount: 2,
    rooms: [
      {
        id: 'test-room-0',
        index: 0,
        name: 'Arena',
        description: '',
        width: 12,
        height: 8,
        tiles: ['############', '#..........#', '#..........#', '#.P........X', '#..........#', '#..........#', '#..........#', '############'],
        props: [],
        encounters: husks > 0 ? [{ id: 'husk-pack', enemyId: 'husk', x: 6, y: 3, count: husks }] : [],
        exits: [{ x: 11, y: 3, toRoomIndex: 1, direction: 'east' }],
        isFinal: false,
        attributions: [],
      },
      {
        id: 'test-room-1',
        index: 1,
        name: 'Vault',
        description: '',
        width: 12,
        height: 8,
        tiles: ['############', '#..........#', '#....A.....#', '#.P........#', '#..........#', '#..........#', '#..........#', '############'],
        props: [],
        encounters: [],
        exits: [],
        isFinal: true,
        attributions: [],
      },
    ],
    provenance: { source: 'fixture', label: 'TEST', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: 'Test Arena', source: 'fixture', headline: 'test', lines: [] },
  });
}

function setup(opts: { husks?: number; unlocks?: Array<'bastion.e.shockwave'> } = {}): { sim: Simulation; events: GameEvent[]; step: (n: number, i?: PlayerIntent) => void } {
  const sim = createSimulation();
  sim.addPlayer(me, opts.unlocks ? ['attack', 'dash', 'bastion.q.bulwark', ...opts.unlocks] : undefined);
  sim.setWorld(makeTestWorld(opts.husks ?? 1));
  const events: GameEvent[] = [];
  events.push(...sim.enterRoom(0));
  const step = (n: number, i?: PlayerIntent): void => {
    for (let k = 0; k < n; k++) {
      if (i) sim.applyIntent(i);
      events.push(...sim.step());
    }
  };
  return { sim, events, step };
}

const husk = (sim: Simulation) => sim.getSnapshot().enemies[0]!;
const player = (sim: Simulation) => sim.getSnapshot().players[0]!;
const aimAtHusk = (sim: Simulation): Pick<PlayerIntent, 'aimX' | 'aimY'> => ({ aimX: husk(sim).x, aimY: husk(sim).y });

function waitForHuskState(sim: Simulation, step: (n: number, i?: PlayerIntent) => void, state: string, maxTicks = 400, i?: PlayerIntent): void {
  for (let k = 0; k < maxTicks && husk(sim).state !== state; k++) step(1, i);
}

describe('basic attack', () => {
  it('damages an enemy inside the frontal arc and not one behind', () => {
    const { sim, events, step } = setup();
    // Husk wakes up and closes in.
    waitForHuskState(sim, step, 'attacking');
    const before = husk(sim).hp;
    step(20, intent({ attack: true, ...aimAtHusk(sim) }));
    expect(husk(sim).hp).toBe(before - ATTACK_DAMAGE);
    expect(events.some((e) => e.type === 'enemy_damaged')).toBe(true);

    // Facing away: swings hit nothing.
    const dmgBefore = events.filter((e) => e.type === 'enemy_damaged').length;
    const p = player(sim);
    const h = husk(sim);
    const awayX = p.x - (h.x - p.x);
    const awayY = p.y - (h.y - p.y);
    step(40, intent({ attack: true, aimX: awayX, aimY: awayY }));
    expect(events.filter((e) => e.type === 'enemy_damaged').length).toBe(dmgBefore);
  });

  it('enforces attack cadence in the simulation regardless of input spam', () => {
    const { sim, events, step } = setup();
    waitForHuskState(sim, step, 'attacking');
    step(60, intent({ attack: true, ...aimAtHusk(sim) })); // 1 s of held attack
    const swings = events.filter((e) => e.type === 'player_attacked').length;
    expect(swings).toBeGreaterThanOrEqual(2);
    expect(swings).toBeLessThanOrEqual(3); // 360 ms cooldown -> at most 3 swings in ~1 s
  });
});

describe('room objective and reward', () => {
  it('clearing all enemies emits room_cleared once, rewards shards and unlocks the exit', () => {
    const { sim, events, step } = setup();
    waitForHuskState(sim, step, 'attacking');
    for (let k = 0; k < 400 && sim.getSnapshot().roomStatus?.cleared === false; k++) step(1, intent({ attack: true, ...aimAtHusk(sim) }));
    const snap = sim.getSnapshot();
    expect(snap.roomStatus).toMatchObject({ cleared: true, exitsLocked: false });
    expect(events.filter((e) => e.type === 'enemy_defeated')).toHaveLength(1);
    const cleared = events.filter((e) => e.type === 'room_cleared');
    expect(cleared).toHaveLength(1);
    expect(snap.players[0]!.shards).toBe(ENEMY_INFO.husk.shards + 10);
    expect(snap.run.roomsCleared).toBe(1);
    step(120); // no duplicate room_cleared later
    expect(events.filter((e) => e.type === 'room_cleared')).toHaveLength(1);
  });

  it('exit is inert while enemies remain', () => {
    const sim = createSimulation();
    sim.addPlayer(me);
    sim.setWorld(makeTestWorld(1));
    sim.enterRoom(0);
    expect(sim.getSnapshot().roomStatus?.exitsLocked).toBe(true);
    const events: GameEvent[] = [];
    const exit = tileToWorld(11, 3);
    for (let k = 0; k < 400; k++) {
      const p = player(sim);
      const dx = exit.x - p.x;
      const dy = exit.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      sim.applyIntent(intent({ moveX: dx / len, moveY: dy / len, aimX: exit.x, aimY: exit.y, dash: k % 60 === 0 }));
      events.push(...sim.step());
    }
    expect(events.some((e) => e.type === 'exit_reached')).toBe(false);
    expect(sim.getPhase()).toBe('expedition');
  });
});

describe('enemy AI and player health', () => {
  it('a husk chases, telegraphs, hits, and eventually downs an idle player; the run collapses', () => {
    const { sim, events, step } = setup();
    step(1500, intent());
    expect(events.some((e) => e.type === 'player_damaged')).toBe(true);
    expect(events.filter((e) => e.type === 'player_downed')).toHaveLength(1);
    const ended = events.filter((e) => e.type === 'run_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ outcome: 'collapsed' });
    expect(sim.getRun().status).toBe('collapsed');
    // Downed players cannot act; enemies freeze once the run ended.
    const hpBefore = player(sim).hp;
    step(60, intent({ attack: true, dash: true, moveX: 1 }));
    expect(player(sim).hp).toBe(hpBefore);
    expect(events.filter((e) => e.type === 'player_attacked' && e.tick > ended[0]!.tick)).toHaveLength(0);
  });

  it('counts down and exposes a return timer after the run ends', () => {
    const { sim, step } = setup();
    for (let k = 0; k < 1500 && sim.getRun().status === 'active'; k++) step(1, intent());
    expect(sim.getRun().status).toBe('collapsed');
    expect(sim.getRun().returnCountdownMs).toBe(RUN_END_RETURN_MS);
    step(Math.ceil(RUN_END_RETURN_MS / TICK_MS) + 2);
    expect(sim.getRun().returnCountdownMs).toBe(0);
  });

  it('telegraph timing is exposed to the renderer', () => {
    const { sim, step } = setup();
    waitForHuskState(sim, step, 'attacking');
    const h = husk(sim);
    expect(h.windupMs).toBeGreaterThan(0);
    expect(h.stateMs).toBeLessThanOrEqual(h.windupMs);
  });
});

describe('Bastion abilities', () => {
  it('Bulwark blocks a frontal strike without damage and goes on cooldown', () => {
    const { sim, events, step } = setup();
    waitForHuskState(sim, step, 'attacking');
    step(1, intent({ ability: 'q', ...aimAtHusk(sim) }));
    expect(player(sim).shieldMs).toBeGreaterThan(0);
    expect(player(sim).qCooldownMs).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'ability_used' && e.abilityId === 'bastion.q.bulwark')).toBe(true);
    const hp = player(sim).hp;
    // Let the telegraphed strike land while facing the husk.
    for (let k = 0; k < 60 && !events.some((e) => e.type === 'attack_blocked'); k++) step(1, intent(aimAtHusk(sim)));
    expect(events.some((e) => e.type === 'attack_blocked')).toBe(true);
    expect(player(sim).hp).toBe(hp);
    // Q again during cooldown does nothing.
    const uses = events.filter((e) => e.type === 'ability_used').length;
    step(1, intent({ ability: 'q' }));
    expect(events.filter((e) => e.type === 'ability_used').length).toBe(uses);
  });

  it('Magnetic Tether requires the unlock, then pulls and stuns enemies in the cone', () => {
    // Without the unlock: nothing happens.
    const locked = setup({ husks: 2 });
    locked.step(5, intent({ ...aimAtHusk(locked.sim) }));
    locked.step(1, intent({ ability: 'e', ...aimAtHusk(locked.sim) }));
    expect(locked.events.some((e) => e.type === 'ability_used')).toBe(false);

    // With the unlock: enemies land in front of the player, stunned.
    const { sim, events, step } = setup({ husks: 2, unlocks: ['bastion.e.shockwave'] });
    step(5, intent(aimAtHusk(sim)));
    step(1, intent({ ability: 'e', ...aimAtHusk(sim) }));
    const used = events.find((e) => e.type === 'ability_used');
    expect(used).toMatchObject({ abilityId: 'bastion.e.shockwave' });
    if (used?.type === 'ability_used') expect(used.targetEnemyIds.length).toBe(2);
    const p = player(sim);
    for (const e of sim.getSnapshot().enemies) {
      expect(e.state).toBe('stunned');
      expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThan(TETHER_PULL_DISTANCE + 60);
    }
    expect(p.eCooldownMs).toBeGreaterThan(0);
  });
});

describe('Anchor', () => {
  it('holding interact at the Anchor after clearing the final room plants it and ends the run as anchored', () => {
    const sim = createSimulation();
    sim.addPlayer(me);
    sim.setWorld(makeTestWorld(0));
    const events: GameEvent[] = [];
    events.push(...sim.enterRoom(0));
    // Room 0 has no enemies in this variant -> cleared immediately -> walk to the exit.
    expect(sim.getSnapshot().roomStatus?.exitsLocked).toBe(false);
    events.push(...sim.enterRoom(1));
    const anchor = sim.getSnapshot().anchor!;
    expect(anchor.state).toBe('dormant');
    // Walk to the anchor, then hold F.
    for (let k = 0; k < 600 && sim.getSnapshot().anchor?.state !== 'planted'; k++) {
      const p = player(sim);
      const dx = anchor.x - p.x;
      const dy = anchor.y - p.y;
      const d = Math.hypot(dx, dy);
      const near = d < 30;
      sim.applyIntent(intent({ moveX: near ? 0 : dx / d, moveY: near ? 0 : dy / d, aimX: anchor.x, aimY: anchor.y, interact: near }));
      events.push(...sim.step());
    }
    expect(sim.getSnapshot().anchor?.state).toBe('planted');
    expect(events.filter((e) => e.type === 'anchor_planted')).toHaveLength(1);
    const ended = events.find((e) => e.type === 'run_ended');
    expect(ended).toMatchObject({ outcome: 'anchored', roomsCleared: 2 });
    expect(ANCHOR_PLANT_MS).toBeGreaterThan(0);
  });
});

describe('LocalSession progression', () => {
  const provider: WorldProvider = { kind: 'client-fixture', prepareWorld: async () => makeTestWorld(1) };
  const noTimer = { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: () => {}, now: () => 0 };
  const store = (shards: number): ProfileStore => {
    let p: PlayerProfile = { version: 1, playerId: me.id, shards, unlockedAbilityIds: [], startingGrantApplied: true, runsPlayed: 0, updatedAt: 0 };
    return { get: () => p, save: (n) => void (p = n) };
  };

  it('class defaults (attack, dash, Q) are always unlocked even with an empty profile', async () => {
    const session = new LocalSession({ identity: me, worldProvider: provider, profile: store(0), scheduler: noTimer });
    await session.start();
    const unlocked = session.getSnapshot()?.players[0]?.unlockedAbilityIds ?? [];
    expect(unlocked).toEqual(expect.arrayContaining(['attack', 'dash', 'bastion.q.bulwark']));
    expect(unlocked).not.toContain('bastion.e.shockwave');
  });

  it('purchase validates ownership, class, cost and duplicates, and applies once', () => {
    const session = new LocalSession({ identity: me, worldProvider: provider, profile: store(100), scheduler: noTimer });
    expect(session.purchaseUnlock('shade.e.shroud')).toMatchObject({ ok: false });
    expect(session.purchaseUnlock('bastion.q.bulwark')).toMatchObject({ ok: false }); // free, not purchasable
    const first = session.purchaseUnlock('bastion.e.shockwave');
    expect(first.ok).toBe(true);
    expect(session.getProfile().shards).toBe(0);
    expect(session.getProfile().unlockedAbilityIds).toEqual(['bastion.e.shockwave']);
    expect(session.purchaseUnlock('bastion.e.shockwave')).toMatchObject({ ok: false, reason: expect.stringMatching(/already/) });
    expect(session.getSnapshot()?.players[0]?.unlockedAbilityIds).toContain('bastion.e.shockwave');
    session.dispose();
  });

  it('rejects when shards are insufficient', () => {
    const session = new LocalSession({ identity: me, worldProvider: provider, profile: store(40), scheduler: noTimer });
    expect(session.purchaseUnlock('bastion.e.shockwave')).toMatchObject({ ok: false, reason: expect.stringMatching(/Need 100/) });
    expect(session.getProfile().shards).toBe(40);
  });

  it('banks run shards into the profile exactly once when a run ends', async () => {
    const session = new LocalSession({ identity: me, worldProvider: provider, profile: store(0), scheduler: noTimer });
    await session.start();
    await session.requestWorld();
    session.enterPortal();
    // Fight the single husk through the session API: face it and hold attack.
    for (let k = 0; k < 900 && !session.getSnapshot()?.roomStatus?.cleared; k++) {
      const snap = session.getSnapshot()!;
      const h = snap.enemies[0];
      session.setIntent({ moveX: 0, moveY: 0, aimX: h?.x ?? 0, aimY: h?.y ?? 0, attack: true, dash: false, ability: null, interact: false });
      session.advance(TICK_MS);
    }
    const earned = ENEMY_INFO.husk.shards + 10;
    expect(session.getSnapshot()?.roomStatus?.cleared).toBe(true);
    expect(session.getSnapshot()?.players[0]?.shards).toBe(earned);
    session.returnToHeadquarters();
    expect(session.getProfile().shards).toBe(earned);
    expect(session.getProfile().runsPlayed).toBe(1);
    session.returnToHeadquarters(); // no-op, no double banking
    expect(session.getProfile().shards).toBe(earned);
    session.dispose();
  });
});
