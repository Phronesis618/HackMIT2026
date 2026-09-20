/**
 * B1 — DEMO_TUNING is the one home for the demo knobs.
 *
 * Two things are pinned here. First, every value, so moving the numbers into one file changed
 * none of them and a stray edit fails the suite rather than the demo. Second, that each constant
 * the rest of the codebase still imports really does read from DEMO_TUNING — a knob that is only
 * turned in one of two places is worse than two places.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUSTODIAN_BASE_HP, CUSTODIAN_HIT_CAP, CUSTODIAN_HP_PER_EXTRA_PLAYER,
  GATEKEEPER_BASE_HP, GATEKEEPER_HP_PER_EXTRA_PLAYER, custodianMaxHp, gatekeeperMaxHp, gatekeeperTier,
} from '../../src/shared/custodian';
import {
  ENEMY_HAZARD_MUL, ENV_KILL_CREDIT, HAZARD_BASE, HAZARD_INTERVAL_MS, HAZARD_STACK_MAX,
} from '../../src/shared/terrain';
import { OPENING_STRIKE_MAX_MUL } from '../../src/sim/effects';
import { FLOOR_TUNING, tierMultiplier } from '../../src/sim/floors';
import { DEMO_TUNING } from '../../src/sim/tuning';

describe('DEMO_TUNING', () => {
  // These are the DEMO PRESET values (docs/TUNING_DEMO_PRESET.md), not the original shipped
  // ones: bossHpBase/bossHitCap/corruptedFloor*/hazard*/tierScalePerTier/restHealFraction were
  // retuned so a solo operative wins the tier-4 Custodian 78% of the time instead of 53%. The
  // shipped values are in the doc and in the git history. Everything else is untouched.
  it('holds the demo preset values', () => {
    expect(DEMO_TUNING).toEqual({
      bossHpBase: 850,
      bossHpPerExtraPlayer: 400,
      gatekeeperHpBase: 320,
      gatekeeperHpPerExtraPlayer: 80,
      bossHitCap: 0.18,
      corruptedFloorTickMs: 900,
      corruptedFloorDamage: 6,
      hazardIntervalMs: 600,
      hazardBase: 2,
      hazardStackMax: 4,
      enemyHazardMul: 1.6,
      envKillCredit: 0.5,
      openingStrikeMaxMul: 3,
      tierScalePerTier: 0.1,
      restHealFraction: 0.6,
    });
  });

  it('is what the old constants read, so there is only one place to turn a knob', () => {
    expect(CUSTODIAN_BASE_HP).toBe(DEMO_TUNING.bossHpBase);
    expect(CUSTODIAN_HP_PER_EXTRA_PLAYER).toBe(DEMO_TUNING.bossHpPerExtraPlayer);
    expect(GATEKEEPER_BASE_HP).toBe(DEMO_TUNING.gatekeeperHpBase);
    expect(GATEKEEPER_HP_PER_EXTRA_PLAYER).toBe(DEMO_TUNING.gatekeeperHpPerExtraPlayer);
    expect(CUSTODIAN_HIT_CAP).toBe(DEMO_TUNING.bossHitCap);
    expect(HAZARD_INTERVAL_MS).toBe(DEMO_TUNING.hazardIntervalMs);
    expect(HAZARD_BASE).toBe(DEMO_TUNING.hazardBase);
    expect(HAZARD_STACK_MAX).toBe(DEMO_TUNING.hazardStackMax);
    expect(ENEMY_HAZARD_MUL).toBe(DEMO_TUNING.enemyHazardMul);
    expect(ENV_KILL_CREDIT).toBe(DEMO_TUNING.envKillCredit);
    expect(OPENING_STRIKE_MAX_MUL).toBe(DEMO_TUNING.openingStrikeMaxMul);
    expect(FLOOR_TUNING.tierScalePerTier).toBe(DEMO_TUNING.tierScalePerTier);
    expect(FLOOR_TUNING.restHealFraction).toBe(DEMO_TUNING.restHealFraction);

    // ...and the functions built on them still produce the numbers the preset implies.
    // 850 solo, +400 per extra operative; tier 4 is 1 + 0.1 * 4.
    expect([1, 2, 3, 4].map(custodianMaxHp)).toEqual([850, 1250, 1650, 2050]);
    expect(gatekeeperMaxHp(0, 1)).toBe(Math.round(gatekeeperTier(0).hp));
    expect(tierMultiplier(4)).toBeCloseTo(1.4, 6);
  });

  it('has a row in docs/TUNING.md for every knob, with its current value', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/TUNING.md'), 'utf8');
    for (const [name, value] of Object.entries(DEMO_TUNING)) {
      const row = doc.split('\n').find((line) => line.includes(`\`${name}\``) && line.startsWith('|'));
      expect(row, `docs/TUNING.md has no row for ${name}`).toBeDefined();
      expect(row, `docs/TUNING.md gives the wrong current value for ${name}`).toContain(`| ${value} |`);
    }
  });
});
