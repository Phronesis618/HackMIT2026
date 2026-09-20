/**
 * World laws, resolved. The model picks `{ lawId, name, description, intensity }` from the closed
 * registry in src/shared/laws.ts; this module turns those picks into ONE clamped object of
 * multipliers the simulation and renderer read. Numeric bands: docs/design/WORLD_MUTATORS.md §2.
 *
 * `NEUTRAL_LAWS` is the safety story: every multiplier is 1 and every nullable is null, so a
 * world without laws plays byte-identically to a build without this module. Everything here is
 * pure and deterministic, so both ends of a co-op session resolve the same object.
 *
 * Owner: agent M1.
 */
import type { ArtRecipe, PreparedWorld, RoomEncounter } from '../shared/contracts';
import { PLAYER_MAX_HP } from '../shared/conventions';
import {
  ATMOSPHERE_IDS, FLOOR_MATERIAL_IDS, LAW_INFO, LIGHTING_IDS, PALETTE_FAMILY_IDS, WALL_STYLE_IDS,
  sanitizeLaws, type WorldLaw, type WorldLawId, type WorldLook,
} from '../shared/laws';
import type { MotifId } from '../shared/registry';
import { serverFlag } from '../shared/flags';

export interface ResolvedLaws {
  // movement
  dashSpeedMul: number; dashDurationMul: number; dashCooldownMul: number;
  /** Players AND enemies (tidal_drag). */
  walkSpeedMul: number;
  /** Share of walk speed kept while a basic attack is out. Default 0.35. */
  attackMoveMul: number;
  // combat
  playerMaxHp: number; playerDamageMul: number;
  abilityCooldownMul: number; ultChargeMul: number;
  abilityHealMul: number; relicHealHp: number; firstStrikeMul: number;
  // enemies
  enemyCountMul: number; enemyHpMul: number; enemyDamageMul: number;
  eliteFraction: number;
  deathBlast: { radius: number; playerDamage: number; enemyDamage: number } | null;
  reanimate: { delayMs: number; hpFraction: number; windowMs: number } | null;
  // terrain
  terrainFeatureBonus: number; terrainDensityStep: number;
  hazardDilation: { radius: number; speedMul: number; projectileMul: number } | null;
  splitRooms: boolean;
  // vision
  lightRadius: number | null; hideMinimap: boolean; telegraphMul: number; muteTells: boolean;
}

export const DEFAULT_ATTACK_MOVE_MUL = 0.35;

export const NEUTRAL_LAWS: Readonly<ResolvedLaws> = Object.freeze({
  dashSpeedMul: 1, dashDurationMul: 1, dashCooldownMul: 1, walkSpeedMul: 1, attackMoveMul: DEFAULT_ATTACK_MOVE_MUL,
  playerMaxHp: PLAYER_MAX_HP, playerDamageMul: 1, abilityCooldownMul: 1, ultChargeMul: 1,
  abilityHealMul: 1, relicHealHp: 0, firstStrikeMul: 1,
  enemyCountMul: 1, enemyHpMul: 1, enemyDamageMul: 1, eliteFraction: 0, deathBlast: null, reanimate: null,
  terrainFeatureBonus: 0, terrainDensityStep: 0, hazardDilation: null, splitRooms: false,
  lightRadius: null, hideMinimap: false, telegraphMul: 1, muteTells: false,
});

/** Laws the sim or renderer actually applies today. The rest resolve to numbers nobody reads yet. */
export const IMPLEMENTED_LAW_IDS: readonly WorldLawId[] = [
  'thin_air', 'tidal_drag', 'committed_strike', 'glass_lattice', 'long_echo', 'first_light',
  'few_and_terrible', 'the_many', 'unstable_matter', 'long_dark',
];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Pure: same picks in, same object out. Guard-rails (distinct ids, conflicts, group caps, budget)
 * run first through W2's `sanitizeLaws`; every product is clamped to a hard band afterwards so no
 * stack of laws can leave the playable range.
 */
