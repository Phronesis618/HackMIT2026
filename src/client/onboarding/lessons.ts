/**
 * The lesson registry. Order here is irrelevant; `priority` decides who speaks when two
 * lessons are ready in the same tick, and every predicate is pure so the tests can drive
 * them with a hand-built context.
 *
 * The curriculum, and the reason each line is this short, is docs/design/ONBOARDING.md §4.
 */
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import { TERRAIN_FEATURE_IDS, type TerrainFeatureId } from '../../shared/registry';
import { WORLD_LAW_IDS } from '../../shared/laws';
import { HUB_TEXT, lawLine, NOTE_TEXT, ROOM_KIND_TEXT, RUN_TEXT, terrainLine, type NotedRoomKind } from './text';
import type { Lesson, LessonContext } from './types';

// ---- priorities -----------------------------------------------------------------
// A prompt that keeps someone alive outranks a prompt that teaches them a place.
const P = { revive: 80, hub: 70, control: 62, adaptive: 66, terrain: 46, room: 44, finale: 50, law: 30 } as const;

// ---- small readers over the context ----------------------------------------------

const inRun = (ctx: LessonContext): boolean => ctx.phase === 'expedition' || ctx.phase === 'training';
const atHub = (ctx: LessonContext): boolean => ctx.phase === 'headquarters';

const me = (ctx: LessonContext) => ctx.snapshot?.players.find((p) => p.id === ctx.localPlayerId) ?? null;
const liveEnemies = (ctx: LessonContext): number => (ctx.snapshot?.enemies ?? []).filter((e) => e.state !== 'dead').length;

/** The kind of the room the crew is standing in, from the fog-of-war map the snapshot carries. */
export function currentRoomKind(ctx: LessonContext): string | null {
  const floor = ctx.snapshot?.floor;
  if (!floor) return null;
  return floor.map.find((room) => room.roomId === floor.roomId)?.kind ?? null;
}

/** A biome-exit gatekeeper: a boss-shaped guardian in a room with no Anchor in it. */
function gatekeeperPresent(ctx: LessonContext): boolean {
  const snapshot = ctx.snapshot;
  if (!snapshot || !snapshot.floor || snapshot.anchor) return false;
  return snapshot.enemies.some((e) => e.enemyId === 'guardian' && e.state !== 'dead');
}

const hud = (ctx: LessonContext) => ctx.model.hud;

// ---- the registry ------------------------------------------------------------------

/** Headquarters: the three things a stranger has to do, in order, plus the payoff pointer. */
const HUB_LESSONS: Lesson[] = [
  {
    id: 'hub.move',
    group: 'hub',
    scope: 'run',
    keys: ['W', 'A', 'S', 'D'],
    text: HUB_TEXT.move,
    priority: P.hub + 2,
    holdMs: 15_000,
    trigger: (ctx) => atHub(ctx) && ctx.phaseMs > 1500 && !ctx.facts.moved,
    satisfied: (ctx) => ctx.facts.moved,
  },
  {
    id: 'hub.weapon',
    group: 'hub',
    scope: 'run',
    text: HUB_TEXT.weapon,
    priority: P.hub + 1,
    holdMs: 25_000,
    trigger: (ctx) => atHub(ctx) && (ctx.facts.moved || ctx.phaseMs > 12_000) && !ctx.facts.tookWeapon,
    satisfied: (ctx) => ctx.facts.tookWeapon,
  },
  {
    id: 'hub.idea',
    group: 'hub',
    scope: 'run',
    text: HUB_TEXT.idea,
    priority: P.hub,
    holdMs: 30_000,
    trigger: (ctx) => atHub(ctx) && (ctx.facts.tookWeapon || ctx.phaseMs > 25_000) && !ctx.facts.contributed && ctx.model.world === null,
    satisfied: (ctx) => ctx.facts.contributed,
  },
  {
    id: 'hub.prepare',
    group: 'hub',
    scope: 'run',
    text: HUB_TEXT.prepare,
    priority: P.hub,
    holdMs: 20_000,
    trigger: (ctx) => atHub(ctx) && ctx.isHost && ctx.facts.contributed && ctx.model.world === null && ctx.model.generation.phase === 'idle',
    satisfied: (ctx) => ctx.model.world !== null,
  },
  {
    // Guests cannot prepare a world or open the gate. Saying so once beats a greyed button.
    id: 'hub.guest',
    group: 'hub',
    scope: 'run',
    text: HUB_TEXT.guestGate,
    priority: P.hub - 1,
    holdMs: 8000,
    // No `satisfied`: leaving the hub stops the trigger, which is what takes it away.
    trigger: (ctx) => atHub(ctx) && ctx.isCoOp && !ctx.isHost && ctx.facts.tookWeapon,
  },
  {
    id: 'hub.receipt',
    group: 'hub',
    scope: 'device',
    text: HUB_TEXT.receipt,
    priority: P.hub + 3,
    holdMs: 5000,
    trigger: (ctx) => atHub(ctx) && ctx.events.some((e) => e.type === 'world_prepared'),
  },
  {
    id: 'hub.gate',
    group: 'hub',
    scope: 'run',
    text: HUB_TEXT.gate,
    priority: P.hub,
    holdMs: 12_000,
    trigger: (ctx) => atHub(ctx) && ctx.model.world !== null && ctx.isHost,
  },
];

