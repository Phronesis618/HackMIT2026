/**
 * Skill-tree learning: resources buy implemented nodes between runs; effects are measurable.
 */
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, type GameEvent, type PlayerIntent, type PreparedWorld } from '../../src/shared/contracts';
import { DASH_COOLDOWN_MS, PLAYER_MAX_HP, ROOM_CLEAR_REWARD } from '../../src/shared/conventions';
import { buildSkillTree, IMPLEMENTED_SKILLS } from '../../src/shared/skills';
import { createSimulation, type Simulation } from '../../src/sim';

const playerId = 'skills-player';
const intent = (partial: Partial<PlayerIntent> = {}): PlayerIntent => ({
  playerId, seq: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false, ...partial,
});
const palette = {
  background: '#07090f', floor: '#141c2e', floorAlt: '#182238', wall: '#1f2b47', wallEdge: '#2fa8c9',
  accent: '#7cf5ff', accentSoft: '#2fa8c9', glow: '#7cf5ff', hazard: '#ff5c7a', text: '#dbe4f7',
};
function arena(): PreparedWorld {
  return PreparedWorldSchema.parse({
    worldId: 'skills-world', createdAt: 0,
    recipe: { title: 'Skills Arena', tagline: 't', themeSummary: 't', motifIds: ['spires'], palette,
      rooms: [{ name: 'Arena', description: '', motifIds: ['spires'], propIds: [], enemyIds: ['husk'], hazards: false }], contributionMappings: [], lore: [], attunements: [], rules: [] },
    art: { paletteFamily: 'ink-neon', palette, motifIds: ['spires'], skyline: 'spires', fog: 0, glowIntensity: 0.5 },
    plannedRoomCount: 1,
    rooms: [{
      id: 'skills-room', index: 0, name: 'Arena', description: '', width: 16, height: 8,
      tiles: ['################', '#..............#', '#..............#', '#.P............#', '#..............#', '#..............#', '#.........A....#', '################'],
      props: [], encounters: [{ id: 'husk', enemyId: 'husk', x: 5, y: 3, count: 1 }], exits: [], isFinal: true, attributions: [],
    }],
    provenance: { source: 'fixture', label: 'TEST', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: 'Skills Arena', source: 'fixture', headline: 't', lines: [] },
  });
}
const me = (sim: Simulation) => sim.getSnapshot().players.find((p) => p.id === playerId)!;

function setup(resources = 20): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Skills', classId: 'bastion' });
  sim.setWorld(arena());
  if (resources > 0) sim.grantResources(playerId, resources);
  return sim;
}

describe('skill learning', () => {
  it('only implemented nodes are learnable, requirements and cost are enforced, and the event is honest', () => {
    const sim = setup(20);
    const before = me(sim).resources ?? 0;
    expect(sim.learnSkill(playerId, 'bastion.last_light')).toEqual([]); // planned capstone
    expect(sim.learnSkill(playerId, 'bastion.sweep')).toEqual([]); // requires core.plating first
    const events = sim.learnSkill(playerId, 'core.plating');
    expect(events).toHaveLength(1);
    const event = events[0] as Extract<GameEvent, { type: 'skill_learned' }>;
    expect(event.type).toBe('skill_learned');
    expect(event.skillId).toBe('core.plating');
    expect(event.cost).toBe(2);
    expect(event.remainingResources).toBe(before - 2);
    expect(me(sim).skills).toEqual(['core.plating']);
    expect(me(sim).maxHp).toBe(PLAYER_MAX_HP + 20);
    expect(sim.learnSkill(playerId, 'core.plating')).toEqual([]); // no double-learn
    expect(sim.learnSkill(playerId, 'bastion.sweep')).toHaveLength(1); // now unlocked
    for (const id of IMPLEMENTED_SKILLS) expect(buildSkillTree('bastion', null).nodes.find((n) => n.id === id)?.status ?? buildSkillTree('shade', null).nodes.find((n) => n.id === id)?.status ?? buildSkillTree('beacon', null).nodes.find((n) => n.id === id)?.status ?? buildSkillTree('weaver', null).nodes.find((n) => n.id === id)?.status).toBe('implemented');
  });

  it('cannot be learned mid-expedition and refuses what you cannot afford', () => {
    const poor = setup(0); // starts with exactly one E-unlock's worth (3): one 2-cost node, then broke
    expect(poor.learnSkill(playerId, 'core.wind')).toHaveLength(1);
    expect(me(poor).resources).toBe(1);
    expect(poor.learnSkill(playerId, 'core.salvage')).toEqual([]);
    const sim = setup(20);
    sim.enterRoom(0);
    expect(sim.getPhase()).toBe('expedition');
    expect(sim.learnSkill(playerId, 'core.wind')).toEqual([]);
  });

  it('Second Wind shortens the dash cooldown; Salvager pays an extra resource per room clear', () => {
    const plain = setup(20);
    const winded = setup(20);
    expect(winded.learnSkill(playerId, 'core.wind')).toHaveLength(1);
    for (const sim of [plain, winded]) {
      sim.enterRoom(0);
      sim.applyIntent(intent({ seq: 1, moveX: 1, dash: true }));
      sim.step();
    }
    expect(me(winded).dashCooldownMs).toBeLessThan(me(plain).dashCooldownMs);
    expect(me(plain).dashCooldownMs).toBe(DASH_COOLDOWN_MS);

    const salvager = setup(20);
    expect(salvager.learnSkill(playerId, 'core.salvage')).toHaveLength(1);
    const control = setup(20);
    const clear = (sim: Simulation): number => {
      sim.enterRoom(0);
      const start = me(sim).resources ?? 0;
      for (let k = 0; k < 3000 && sim.getSnapshot().enemies.some((e) => e.hp > 0); k++) {
        const target = sim.getSnapshot().enemies.find((e) => e.hp > 0)!;
        sim.applyIntent(intent({ seq: k + 1, attack: true, aimX: target.x, aimY: target.y, moveX: Math.sign(target.x - me(sim).x), moveY: Math.sign(target.y - me(sim).y) }));
        sim.step();
      }
      for (let k = 0; k < 5; k++) sim.step();
      return (me(sim).resources ?? 0) - start;
    };
    const controlGain = clear(control);
    const salvagerGain = clear(salvager);
    expect(controlGain).toBeGreaterThanOrEqual(ROOM_CLEAR_REWARD);
    expect(salvagerGain).toBe(controlGain + 1);
  });
});