export function resolveLaws(picks: readonly WorldLaw[] | null | undefined): ResolvedLaws {
  if (!picks || picks.length === 0) return { ...NEUTRAL_LAWS };
  const out: ResolvedLaws = { ...NEUTRAL_LAWS };
  for (const law of sanitizeLaws(picks).laws) {
    const i = clamp(Number.isFinite(law.intensity) ? law.intensity : 0.5, 0, 1);
    switch (law.lawId) {
      case 'thin_air':
        out.dashSpeedMul *= lerp(1.2, 1.6, i); out.dashDurationMul *= lerp(1.15, 1.4, i); out.dashCooldownMul *= lerp(1.1, 1.35, i); break;
      case 'tidal_drag':
        out.walkSpeedMul *= lerp(0.9, 0.75, i); out.dashCooldownMul *= lerp(0.8, 0.55, i); break;
      case 'committed_strike':
        out.attackMoveMul = lerp(0.2, 0, i); out.playerDamageMul *= lerp(1.15, 1.35, i); break;
      case 'glass_lattice':
        out.playerMaxHp = Math.round(lerp(60, 35, i)); out.playerDamageMul *= lerp(1.5, 2.1, i); break;
      case 'long_echo':
        out.abilityCooldownMul *= lerp(0.8, 0.55, i); out.ultChargeMul *= lerp(0.85, 0.65, i); break;
      case 'bleeding_light':
        out.abilityHealMul = 0; out.relicHealHp = Math.round(lerp(24, 40, i)); break;
      case 'first_light':
        out.firstStrikeMul = lerp(2, 3, i); break;
      case 'few_and_terrible':
        out.enemyCountMul *= lerp(0.65, 0.45, i); out.enemyHpMul *= lerp(1.8, 2.6, i); out.enemyDamageMul *= lerp(1.15, 1.4, i); break;
      case 'the_many':
        out.enemyCountMul *= lerp(1.5, 2.1, i); out.enemyHpMul *= lerp(0.6, 0.45, i); out.enemyDamageMul *= lerp(0.85, 0.7, i); break;
      case 'wardens_watch':
        out.eliteFraction = lerp(0.25, 0.5, i); break;
      case 'restless': {
        const delayMs = Math.round(lerp(14000, 9000, i));
        out.reanimate = { delayMs, hpFraction: lerp(0.35, 0.5, i), windowMs: delayMs }; break;
      }
      case 'unstable_matter':
        out.deathBlast = { radius: Math.round(lerp(56, 84, i)), playerDamage: Math.round(lerp(8, 16, i)), enemyDamage: Math.round(lerp(14, 26, i)) }; break;
      case 'hollow_ground':
        out.terrainFeatureBonus = i >= 0.4 ? 1 : 0; out.terrainDensityStep = i >= 0.7 ? 1 : 0; break;
      case 'slow_fire':
        out.hazardDilation = { radius: Math.round(lerp(72, 120, i)), speedMul: lerp(0.7, 0.45, i), projectileMul: lerp(0.85, 0.6, i) }; break;
      case 'sealed_halls':
        out.splitRooms = true; break;
      case 'long_dark':
        out.lightRadius = Math.round(lerp(260, 170, i)); break;
      case 'mirror_halls':
        out.hideMinimap = true; break;
      case 'held_breath':
        out.muteTells = true; out.telegraphMul = lerp(1.2, 1.45, i); break;
    }
  }
  // Hard bands: whatever the registry grows into, these keep the game playable.
  out.dashSpeedMul = clamp(out.dashSpeedMul, 1, 1.6);
  out.dashDurationMul = clamp(out.dashDurationMul, 1, 1.4);
  out.dashCooldownMul = clamp(out.dashCooldownMul, 0.55, 1.35);
  out.walkSpeedMul = clamp(out.walkSpeedMul, 0.75, 1);
  out.attackMoveMul = clamp(out.attackMoveMul, 0, DEFAULT_ATTACK_MOVE_MUL);
  out.playerMaxHp = clamp(out.playerMaxHp, 35, PLAYER_MAX_HP);
  out.playerDamageMul = clamp(out.playerDamageMul, 1, 2.5);
  out.abilityCooldownMul = clamp(out.abilityCooldownMul, 0.55, 1);
  out.ultChargeMul = clamp(out.ultChargeMul, 0.65, 1);
  out.firstStrikeMul = clamp(out.firstStrikeMul, 1, 3);
  out.enemyCountMul = clamp(out.enemyCountMul, 0.45, 2.1);
  out.enemyHpMul = clamp(out.enemyHpMul, 0.45, 2.6);
  out.enemyDamageMul = clamp(out.enemyDamageMul, 0.7, 1.4);
  return out;
}

