import { describe, expect, it } from 'vitest';
import { WorldFixtureSchema } from '../../src/shared/contracts';
import { CLASS_IDS } from '../../src/shared/registry';
import { buildSkillTree } from '../../src/shared/skills';
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
});
