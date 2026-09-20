/**
 * floorgen — public API of the floors generator.
 *
 * Owner: Agent F1a (floors). Everything exported here is pure and deterministic and
 * imports only from src/shared, so the client may import it too (lazy compile on both
 * ends). See docs/design/FLOORS.md.
 */
export { planWorldRoute, nextBiomeChoices, biomeTier, DEFAULT_BIOME_BRIEFS, DEFAULT_BIOME_IDS } from './route';
export {
  generateFloorPlan,
  renderFloorPlan,
  roomById,
  doorSides,
  gridSizeFor,
  minExitDepth,
  deadEndSpecialCap,
  eliteCap,
  clampDeadEndSpecials,
  combFallback,
  MAX_ATTEMPTS,
  type FloorPlanOptions,
} from './floorplan';
export { buildRoom, buildFloor, createLazyFloor, flood, bodyFootprint, bodyFits, bodyFlood, type BuiltFloor, type LazyFloor } from './rooms';
export {
  rollEncounters,
  encounterBudget,
  ENEMY_COST,
  RANGED_ENEMIES,
  MAX_ENEMIES_BY_SIZE,
  MAX_RANGED_BY_SIZE,
  type DirectorContext,
  type EncounterGroup,
} from './director';
export { ROOM_TEMPLATES, getTemplate, pickTemplate, FALLBACK_TEMPLATE_ID, type RoomTemplate } from './templates';
export { createRng, hashSeed, seedKey, type Rng } from './rng';
// --- F1b: world-level API (briefs for any recipe, terrain mutator, the shared room provider) ---
export { deriveBiomeBriefs, resolveBiomeBriefs, defaultBiomeTerrain, DERIVED_BIOME_IDS } from './briefs';
export { applyBiomeTerrain } from './terrain';
export {
  createFloorRuntime,
  createWorldFloorRuntime,
  isFloorsWorld,
  upgradeToFloors,
  floorsSeedFor,
  type FloorRuntime,
  type FloorRuntimeContext,
  type FloorNeighbour,
} from './runtime';