/** True when the object changes nothing (cheap identity check first). */
export function lawsAreNeutral(laws: ResolvedLaws): boolean {
  return laws === NEUTRAL_LAWS || JSON.stringify(laws) === JSON.stringify(NEUTRAL_LAWS);
}

// ---------------------------------------------------------------------------
// Encounter director multipliers (few_and_terrible / the_many)
// ---------------------------------------------------------------------------

/** The existing room limit the doc names: never more than this many bodies from a law. */
export const LAW_ROOM_ENEMY_CAP = 12;
const ENCOUNTER_COUNT_MAX = 6;

/** Bosses and their stand-ins keep their authored group size and health under every law. */
export function lawsSpareEncounter(encounter: Pick<RoomEncounter, 'enemyId' | 'role'>): boolean {
  return encounter.enemyId === 'guardian' || encounter.role === 'gatekeeper' || encounter.role === 'guardian';
}

/**
 * Scales group sizes. One call site (the sim's spawn step) serves legacy compiled rooms and
 * floorgen-directed rooms alike, so both paths stay deterministic and need no recompile.
 * Output is still a legal `RoomSpec.encounters`: same length (<= 12), each count in 1..6, and a
 * law never pushes the room past `LAW_ROOM_ENEMY_CAP` bodies (a room authored above it is left alone).
 */
export function applyEncounterLaws<T extends Pick<RoomEncounter, 'enemyId' | 'role' | 'count'>>(encounters: readonly T[], laws: ResolvedLaws): T[] {
  if (laws.enemyCountMul === 1) return [...encounters];
  const scaled = encounters.map((encounter) => lawsSpareEncounter(encounter) ? encounter
    : { ...encounter, count: clamp(Math.round(encounter.count * laws.enemyCountMul), 1, ENCOUNTER_COUNT_MAX) });
  const total = (list: readonly T[]) => list.reduce((sum, encounter) => sum + encounter.count, 0);
  const cap = Math.max(LAW_ROOM_ENEMY_CAP, total(encounters));
  // Over the cap: trim the largest scaled group, last first, never below its authored size.
  for (let excess = total(scaled) - cap; excess > 0; excess--) {
    let target = -1;
    scaled.forEach((encounter, index) => {
      if (encounter.count > encounters[index]!.count && (target < 0 || encounter.count >= scaled[target]!.count)) target = index;
    });
    if (target < 0) break;
    scaled[target] = { ...scaled[target]!, count: scaled[target]!.count - 1 };
  }
  return scaled;
}

// ---------------------------------------------------------------------------
// Offline path: laws + look from the recipe's motifs when no model wrote any
// ---------------------------------------------------------------------------

/**
 * `RELAY_LAWS=1` (Node) or `?laws=1` (browser), mirroring `RELAY_FLOORS` / `?floors=1`. Only gates
 * DERIVED laws and look: picks present in a live recipe are always honoured.
 *
 * A server's answer WINS outright. Nothing in a `PreparedWorld` says whether its laws were
 * derived, so a browser that guessed differently from the server would render and describe a
 * different game from the one the server is simulating — which is what `?laws=1` on every client
 * was papering over. Env / URL are the fallback for a client that reached no server.
 */
