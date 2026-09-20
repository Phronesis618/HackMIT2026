/**
 * DEMO_TUNING — the handful of numbers somebody will want to change five minutes before the
 * demo, in ONE place.
 *
 * Every entry here was already a constant somewhere; this module is now where the value LIVES
 * and those constants read from it, so a knob can be turned without hunting through four files
 * and without changing what any of them mean. **No value changed when this file was created.**
 *
 * `docs/TUNING.md` is the same table in prose: what each knob does, its current value and a safe
 * range. Read it before turning anything.
 *
 * This module imports NOTHING. That is deliberate: `src/shared` reads it too (terrain, custodian),
 * and a leaf with no dependencies cannot create a cycle or drag the sim into shared code.
 */

export const DEMO_TUNING = {
  // --- the last fight (docs/design/BOSS_FINALE.md §3) --------------------------------------
  /** Custodian health for a solo operative. The whole fight length keys off this. */
  bossHpBase: 850,
  /** Added per operative beyond the first. Health scales with the crew, never with the tier. */
  bossHpPerExtraPlayer: 400,
  /** Biome-exit gatekeeper (a one-phase preview of the Custodian) at tier 0, and per extra operative. */
  gatekeeperHpBase: 320,
  gatekeeperHpPerExtraPlayer: 80,
  /**
   * Share of the Custodian's max health a SINGLE hit may take. Dead Cells' Conjunctivius uses
   * 15 %; ours is 18 %. This is what keeps the three phases intact whatever a build does.
   */
  bossHitCap: 0.18,
  /** A corrupted conduit (and a live flood tile) hurts whoever stands on it this often... */
  corruptedFloorTickMs: 900,
  /** ...for this much, per tick. Flood tiles carry their own pattern damage instead. */
  corruptedFloorDamage: 6,

  // --- damaging terrain (docs/design/TILES.md T0, §1.1) -----------------------------------
  /** One '~' damage tick per this many ms of standing still in it. */
  hazardIntervalMs: 600,
  /** The ramp's step: tick n deals `hazardBase * n`, so 2, 4, 6, 8 at the default. */
  hazardBase: 2,
  /** The ramp stops here, so standing in fire is survivable for a known number of seconds. */
  hazardStackMax: 4,
  /** Enemies burn harder than the crew: kiting a pack across a hazard is meant to be worth it. */
  enemyHazardMul: 1.6,
  /** Share of a kill's reward and ult charge paid when the ROOM made the kill, not the crew. */
  envKillCredit: 0.5,

  // --- the opening strike (docs/design/WORLD_MUTATORS.md §4, docs/design/ITEMS.md §5) -------
  /**
   * Ceiling on the crew's first hit on an enemy. The `first_light` law (x2–3) and the
   * `first_strike` attunement (x2) name the same moment, so they do not multiply: the larger of
   * the two applies, and never above this. Without it a law-plus-attunement build opened at x6.
   */
  openingStrikeMaxMul: 3,

  // --- floors (docs/design/FLOORS.md §12) --------------------------------------------------
  /** Enemy health and damage grow by this much per biome tier. Tier 0 is the legacy numbers. */
  tierScalePerTier: 0.1,
  /** Share of max Integrity a rest site restores to every living operative, once per run. */
  restHealFraction: 0.6,
} as const;

export type DemoTuning = typeof DEMO_TUNING;