/** In a run: one control each, at the moment that control first matters. */
const CONTROL_LESSONS: Lesson[] = [
  {
    // Safety net only: a guest who joined mid-run, or the `autoenter` preview that skips the hub.
    id: 'run.move',
    group: 'controls',
    scope: 'run',
    keys: ['W', 'A', 'S', 'D'],
    text: RUN_TEXT.move,
    priority: P.control + 2,
    holdMs: 12_000,
    trigger: (ctx) => inRun(ctx) && ctx.phaseMs > 3000 && !ctx.facts.moved,
    satisfied: (ctx) => ctx.facts.moved,
  },
  {
    id: 'run.attack',
    group: 'controls',
    scope: 'run',
    keys: ['LMB'],
    text: RUN_TEXT.attack,
    priority: P.control + 1,
    holdMs: 12_000,
    trigger: (ctx) => inRun(ctx) && ctx.phaseMs > 1200 && liveEnemies(ctx) > 0 && !ctx.facts.attacked,
    satisfied: (ctx) => ctx.facts.attacked,
  },
  {
    // Adaptive, in George Fan's sense: the dash is offered to the player who just got hit.
    id: 'run.dash',
    group: 'controls',
    scope: 'run',
    keys: ['Shift'],
    text: RUN_TEXT.dash,
    priority: P.adaptive,
    holdMs: 12_000,
    trigger: (ctx) => inRun(ctx) && ctx.facts.tookDamage && !ctx.facts.dashed,
    satisfied: (ctx) => ctx.facts.dashed,
  },
  {
    id: 'run.ability_q',
    group: 'controls',
    scope: 'run',
    keys: ['Q'],
    text: RUN_TEXT.abilityQ,
    priority: P.control,
    holdMs: 12_000,
    trigger: (ctx) => inRun(ctx) && ctx.facts.roomsCleared >= 1 && !ctx.facts.usedQ,
    satisfied: (ctx) => ctx.facts.usedQ,
  },
  {
    id: 'run.unlock_e',
    group: 'controls',
    scope: 'run',
    keys: ['Tab'],
    text: RUN_TEXT.unlockE,
    priority: P.control - 1,
    holdMs: 9000,
    trigger: (ctx) => inRun(ctx) && (hud(ctx)?.resources ?? 0) >= ABILITY_UNLOCK_COST && hud(ctx)?.abilityEUnlocked !== true,
    satisfied: (ctx) => ctx.facts.unlockedE,
  },
  {
    id: 'run.ability_r',
    group: 'controls',
    scope: 'run',
    keys: ['R'],
    text: RUN_TEXT.abilityR,
    priority: P.control,
    holdMs: 10_000,
    trigger: (ctx) => inRun(ctx) && (hud(ctx)?.ultCharge ?? 0) >= 100 && !ctx.facts.usedR,
    satisfied: (ctx) => ctx.facts.usedR,
  },
  {
    id: 'run.map',
    group: 'controls',
    scope: 'run',
    keys: ['M'],
    text: RUN_TEXT.map,
    priority: P.control - 2,
    holdMs: 7000,
    trigger: (ctx) => inRun(ctx) && ctx.model.floor != null && ctx.facts.roomsEntered >= 3 && !ctx.facts.openedMap,
    satisfied: (ctx) => ctx.facts.openedMap,
  },
  {
    // Co-op only by construction: it needs a second operative on the floor.
    id: 'coop.revive',
    group: 'controls',
    scope: 'run',
    keys: ['Hold F'],
    text: RUN_TEXT.revive,
    priority: P.revive,
    holdMs: 15_000,
    trigger: (ctx) => inRun(ctx) && ctx.facts.teammateDown && me(ctx)?.state !== 'down',
    satisfied: (ctx) => ctx.facts.revivedSomeone,
  },
];