export function lawsFlagEnabled(): boolean {
  const fromServer = serverFlag('laws');
  if (fromServer !== null) return fromServer;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RELAY_LAWS;
  if (env !== undefined && ['1', 'true'].includes(env.trim().toLowerCase())) return true;
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  return typeof search === 'string' && new URLSearchParams(search).get('laws') === '1';
}

interface MotifIdentity {
  laws: readonly [WorldLawId, WorldLawId, WorldLawId];
  names: Partial<Record<WorldLawId, string>>;
  look: Pick<WorldLook, 'paletteFamily' | 'floorMaterial' | 'wallStyle' | 'lighting' | 'atmosphere'>;
}

/** Authored, not generated: each motif implies a way the place plays and a way it looks. */
const MOTIF_IDENTITY: Record<MotifId, MotifIdentity> = {
  spires: { laws: ['thin_air', 'few_and_terrible', 'long_echo'], names: { thin_air: 'High Air', few_and_terrible: 'The Standing Watch', long_echo: 'Tower Repeater' },
    look: { paletteFamily: 'bleach', floorMaterial: 'slabs', wallStyle: 'blockwork', lighting: 'shafts', atmosphere: 'dust' } },
  arches: { laws: ['long_echo', 'the_many', 'committed_strike'], names: { long_echo: 'Vault Return', the_many: 'The Crowded Nave', committed_strike: 'Set Stance' },
    look: { paletteFamily: 'sodium', floorMaterial: 'flagstone', wallStyle: 'blockwork', lighting: 'overhead', atmosphere: 'dust' } },
  cables: { laws: ['committed_strike', 'the_many', 'long_echo'], names: { committed_strike: 'Tethered Strike', the_many: 'Line Noise', long_echo: 'Signal Return' },
    look: { paletteFamily: 'ink_neon', floorMaterial: 'grating', wallStyle: 'girder', lighting: 'rim', atmosphere: 'sparks' } },
  crystals: { laws: ['glass_lattice', 'long_echo', 'thin_air'], names: { glass_lattice: 'Glass Lattice', long_echo: 'Facet Return', thin_air: 'Clear Air' },
    look: { paletteFamily: 'bloom', floorMaterial: 'crystal', wallStyle: 'glass', lighting: 'underlit', atmosphere: 'glints' } },
  roots: { laws: ['the_many', 'tidal_drag', 'first_light'], names: { the_many: 'The Undergrowth', tidal_drag: 'Root Drag', first_light: 'First Cut' },
    look: { paletteFamily: 'rust', floorMaterial: 'organic', wallStyle: 'overgrown', lighting: 'overhead', atmosphere: 'spores' } },
  monoliths: { laws: ['few_and_terrible', 'committed_strike', 'first_light'], names: { few_and_terrible: 'The Few', committed_strike: 'Heavy Footing', first_light: 'First Mark' },
    look: { paletteFamily: 'monochrome', floorMaterial: 'slabs', wallStyle: 'hewn', lighting: 'flat', atmosphere: 'ash' } },
  ruined_machinery: { laws: ['committed_strike', 'few_and_terrible', 'long_echo'], names: { committed_strike: 'Seized Gears', few_and_terrible: 'Last Machines', long_echo: 'Idle Cycle' },
    look: { paletteFamily: 'rust', floorMaterial: 'plates', wallStyle: 'panelled', lighting: 'stormlight', atmosphere: 'embers' } },
  lanterns: { laws: ['first_light', 'long_echo', 'tidal_drag'], names: { first_light: 'First Light', long_echo: 'Relit Lamps', tidal_drag: 'Thick Air' },
    look: { paletteFamily: 'sodium', floorMaterial: 'boards', wallStyle: 'panelled', lighting: 'underlit', atmosphere: 'fireflies' } },
};

