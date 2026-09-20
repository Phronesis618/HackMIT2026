/**
 * Honesty: a world law the player is shown must do something. Every law a fixture uses, every
 * law `deriveWorldLaws` can pick and every law offered to the model is one the simulation or
 * renderer applies (docs/PRODUCT.md: never claim a feature that is not live).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorldFixtureSchema } from '../../src/shared/contracts';
import { LAW_INFO, WORLD_LAW_IDS, lawsAndLookRegistry, type WorldLawId } from '../../src/shared/laws';
import { MOTIF_IDS } from '../../src/shared/registry';
import { IMPLEMENTED_LAW_IDS, NEUTRAL_LAWS, deriveWorldLaws, lawEffectText, lawsAreNeutral, resolveLaws } from '../../src/sim/laws';
import { lintProse } from '../../src/shared/prose';

const implemented = new Set<WorldLawId>(IMPLEMENTED_LAW_IDS);
const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');

describe('world-law honesty', () => {
  it('LAW_INFO.implemented agrees with the simulation list', () => {
    expect(WORLD_LAW_IDS.filter((id) => LAW_INFO[id].implemented).sort()).toEqual([...IMPLEMENTED_LAW_IDS].sort());
  });

  it('every implemented law changes the resolved numbers and has its own effect text', () => {
    for (const lawId of IMPLEMENTED_LAW_IDS) {
      const law = { lawId, name: 'x', description: 'x', intensity: 0.5 };
      expect(lawsAreNeutral(resolveLaws([law])), lawId).toBe(false);
      expect(resolveLaws([law])).not.toEqual(NEUTRAL_LAWS);
      expect(lawEffectText(law), lawId).not.toBe(LAW_INFO[lawId].summary);
    }
  });

  it('fixtures only use implemented laws', () => {
    for (const file of fs.readdirSync(fixturesDir).filter((name) => name.endsWith('.json'))) {
      const fixture = WorldFixtureSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8')));
      const laws = (fixture.recipe as { laws?: Array<{ lawId: WorldLawId }> }).laws ?? [];
      expect(laws.length, file).toBeGreaterThanOrEqual(2);
      expect(laws.filter((law) => !implemented.has(law.lawId)).map((law) => `${file}: ${law.lawId}`)).toEqual([]);
    }
  });

  it('deriveWorldLaws only picks implemented laws, and its engine-written lines pass the linter', () => {
    for (const lead of MOTIF_IDS) {
      for (const second of MOTIF_IDS) {
        for (const seed of [1, 77, 9001]) {
          const { laws } = deriveWorldLaws({ motifIds: [lead, second], fog: 0.4, glowIntensity: 0.5 }, seed);
          expect(laws.length).toBeGreaterThanOrEqual(1);
          for (const law of laws) {
            expect(implemented.has(law.lawId), `${lead}/${second}: ${law.lawId}`).toBe(true);
            expect(lintProse(law.description, { kind: 'uiLabel' }).hardFail, law.description).toBe(false);
            expect(lintProse(law.name, { kind: 'itemName' }).hardFail, law.name).toBe(false);
          }
        }
      }
    }
  });

  it('the prompt registry offers the model implemented laws only', () => {
    const registry = lawsAndLookRegistry() as { laws: Record<string, string>; lawConflicts: Array<[WorldLawId, WorldLawId]> };
    expect(Object.keys(registry.laws).sort()).toEqual([...IMPLEMENTED_LAW_IDS].sort());
    for (const pair of registry.lawConflicts) for (const id of pair) expect(implemented.has(id)).toBe(true);
  });
});
