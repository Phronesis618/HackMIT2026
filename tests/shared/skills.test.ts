import { describe, expect, it } from 'vitest';
import { WorldFixtureSchema } from '../../src/shared/contracts';
import { lintProse } from '../../src/shared/prose';
import { ATTUNEMENT_EFFECT_IDS, ATTUNEMENT_EFFECT_INFO, CLASS_IDS, type AttunementEffectId } from '../../src/shared/registry';
import { buildSkillTree, ownedSkillEffects } from '../../src/shared/skills';
import fixtureData from '../../fixtures/worlds/vantage-spire.json';

const fixture = WorldFixtureSchema.parse(fixtureData);

describe('skill tree', () => {
  it.each(CLASS_IDS)('%s tree is a connected DAG rooted at the relay bond with a capstone', (classId) => {
    const tree = buildSkillTree(classId, null);
    const ids = new Set(tree.nodes.map((n) => n.id));
    expect(ids.size).toBe(tree.nodes.length);
    for (const node of tree.nodes) {
      for (const req of node.requires) {
        expect(ids.has(req)).toBe(true);
        expect(tree.nodes.find((n) => n.id === req)!.tier).toBeLessThan(node.tier);
      }
    }
    expect(tree.nodes.filter((n) => n.requires.length === 0)).toEqual([expect.objectContaining({ id: 'core.root', tier: 0 })]);
    expect(tree.nodes.filter((n) => n.tier === 5)).toHaveLength(1);
    expect(tree.nodes.filter((n) => n.kind === 'class').every((n) => n.id.startsWith(`${classId}.`))).toBe(true);
  });

  it('grows one attunement node per world attunement, chained up the right edge', () => {
    const tree = buildSkillTree('shade', { title: fixture.recipe.title, attunements: fixture.recipe.attunements });
    const attuned = tree.nodes.filter((n) => n.kind === 'attunement');
    expect(attuned).toHaveLength(fixture.recipe.attunements.length);
    expect(attuned[0]!.requires).toEqual(['core.salvage']);
    expect(attuned[1]!.requires).toEqual([attuned[0]!.id]);
    expect(attuned.every((n) => n.lane === 2 && n.effectId)).toBe(true);
    expect(tree.subtitle).toContain(fixture.recipe.title);
    expect(buildSkillTree('shade', null).nodes.some((n) => n.kind === 'attunement')).toBe(false);
  });

  it('marks implemented only the nodes whose effect the sim actually applies', () => {
    const tree = buildSkillTree('bastion', { title: fixture.recipe.title, attunements: fixture.recipe.attunements });
    for (const node of tree.nodes) {
      if (node.status === 'implemented' && node.cost > 0) expect(node.effectId, node.id).toBeDefined();
      if (node.kind === 'attunement') expect(node.status).toBe(ATTUNEMENT_EFFECT_INFO[node.effectId as AttunementEffectId].status);
      if (node.kind === 'class') expect(node.status).toBe('planned');
    }
    expect(tree.nodes.filter((n) => n.status === 'implemented').map((n) => n.id).sort())
      .toEqual(['core.root', 'core.salvage', 'core.wind', ...fixture.recipe.attunements.map((a, i) => `attune.${i}.${a.effectId}`)].sort());
    expect(ownedSkillEffects(tree, ['core.wind', 'core.plating', 'attune.0.' + fixture.recipe.attunements[0]!.effectId]))
      .toEqual(['second_wind', fixture.recipe.attunements[0]!.effectId]);
  });

  it('player-facing skill and attunement text passes the prose lint', () => {
    const tree = buildSkillTree('bastion', { title: fixture.recipe.title, attunements: fixture.recipe.attunements });
    for (const node of tree.nodes.filter((n) => n.status === 'implemented')) {
      const r = lintProse(node.description, { kind: 'skillNode' });
      expect(r.hardFail, `${node.id}: ${JSON.stringify(r.issues)}`).toBe(false);
    }
    for (const id of ATTUNEMENT_EFFECT_IDS) {
      const r = lintProse(ATTUNEMENT_EFFECT_INFO[id].summary, { kind: 'skillNode' });
      expect(r.hardFail, `${id}: ${JSON.stringify(r.issues)}`).toBe(false);
      expect(ATTUNEMENT_EFFECT_INFO[id].summary).toMatch(/\d|double|half/);
    }
  });
});