/** The derived (no-model) in-world line per law. No numbers: the engine's effect text carries those. */
const LAW_LINE: Record<WorldLawId, string> = {
  thin_air: 'The air is thin. A dash carries farther and takes longer to come back.',
  tidal_drag: 'The floor drags at boots. Walking is slow for everyone and dashes come back sooner.',
  committed_strike: 'Swings are heavy here. Feet stay planted until the swing ends.',
  glass_lattice: 'Thin plating all round. Hits land harder in both directions.',
  long_echo: 'Q and E come back early. The ultimate fills slowly.',
  bleeding_light: 'Abilities mend nothing here. Reading a relic does.',
  first_light: 'An enemy nobody has touched takes the first hit hard.',
  few_and_terrible: 'Fewer enemies per room, each much tougher.',
  the_many: 'More enemies per room, each weaker.',
  wardens_watch: 'Enemies wearing a ring are elites.',
  restless: 'A fallen enemy stands up once unless its marker is walked over.',
  unstable_matter: 'Enemies burst when they fall. Stand clear of the body.',
  hollow_ground: 'More terrain features per room.',
  slow_fire: 'Everything slows near a live hazard. Dashes do not.',
  sealed_halls: 'Combat rooms are split by a door, with the exit on the far side.',
  long_dark: 'Sight ends a short way from each operative. Hazards and attack warnings still show.',
  mirror_halls: 'No minimap. A room is named when it is entered.',
  held_breath: 'Attacks make no sound. Their warnings last longer and draw brighter.',
};

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface DerivedWorldLaws { laws: WorldLaw[]; look: WorldLook }

/**
 * No model: two laws and a look from the world's motifs, deterministically. The dominant motif
 * gives the first law and most of the look; the second motif gives the second law and the
 * lighting, so worlds that share a lead motif still part ways. `long_dark` is never derived
 * (the doc's call: do not hide the screen from someone seeing one world).
 */
export function deriveWorldLaws(art: Pick<ArtRecipe, 'motifIds' | 'fog' | 'glowIntensity'>, seed: number): DerivedWorldLaws {
  const lead = MOTIF_IDENTITY[art.motifIds[0] as MotifId] ?? MOTIF_IDENTITY.cables;
  const second = MOTIF_IDENTITY[(art.motifIds[1] ?? art.motifIds[0]) as MotifId] ?? lead;
  const unit = (salt: number) => ((Math.imul(seed ^ salt, 2654435761) >>> 0) % 1000) / 1000;
  const make = (identity: MotifIdentity, lawId: WorldLawId, salt: number): WorldLaw => ({
    lawId, name: identity.names[lawId] ?? lawId.replace(/_/g, ' '),
    description: LAW_LINE[lawId], intensity: Math.round((0.35 + unit(salt) * 0.4) * 100) / 100,
  });
  const first = make(lead, lead.laws[0], 11);
  let laws: WorldLaw[] = [first];
  for (const candidate of [...second.laws, ...lead.laws]) {
    if (candidate === first.lawId) continue;
    const attempt = sanitizeLaws([first, make(second.laws.includes(candidate) ? second : lead, candidate, 23)]).laws;
    if (attempt.length === 2) { laws = attempt; break; }
  }
  return {
    laws,
    look: {
      ...lead.look,
      lighting: second === lead ? lead.look.lighting : second.look.lighting,
      atmosphereDensity: Math.round(clamp(0.35 + art.fog * 0.6, 0, 1) * 100) / 100,
      skylineDepth: Math.round(unit(37) * 100) / 100,
      grain: Math.round(unit(41) * 0.6 * 100) / 100,
    },
  };
}

export interface WorldLawsView {
  laws: WorldLaw[];
  look: WorldLook | null;
  /** True when the engine chose these LAWS from the motifs; false when the model wrote them. */
  lawsDerived: boolean;
  /** Same question for the look. Tracked separately: a recipe may carry one and not the other. */
  lookDerived: boolean;
}