/** First-encounter notes: once per device, one flat sentence, no key to press. */
const NOTE_LESSONS: Lesson[] = [
  {
    id: 'note.doors',
    group: 'rooms',
    scope: 'device',
    text: NOTE_TEXT.doors,
    priority: P.room + 2,
    holdMs: 5000,
    trigger: (ctx) => inRun(ctx) && ctx.snapshot?.floor?.doorsLocked === true,
  },
  {
    id: 'note.choice',
    group: 'rooms',
    scope: 'device',
    text: NOTE_TEXT.choice,
    priority: P.room,
    holdMs: 6000,
    // The window between clearing the exit room and opening the door panel: the panel itself
    // covers the stage, and it already prints the keys.
    trigger: (ctx) => currentRoomKind(ctx) === 'exit' && ctx.snapshot?.floor?.doorsLocked === false && !ctx.snapshot?.floor?.biomeChoice,
  },
  {
    id: 'note.gatekeeper',
    group: 'finale',
    scope: 'device',
    text: NOTE_TEXT.gatekeeper,
    priority: P.finale,
    holdMs: 8000,
    trigger: gatekeeperPresent,
  },
  {
    // The HUD strip already narrates every stage of the ritual, so this is a reference entry
    // and never a prompt.
    id: 'note.ritual',
    group: 'finale',
    scope: 'device',
    text: NOTE_TEXT.ritual,
    priority: P.finale,
    holdMs: 0,
    silent: true,
    trigger: (ctx) => ctx.snapshot?.anchor?.ritual?.stage === 'relays',
  },
  {
    id: 'note.collapse',
    group: 'finale',
    scope: 'device',
    keys: ['M'],
    text: NOTE_TEXT.collapse,
    priority: P.finale,
    holdMs: 7000,
    trigger: (ctx) => ctx.snapshot?.collapse?.stage === 'collapse',
  },
  {
    id: 'note.relic',
    group: 'finale',
    scope: 'device',
    text: NOTE_TEXT.relic,
    priority: P.finale,
    holdMs: 7000,
    trigger: (ctx) => ctx.snapshot?.collapse?.stage === 'extraction',
  },
];

const ROOM_KIND_LESSONS: Lesson[] = (Object.keys(ROOM_KIND_TEXT) as NotedRoomKind[]).map((kind) => ({
  id: `note.room.${kind}`,
  group: 'rooms' as const,
  scope: 'device' as const,
  text: ROOM_KIND_TEXT[kind],
  priority: P.room,
  holdMs: 5000,
  trigger: (ctx: LessonContext) => currentRoomKind(ctx) === kind,
}));

/**
 * Terrain. The world's own name for the feature (`recipe.terrainSkins[].name`) then the
 * engine's plain effect, the first time a tile of that kind is in the room the crew entered.
 */
const TERRAIN_LESSONS: Lesson[] = TERRAIN_FEATURE_IDS.map((feature: TerrainFeatureId) => ({
  id: `note.terrain.${feature}`,
  group: 'terrain' as const,
  scope: 'device' as const,
  text: (ctx: LessonContext) => terrainLine(feature, ctx.world?.recipe.terrainSkins?.find((skin) => skin.featureId === feature)?.name),
  priority: P.terrain,
  holdMs: 5500,
  trigger: (ctx: LessonContext) => inRun(ctx) && ctx.terrainHere.includes(feature),
}));

/**
 * World laws. Only the ones the simulation actually applies: announcing a rule the engine
 * does not enforce is the same lie as an invented memory (docs/PRODUCT.md).
 */
const LAW_LESSONS: Lesson[] = WORLD_LAW_IDS.map((lawId) => ({
  id: `note.law.${lawId}`,
  group: 'laws' as const,
  scope: 'device' as const,
  text: (ctx: LessonContext) => {
    const law = ctx.model.world?.laws?.find((l) => l.lawId === lawId && l.active);
    return law ? lawLine(law.name, law.effect) : null;
  },
  priority: P.law,
  holdMs: 4000,
  trigger: (ctx: LessonContext) => inRun(ctx) && ctx.model.world?.laws?.some((l) => l.lawId === lawId && l.active) === true,
}));

export const LESSONS: readonly Lesson[] = [
  ...HUB_LESSONS,
  ...CONTROL_LESSONS,
  ...NOTE_LESSONS,
  ...ROOM_KIND_LESSONS,
  ...TERRAIN_LESSONS,
  ...LAW_LESSONS,
];

export const LESSON_BY_ID: ReadonlyMap<string, Lesson> = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