/**
 * What a world's laws and look ARE, for the sim, the renderer and the UI alike. Picks in the
 * recipe always win (sanitized). Without them, the offline derivation applies only when
 * `derive` is on, so default legacy output is untouched.
 *
 * `lawsDerived` / `lookDerived` are the provenance half: anything the engine chose must be
 * labelled as the engine's, never as the world's own writing (docs/PRODUCT.md).
 */
export function worldLawsView(world: Pick<PreparedWorld, 'worldId' | 'recipe' | 'art'> | null | undefined, derive: boolean = lawsFlagEnabled()): WorldLawsView {
  if (!world) return { laws: [], look: null, lawsDerived: false, lookDerived: false };
  const picked = world.recipe.laws && world.recipe.laws.length > 0 ? sanitizeLaws(world.recipe.laws).laws : null;
  const look = world.recipe.look ?? null;
  if ((picked && look) || !derive) return { laws: picked ?? [], look, lawsDerived: false, lookDerived: false };
  const derived = deriveWorldLaws(world.art, hashString(world.worldId));
  return {
    laws: picked ?? derived.laws, look: look ?? derived.look,
    lawsDerived: picked === null, lookDerived: look === null,
  };
}

// ---------------------------------------------------------------------------
// Player-facing effect text: game terms and the real numbers, nothing else (docs/WRITING.md 5.12)
// ---------------------------------------------------------------------------

const pct = (mul: number): string => `${Math.round(Math.abs(mul - 1) * 100)}%`;
const times = (mul: number): string => `${Math.round(mul * 100) / 100}x`;

/** One sentence for one law at ITS intensity. Laws the engine does not apply yet fall back to the registry summary. */
export function lawEffectText(law: WorldLaw): string {
  const r = resolveLaws([law]);
  switch (law.lawId) {
    case 'thin_air': return `Dash goes ${pct(r.dashSpeedMul * r.dashDurationMul)} farther. Dash cooldown +${pct(r.dashCooldownMul)}.`;
    case 'tidal_drag': return `Crew and enemies walk ${pct(r.walkSpeedMul)} slower. Dash cooldown -${pct(r.dashCooldownMul)}.`;
    case 'committed_strike': return `${r.attackMoveMul === 0 ? 'No movement' : `Movement at ${Math.round(r.attackMoveMul * 100)}%`} during a basic attack. Damage dealt +${pct(r.playerDamageMul)}.`;
    case 'glass_lattice': return `Integrity ${r.playerMaxHp} instead of ${PLAYER_MAX_HP}. Damage dealt ${times(r.playerDamageMul)}.`;
    case 'long_echo': return `Q and E cooldowns -${pct(r.abilityCooldownMul)}. Ultimate charges ${pct(r.ultChargeMul)} slower.`;
    case 'first_light': return `The crew's first hit on an enemy deals ${times(r.firstStrikeMul)} damage. The room's own damage does not count.`;
    case 'few_and_terrible': return `Enemy groups ${times(r.enemyCountMul)} size. Enemy health ${times(r.enemyHpMul)}, damage +${pct(r.enemyDamageMul)}.`;
    case 'the_many': return `Enemy groups ${times(r.enemyCountMul)} size, up to ${LAW_ROOM_ENEMY_CAP} per room. Enemy health ${times(r.enemyHpMul)}, damage -${pct(r.enemyDamageMul)}.`;
    case 'unstable_matter': {
      const blast = r.deathBlast!;
      return `Every enemy bursts when it dies: ${blast.enemyDamage} to enemies and ${blast.playerDamage} to the crew within ${blast.radius} px, less at the edge.`;
    }
    case 'long_dark': return `Hazard tiles and attack warnings always show. Everything else, enemies included, is hidden past ${r.lightRadius} px from each operative.`;
    default: return LAW_INFO[law.lawId].summary;
  }
}

// Re-exported so look consumers need one import.
export { ATMOSPHERE_IDS, FLOOR_MATERIAL_IDS, LIGHTING_IDS, PALETTE_FAMILY_IDS, WALL_STYLE_IDS };
