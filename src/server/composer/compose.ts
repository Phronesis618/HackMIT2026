/**
 * Offline world composer — Agent A.
 *
 * Builds a complete, validated `WorldRecipe` from the players' real ideas in well under a
 * millisecond, with no model call. Ideas choose the theme(s) by keyword; the theme supplies
 * the construction motifs, palette, encounter mix, hazards, room banks, lore voice and
 * attunements; the players' own words are woven into the title, room names, tagline and
 * lore. Every contribution mapping the composer emits corresponds to a feature it actually
 * placed (the compiler cross-checks order), so the receipt stays honest.
 *
 * Output is deterministic for the same request (seeded), and different for different
 * ideas — two "pirate" worlds share a vocabulary but not a title, palette, layout or lore.
 */
import {
  FloorsWorldRecipeSchema,
  type ContributionMapping,
  type GenerationRequest,
  type LoreFragment,
  type Palette,
  type RoomBlueprint,
  type WorldRecipe,
} from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import type { EnemyId, MotifId, PropId } from '../../shared/registry';
import { sanitizeLaws, type WorldLaw, type WorldLawId } from '../../shared/laws';
import { BiomeBriefListSchema, type BiomeBrief, type BiomeLayout } from '../../shared/floors';
import { ENEMY_COST } from '../../shared/floorgen/director';
import { CREATURE_SYNONYMS, HAZARD_WORDS, PROP_SYNONYMS, REMAINS_TEMPLATES, STOPWORDS, THEMES, type ThemeDef } from './themes';

type RoomRole = 'entry' | 'mid' | 'final';

interface Idea {
  id: string;
  text: string;
  tokens: string[];
  /** Best word to echo back, Title Case, or null. */
  word: string | null;
}

interface RoomDraft {
  role: RoomRole;
  biomeIndex: number;
  name: string;
  description: string;
  motifIds: MotifId[];
  propIds: PropId[];
  enemyIds: EnemyId[];
  hazards: boolean;
  /** The player word this room was named after (for its name mapping / lore slot). */
  word: string | null;
  used: { encounter: boolean; prop: boolean; hazard: boolean; structure: boolean; name: boolean; motif: boolean };
}

const ENEMY_LABEL: Record<EnemyId, string> = {
  husk: 'husk', sentinel: 'sentinel', lurker: 'lurker', guardian: 'guardian',
  spewer: 'spewer', swarmling: 'swarmling', warden: 'warden', channeler: 'channeler',
};
const MOTIF_LABEL: Record<MotifId, string> = {
  spires: 'needle spires', arches: 'vaulted arches', cables: 'strung cables', crystals: 'crystal growths',
  roots: 'living roots', monoliths: 'carved monoliths', lanterns: 'hanging lanterns', ruined_machinery: 'ruined machinery',
};
/**
 * World laws (src/shared/laws.ts, docs/design/WORLD_MUTATORS.md): the two laws each theme reaches
 * for, drawn only from the set the simulation/renderer enforce today. Names and lines are the
 * world's own voice (house style: a number or an object in every line); the engine's exact
 * effect text is added by the UI. sanitizeLaws applies the conflict/budget guard-rails.
 */
const THEME_LAWS: Record<string, [WorldLawId, WorldLawId]> = {
  pirates: ['first_light', 'the_many'], drowned: ['tidal_drag', 'long_dark'], jungle: ['the_many', 'long_echo'],
  frozen: ['few_and_terrible', 'tidal_drag'], desert: ['committed_strike', 'first_light'], volcanic: ['committed_strike', 'few_and_terrible'],
  neon: ['long_echo', 'the_many'], haunted: ['long_dark', 'few_and_terrible'], void: ['thin_air', 'long_dark'],
  archive: ['long_echo', 'committed_strike'], swamp: ['tidal_drag', 'the_many'], clockwork: ['committed_strike', 'few_and_terrible'],
  crystal: ['glass_lattice', 'first_light'], storm: ['thin_air', 'first_light'], cathedral: ['long_echo', 'first_light'],
  festival: ['thin_air', 'the_many'],
  hive: ['the_many', 'long_echo'], wasteland: ['few_and_terrible', 'committed_strike'], frontier: ['first_light', 'committed_strike'],
};
const LAW_VOICE: Record<WorldLawId, { noun: string; line: string }> = {
  thin_air: { noun: 'Thin Air', line: 'Thin air over the {word}: a dash carries 65% farther and its cooldown runs 25% longer.' },
  tidal_drag: { noun: 'Drag', line: 'Everything wades here at 83% pace; the dash comes back a third sooner to make up the ground.' },
  committed_strike: { noun: 'Stance', line: 'A strike roots the striker for 220 ms and lands 25% harder; a planted foot pays in the {word}.' },
  glass_lattice: { noun: 'Lattice', line: 'Integrity is 48 instead of 100, and every blow lands at 1.8 times its weight: glass on glass in the {word}.' },
  long_echo: { noun: 'Echo', line: 'Abilities return a third sooner in the {word}; the ultimate charges 25% slower.' },
  bleeding_light: { noun: 'Bleeding Light', line: 'Abilities heal nothing; a relic read restores 32 Integrity to every living operative, once.' },
  first_light: { noun: 'First Light', line: 'The first blow on an untouched hostile lands at 2.5 times its weight anywhere in the {word}.' },
  few_and_terrible: { noun: 'Few', line: 'Half the hostiles, each at 2.2 times the health and 28% more bite; duels all the way through the {word}.' },
  the_many: { noun: 'Many', line: '1.8 times the hostiles at 55% health and 78% bite; wide swings pay all the way through the {word}.' },
  wardens_watch: { noun: 'Watch', line: 'About 37% of hostiles are elites: 60% more health, 25% more bite, a visible ring, better drops.' },
  restless: { noun: 'Restless', line: 'A defeated hostile stands back up once after 11.5 s at 42% health unless someone crosses its marker.' },
  unstable_matter: { noun: 'Unstable Matter', line: 'A hostile bursts when it falls: 70 px, 12 damage to the crew, 20 to other hostiles.' },
  hollow_ground: { noun: 'Hollow Ground', line: 'Every room gains one extra terrain feature and a denser floor.' },
  slow_fire: { noun: 'Slow Fire', line: 'Within 3 tiles of a live hazard everything moves at 57% speed and bolts at 72%.' },
  sealed_halls: { noun: 'Sealed Halls', line: 'Every combat room is split by a sealing door with the exit on the far side.' },
  long_dark: { noun: 'Dark', line: 'Sight fails past 215 px of an operative in the {word}; lanterns and conduits add 1 pool of light each.' },
  mirror_halls: { noun: 'Mirror Halls', line: 'The minimap stays blank and a room keeps its name until an operative steps inside.' },
  held_breath: { noun: 'Held Breath', line: 'Hostile attack sounds are muted; every telegraph lasts 32% longer and draws brighter.' },
};

/** Legacy pipeline: at most three rooms per world (the floors pipeline derives its biomes from the recipe). */
const MAX_ROOMS = 3;

/**
 * Floors briefs (docs/design/FLOORS.md): 1 opener + 3 pairs of choices + 1 finale. Each slot has a
 * layout personality; the composer fills the slots with its themes so a floors run through a
 * composed world changes construction, palette vocabulary and enemy mix at every biome choice.
 */
/** Brief slot → route tier (1 opener, 2+2+2 choices, 1 finale) and the encounter caps floorgen's own
 * derived briefs use per tier, so a composed opener is as gentle as a derived one. */
const SLOT_TIER = [0, 1, 1, 2, 2, 3, 3, 4] as const;
const TIER_POOL_SIZE = [2, 3, 3, 4, 4] as const;
const TIER_MAX_COST = [2, 3, 4, 5, 5] as const;

const BRIEF_LAYOUTS: Array<{ noun: string; layout: BiomeLayout; hazards: boolean }> = [
  { noun: 'Approach', hazards: false, layout: { linearity: 0.8, branchiness: 0.2, specials: { treasure: 1, lore: 1, rest: 0, elite: 0 } } },
  { noun: 'Warren', hazards: true, layout: { linearity: 0.1, branchiness: 0.9, specials: { treasure: 1, lore: 3, rest: 1, elite: 1 } } },
  { noun: 'Wall', hazards: false, layout: { linearity: 0.95, branchiness: 0.05, specials: { treasure: 1, lore: 1, rest: 0, elite: 3 } } },
  { noun: 'Crossing', hazards: false, layout: { linearity: 0.3, branchiness: 0.6, specials: { treasure: 1, lore: 2, rest: 1, elite: 2 } } },
  { noun: 'Vaults', hazards: true, layout: { linearity: 0.55, branchiness: 0.45, specials: { treasure: 2, lore: 1, rest: 0, elite: 3 } } },
  { noun: 'Shelter', hazards: false, layout: { linearity: 0.35, branchiness: 0.35, specials: { treasure: 1, lore: 2, rest: 2, elite: 1 } } },
  { noun: 'Works', hazards: true, layout: { linearity: 0.7, branchiness: 0.3, specials: { treasure: 1, lore: 1, rest: 1, elite: 2 } } },
  { noun: 'Core', hazards: true, layout: { linearity: 0.5, branchiness: 0.5, specials: { treasure: 2, lore: 2, rest: 2, elite: 4 } } },
];

const ROOM_NOUNS: Record<RoomRole, string[]> = {
  entry: ['Gate', 'Threshold', 'Landing', 'Approach'],
  mid: ['Gallery', 'Hall', 'Hold', 'Crossing'],
  final: ['Sanctum', 'Heart', 'Core', 'Crown'],
};

/** mulberry32 — small, deterministic, good enough for variation. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length]!;
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`);
const titleCase = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** Display-safe: letters, digits, spaces and a few punctuation marks; never markup or URLs. */
function sanitize(text: string, max: number): string {
  const cleaned = text.replace(/[^\p{L}\p{N} ,.'!?-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return clip(cleaned, max);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' -]/g, ' ').split(/[\s-]+/).map((t) => t.replace(/^'+|'+$/g, '')).filter(Boolean);
}

/** Loose stem match: exact, singular/plural, or prefix for stems of four or more letters. */
function matches(token: string, stem: string): boolean {
  if (token === stem) return true;
  const singular = token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  if (singular === stem) return true;
  return stem.length >= 4 && (token.startsWith(stem) || singular.startsWith(stem));
}

const CONCRETE_NOUNS = [...CREATURE_SYNONYMS.flatMap((c) => c.words), ...PROP_SYNONYMS.flatMap((p) => p.words)];

/**
 * The word of an idea worth echoing in names: a concrete noun we know (creature or prop
 * vocabulary) if present, else the longest content word. Short words are usually glue.
 */
const SUBORDINATORS = new Set(['where', 'that', 'which', 'with', 'and', 'who', 'whose', 'while', 'because', 'so', 'but', 'when', 'as', 'in', 'on', 'under', 'over', 'run', 'full']);

function salientWord(tokens: string[]): string | null {
  const ok = (t: string): boolean => t.length >= 3 && /^[a-z']+$/.test(t) && !STOPWORDS.has(t);
  const candidates = tokens.filter(ok);
  if (candidates.length === 0) return null;
  // The head noun phrase is what comes before the first clause break ("a drowned cathedral | where…").
  const cut = tokens.findIndex((t) => SUBORDINATORS.has(t));
  const head = (cut > 0 ? tokens.slice(0, cut) : tokens).filter(ok);
  const pool = head.length > 0 ? head : candidates;
  const concrete = pool.find((t) => CONCRETE_NOUNS.some((stem) => matches(t, stem)));
  // English noun phrases end on their head noun ("volcanic forge", "clockwork factory").
  const best = concrete ?? pool[pool.length - 1]!;
  return titleCase(best.replace(/'/g, '')).slice(0, 16);
}

function scoreTheme(theme: ThemeDef, tokens: string[]): number {
  let score = 0;
  for (const token of tokens) for (const stem of theme.keywords) if (matches(token, stem)) { score++; break; }
  return score;
}

// ---------------------------------------------------------------------------
// Colour helpers (server-side; the client has its own in src/client/render/color.ts)
// ---------------------------------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const toHex = (v: number): string => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return s === 0 ? `#${toHex(l)}${toHex(l)}${toHex(l)}` : `#${toHex(channel(hue + 1 / 3))}${toHex(channel(hue))}${toHex(channel(hue - 1 / 3))}`;
}

function shift(hex: string, dh: number, ds: number, dl: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + dh, Math.min(1, Math.max(0, s + ds)), Math.min(0.97, Math.max(0.03, l + dl)));
}

function jitterPalette(base: Palette, secondary: ThemeDef | null, rand: () => number): Palette {
  const dh = (rand() - 0.5) * 26;
  const ds = (rand() - 0.5) * 0.08;
  const dl = (rand() - 0.5) * 0.05;
  const out: Palette = {
    background: shift(base.background, dh, 0, 0),
    floor: shift(base.floor, dh, ds, dl),
    floorAlt: shift(base.floorAlt, dh, ds, dl),
    wall: shift(base.wall, dh, ds, dl),
    wallEdge: shift(base.wallEdge, dh, ds, 0),
    accent: shift(base.accent, dh, ds, 0),
    accentSoft: secondary ? shift(secondary.palette.accent, dh * 0.5, 0, 0) : shift(base.accentSoft, dh, ds, 0),
    glow: shift(base.glow, dh, 0, 0),
    hazard: shift(base.hazard, dh * 0.3, 0, 0),
    text: base.text,
  };
  return out;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface Composition {
  recipe: WorldRecipe;
  /** Which themes were chosen and why — for logs, tests and provenance notes. */
  themes: { primary: string; secondary: string | null; scores: Record<string, number> };
}

export function composeWorld(request: GenerationRequest): Composition {
  const ideas: Idea[] = request.contributions.slice(0, 24).map((c) => {
    const tokens = tokenize(c.text);
    return { id: c.id, text: sanitize(c.text, 60), tokens, word: salientWord(tokens) };
  });
  const seedText = `${request.requestId}|${request.seed ?? ''}|${ideas.map((i) => i.text).join('|')}`;
  const rand = rng(hashString(seedText));

  // Theme selection: total keyword hits across all ideas; ties broken by the seed.
  const scores: Record<string, number> = {};
  // The first idea typed is usually the premise; weight it a little more than later additions.
  for (const theme of THEMES) scores[theme.id] = ideas.reduce((sum, idea, index) => sum + scoreTheme(theme, idea.tokens) * (index === 0 ? 1.5 : 1), 0);
  const ranked = [...THEMES].sort((a, b) => (scores[b.id]! - scores[a.id]!) || (hashString(a.id + seedText) % 7) - (hashString(b.id + seedText) % 7));
  const primary = (scores[ranked[0]!.id] ?? 0) > 0 ? ranked[0]! : THEMES[Math.floor(rand() * THEMES.length)]!;
  const secondaryCandidate = ranked.find((t) => t.id !== primary.id && (scores[t.id] ?? 0) > 0) ?? null;
  const secondary = secondaryCandidate;

  const word = ideas.find((i) => i.word)?.word ?? null;
  // Every distinct player word gets a turn in room names instead of repeating the first one.
  const words = [...new Set(ideas.map((i) => i.word).filter((w): w is string => w !== null))];
  let wordCursor = 0;
  const nextWord = (): string | null => (words.length > 0 ? words[wordCursor++ % words.length]! : null);
  const lowerWord = word ? word.toLowerCase() : pick(rand, primary.nouns).toLowerCase();
  const fill = (template: string, w: string | null = word): string => template.replace(/\{word\}/g, w ?? pick(rand, primary.nouns));
  const fillLower = (template: string): string => template.replace(/\{word\}/g, lowerWord).replace(/\{flavor\}/g, primary.remainsFlavor);

  // Motifs: primary construction; the secondary theme contributes its own signature motif.
  const motifIds: MotifId[] = [...primary.motifs];
  if (secondary) {
    const foreign = secondary.motifs.find((m) => !motifIds.includes(m));
    if (foreign) motifIds.splice(2, 1, foreign);
  }
  const uniqueMotifs = [...new Set(motifIds)].slice(0, 4);

  const palette = jitterPalette(primary.palette, secondary, rand);

  // Biomes: the expedition crosses up to three regions. The first is the primary theme; the
  // second belongs to the secondary theme when the ideas suggested one (else a deterministic
  // sibling theme), so the world visibly changes construction and palette mid-run; the last
  // is the primary theme's deep interior — darker, denser, where the guardian waits.
  const n = Math.min(MAX_ROOMS, Math.max(1, request.plannedRoomCount));
  const counts = distributeRooms(n);
  const sibling = secondary ?? THEMES.filter((t) => t.id !== primary.id && t.motifs.some((m) => primary.motifs.includes(m)))[Math.floor(rand() * 3)] ?? THEMES[(THEMES.indexOf(primary) + 5) % THEMES.length]!;
  const biomeThemes: ThemeDef[] = counts.length === 1 ? [primary] : counts.length === 2 ? [primary, sibling] : [primary, sibling, primary];
  const biomeNames = biomeThemes.map((theme, b) => {
    const adjective = pick(rand, theme.adjectives);
    const noun = pick(rand, theme.nouns);
    return clip(b === 0 ? `Outer ${noun}` : b === biomeThemes.length - 1 && b > 0 ? `Deep ${noun}` : `${adjective} ${noun}`, 80);
  });
  const biomeMotifs: MotifId[][] = biomeThemes.map((theme, b) => {
    if (b === 0) return uniqueMotifs.slice(0, 3);
    if (b === biomeThemes.length - 1 && b > 0) return [...new Set([uniqueMotifs[3] ?? uniqueMotifs[1] ?? uniqueMotifs[0]!, uniqueMotifs[0]!, uniqueMotifs[2] ?? uniqueMotifs[0]!])].slice(0, 3);
    return [...new Set(theme.motifs)].slice(0, 3);
  });

  const rooms: RoomDraft[] = [];
  counts.forEach((count, b) => {
    const theme = biomeThemes[b]!;
    const lastBiome = b === counts.length - 1;
    for (let k = 0; k < count; k++) {
      const globalIndex = rooms.length;
      const role: RoomRole = globalIndex === 0 && n > 1 ? 'entry' : lastBiome && k === count - 1 ? 'final' : 'mid';
      const bank = theme.rooms[role];
      const motifs = biomeMotifs[b]!;
      const roomMotifs: MotifId[] = role === 'entry'
        ? [motifs[0]!, motifs[1] ?? motifs[0]!]
        : role === 'mid'
          ? [motifs[(k + 1) % motifs.length]!, motifs[0]!]
          : [motifs[0]!, motifs[2] ?? motifs[1] ?? motifs[0]!];
      const pool = [...theme.props];
      const props: PropId[] = [];
      const propCount = 4 + Math.floor(rand() * 2);
      while (props.length < propCount && pool.length > 0) props.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
      if (role === 'final') props.unshift('anchor_pedestal');
      const enemyPool = theme.enemies[role];
      const enemies: EnemyId[] = role === 'final'
        ? ['guardian', enemyPool.find((e) => e !== 'guardian') ?? pick(rand, theme.enemies.mid)]
        : [...enemyPool];
      // Deeper rooms bring in a heavier mix; the last biome leans on the primary theme's mid pool.
      if (role !== 'final' && (globalIndex >= 2 ? rand() < 0.7 : rand() < 0.35)) {
        const extra = pick(rand, (lastBiome ? primary : theme).enemies.mid);
        if (!enemies.includes(extra) && extra !== 'guardian') enemies.push(extra);
      }
      const hazards = rand() < theme.hazardChance + (role === 'final' ? 0.1 : 0) + (lastBiome ? 0.1 : 0);
      // At most one player-named room per biome; the rest use the theme's own names.
      const namedHere = rooms.some((r) => r.biomeIndex === b && r.word !== null);
      const plainNames = bank.names.filter((t) => !t.includes('{word}'));
      const candidates = namedHere && plainNames.length > 0 ? plainNames : bank.names;
      const unused = candidates.filter((t) => !rooms.some((r) => r.name === fill(t, word)));
      const nameTemplate = pick(rand, unused.length > 0 ? unused : candidates);
      const usesWord = nameTemplate.includes('{word}');
      const roomWord = usesWord ? nextWord() : null;
      rooms.push({
        role,
        biomeIndex: b,
        name: clip(fill(nameTemplate, roomWord ?? word), 80),
        description: clip(fill(pick(rand, bank.descriptions), roomWord ?? word), 300),
        motifIds: [...new Set(roomMotifs)].slice(0, 3),
        propIds: props.slice(0, 6),
        enemyIds: [...new Set(enemies)].slice(0, 3),
        hazards,
        word: usesWord ? roomWord ?? word : null,
        used: { encounter: false, prop: false, hazard: false, structure: false, name: usesWord && (roomWord ?? word) !== null, motif: false },
      });
    }
  });
  const finalIndex = rooms.length - 1;

  // Contribution mappings: at most one per idea, each describing a feature we really place.
  const mappings: ContributionMapping[] = [];
  const all = rooms.map((_, i) => i);
  const roomOrder = (prefer: number[]): number[] => [...prefer, ...all].filter((i, k, arr) => i >= 0 && i < rooms.length && arr.indexOf(i) === k);
  const nonFinalFirst = roomOrder([1, 2, 0]).filter((i) => i !== finalIndex || rooms.length === 1);
  for (const idea of ideas) {
    const creature = CREATURE_SYNONYMS.find((entry) => idea.tokens.some((t) => entry.words.some((w) => matches(t, w))));
    if (creature) {
      const target = creature.enemyId === 'guardian'
        ? finalIndex
        : [...nonFinalFirst, finalIndex].find((i) => !rooms[i]!.used.encounter) ?? finalIndex;
      const room = rooms[target]!;
      if (!room.used.encounter) {
        const rest = room.enemyIds.filter((e) => e !== creature.enemyId);
        const guardian: EnemyId = 'guardian';
        room.enemyIds = (room.role === 'final' && creature.enemyId !== guardian
          ? [creature.enemyId, guardian, ...rest.filter((e) => e !== guardian)]
          : [creature.enemyId, ...rest]).slice(0, 3);
        room.used.encounter = true;
        mappings.push({ contributionId: idea.id, kind: 'encounter', roomIndex: target, featureDescription: clip(`${ENEMY_LABEL[creature.enemyId]} encounter in “${room.name}”, from “${idea.text}”`, 200) });
        continue;
      }
    }
    const prop = PROP_SYNONYMS.find((entry) => idea.tokens.some((t) => entry.words.some((w) => matches(t, w))));
    if (prop) {
      const target = roomOrder([0, 1, 2]).find((i) => !rooms[i]!.used.prop);
      if (target !== undefined) {
        const room = rooms[target]!;
        const anchor: PropId = 'anchor_pedestal';
        room.propIds = [prop.propId, ...room.propIds.filter((p) => p !== prop.propId)].slice(0, 6);
        if (room.role === 'final' && !room.propIds.includes(anchor)) room.propIds = [prop.propId, anchor, ...room.propIds.slice(1)].slice(0, 6);
        room.used.prop = true;
        mappings.push({ contributionId: idea.id, kind: 'prop', roomIndex: target, featureDescription: clip(`${prop.label} in “${room.name}”, from “${idea.text}”`, 200) });
        continue;
      }
    }
    if (idea.tokens.some((t) => HAZARD_WORDS.some((w) => matches(t, w)))) {
      const target = roomOrder([0, 1, 2]).find((i) => !rooms[i]!.used.hazard);
      if (target !== undefined) {
        const room = rooms[target]!;
        room.hazards = true;
        room.used.hazard = true;
        mappings.push({ contributionId: idea.id, kind: 'hazard', roomIndex: target, featureDescription: clip(`${primary.hazardName} in “${room.name}”, from “${idea.text}”`, 200) });
        continue;
      }
    }
    if (scoreTheme(primary, idea.tokens) > 0 && !rooms[0]!.used.structure) {
      rooms[0]!.used.structure = true;
      mappings.push({ contributionId: idea.id, kind: 'structure', roomIndex: 0, featureDescription: clip(`${MOTIF_LABEL[rooms[0]!.motifIds[0]!]} of “${rooms[0]!.name}”, from “${idea.text}”`, 200) });
      continue;
    }
    if (idea.word) {
      const target = roomOrder([1, 0, 2]).find((i) => !rooms[i]!.used.name);
      if (target !== undefined) {
        const room = rooms[target]!;
        room.name = clip(`${idea.word} ${pick(rand, ROOM_NOUNS[room.role])}`, 80);
        room.word = idea.word;
        room.used.name = true;
        mappings.push({ contributionId: idea.id, kind: 'name', roomIndex: target, featureDescription: clip(`“${room.name}” is named for “${idea.text}”`, 200) });
        continue;
      }
    }
    const motifTarget = roomOrder([1, 2, 0]).find((i) => !rooms[i]!.used.motif && !rooms[i]!.used.structure);
    if (motifTarget !== undefined) {
      rooms[motifTarget]!.used.motif = true;
      mappings.push({ contributionId: idea.id, kind: 'motif', roomIndex: motifTarget, featureDescription: clip(`${MOTIF_LABEL[rooms[motifTarget]!.motifIds[0]!]} in “${rooms[motifTarget]!.name}”, from “${idea.text}”`, 200) });
    }
  }
  // Rooms whose bank name used the player's word are honest 'name' features too; they were
  // marked used so no second idea renames them, but they carry no mapping of their own.

  // Title + tagline + summary.
  const adj = pick(rand, primary.adjectives);
  const noun = pick(rand, primary.nouns);
  const patterns = word
    ? [`The ${adj} ${noun}`, `${noun} of the ${word}`, `The ${word} ${noun}`, `${adj} ${noun} of the ${word}`]
    : [`The ${adj} ${noun}`, `The ${adj} ${pick(rand, primary.nouns)}`];
  let title = pick(rand, patterns);
  if (title.length > 40) title = `The ${adj} ${noun}`;
  title = clip(title, 40);
  const tagline = clip(fillLower(pick(rand, primary.taglines)), 80);
  // The receipt carries the crew's ideas verbatim; the summary stays a short physical description
  // (the writing guide's 160-character target) with the regions named.
  const regions = ` ${['One', 'Two', 'Three'][counts.length - 1] ?? counts.length} region${counts.length === 1 ? '' : 's'} in play order: ${biomeNames.join(', ')}.`;
  const themeSummary = clip(primary.summary.length + regions.length <= 240 ? `${primary.summary}${regions}` : primary.summary, 240);

  // Lore: a relic per room in the theme's voice, remains for every enemy kind in play.
  const lore: LoreFragment[] = [];
  const enemyKindsAll = [...new Set(rooms.flatMap((r) => r.enemyIds))];
  const relicBudget = Math.max(1, Math.min(rooms.length, 12 - enemyKindsAll.length));
  // Spread relics along the run (always the first and last room), in the voice of each room's biome theme.
  const relicRooms = rooms.length <= relicBudget
    ? rooms.map((_, i) => i)
    : Array.from({ length: relicBudget }, (_, k) => Math.round((k * (rooms.length - 1)) / Math.max(1, relicBudget - 1)));
  rooms.forEach((room, index) => {
    if (!relicRooms.includes(index)) return;
    const voice = biomeThemes[room.biomeIndex] ?? primary;
    const template = voice.relics[(index + Math.floor(rand() * voice.relics.length)) % voice.relics.length]!;
    lore.push({
      kind: 'relic',
      title: clip(template.title, 40),
      source: clip(template.source, 60),
      text: clip(template.text.replace(/\{word\}/g, (room.word ?? word ?? noun).toLowerCase()), 520),
      roomIndex: index,
      enemyId: null,
    });
  });
  // The crew's own words, found in-world: the first idea, cut into the arrival room's wall,
  // signed by the operative who typed it. Real text, real name, nothing invented.
  const inscription = request.contributions[0];
  if (inscription && lore.length < 12) {
    const quote = sanitize(inscription.text, 90);
    const by = sanitize(inscription.playerName, 24) || 'an operative';
    lore.push({
      kind: 'relic',
      title: 'Crew inscription',
      source: 'cut into the wall beside the arrival door',
      text: clip(`“${quote}” — cut into the stone in ${by}'s hand, ${request.contributions.length} tally stroke${request.contributions.length === 1 ? '' : 's'} beneath it, one for each idea the crew brought.`, 520),
      roomIndex: 0,
      enemyId: null,
    });
  }
  for (const enemyId of enemyKindsAll) {
    if (lore.length >= 12) break;
    const options = REMAINS_TEMPLATES[enemyId];
    const template = pick(rand, options);
    lore.push({
      kind: 'remains',
      title: clip(template.title, 40),
      source: clip(template.source, 60),
      text: clip(fillLower(template.text), 520),
      roomIndex: 0,
      enemyId,
    });
  }

  // World laws: the primary theme's signature law, plus one from the secondary theme (or the
  // primary's own second) most of the time — so worlds play differently, not just look it.
  const primaryLaws = THEME_LAWS[primary.id] ?? ['first_light', 'the_many'];
  const secondLaw = secondary ? (THEME_LAWS[secondary.id] ?? primaryLaws)[0] : primaryLaws[1];
  const lawIds: WorldLawId[] = [primaryLaws[0]!];
  if (secondLaw && secondLaw !== lawIds[0] && rand() < 0.8) lawIds.push(secondLaw);
  const lawWord = (word ?? pick(rand, primary.nouns)).toLowerCase();
  const laws: WorldLaw[] = sanitizeLaws(lawIds.map((lawId) => ({
    lawId,
    name: clip(`${pick(rand, primary.adjectives)} ${LAW_VOICE[lawId].noun}`, 36),
    description: clip(LAW_VOICE[lawId].line.replace(/\{word\}/g, lawWord), 160),
    intensity: Math.round((0.4 + Math.round(rand() * 4) / 10) * 10) / 10,
  }))).laws;

  // Floors briefs: opener and finale in the primary theme; the three choice pairs alternate the
  // primary, the secondary/sibling and a contrasting third theme so every fork is a real change.
  const third = THEMES.filter((t) => t.id !== primary.id && t.id !== sibling.id && !t.motifs.some((m) => primary.motifs.includes(m)))[Math.floor(rand() * 4)]
    ?? THEMES[(THEMES.indexOf(primary) + 9) % THEMES.length]!;
  const briefThemes: ThemeDef[] = [primary, sibling, primary, third, sibling, primary, third, primary];
  const briefNames = new Set<string>();
  const biomes: BiomeBrief[] = BRIEF_LAYOUTS.map((slot, index) => {
    const theme = briefThemes[index]!;
    let name = clip(index === 0 ? `Outer ${pick(rand, theme.nouns)}` : index === 7 ? `Heart of the ${word ?? pick(rand, primary.nouns)}` : `${pick(rand, theme.adjectives)} ${slot.noun}`, 80);
    for (let n = 2; briefNames.has(name); n++) name = clip(`${pick(rand, theme.adjectives)} ${slot.noun} ${n}`, 80);
    briefNames.add(name);
    const tier = SLOT_TIER[index]!;
    // Cheapest kinds first so shallow biomes field husks and swarmlings, deep ones wardens and
    // channelers; kinds over the tier's cost cap wait for deeper floors.
    const themed = [...new Set([...theme.enemies.entry, ...theme.enemies.mid, ...theme.enemies.final])]
      .filter((e) => e !== 'guardian' && ENEMY_COST[e] <= TIER_MAX_COST[tier]!)
      .sort((a, b) => ENEMY_COST[a] - ENEMY_COST[b]);
    const fillers: EnemyId[] = ['swarmling', 'husk', 'lurker'];
    // The finale's pool stays small: the Custodian is the fight there, not its escorts.
    const enemyPool = [...new Set([...themed, ...fillers])].slice(0, index === 7 ? 3 : TIER_POOL_SIZE[tier]!);
    const propPool = [...new Set(theme.props)].filter((p) => p !== 'anchor_pedestal').slice(0, 5);
    return {
      id: `b${index + 1}`,
      name,
      tagline: clip(fillLower(pick(rand, theme.taglines)), 80),
      motifIds: [...new Set(theme.motifs)].slice(0, 3),
      enemyPool: enemyPool.length > 0 ? enemyPool : ['husk'],
      propPool: propPool.length > 0 ? propPool : ['crate'],
      hazards: slot.hazards || rand() < theme.hazardChance * 0.5,
      layout: slot.layout,
    };
  });
  BiomeBriefListSchema.parse(biomes);

  const attunements = [...primary.attunements, ...(secondary ? [secondary.attunements[0]!] : [])]
    .slice(0, 4)
    .map((a) => ({ effectId: a.effectId, name: clip(a.name, 40), description: clip(a.description, 160) }));

  const recipe = FloorsWorldRecipeSchema.parse({
    title,
    tagline,
    themeSummary,
    motifIds: uniqueMotifs,
    palette,
    rooms: rooms.map(toBlueprint),
    contributionMappings: mappings,
    lore,
    attunements,
    laws,
    biomes,
  });
  return { recipe, themes: { primary: primary.id, secondary: secondary?.id ?? null, scores } };
}

const toBlueprint = (r: RoomDraft): RoomBlueprint => ({
  name: r.name, description: r.description, motifIds: r.motifIds, propIds: r.propIds, enemyIds: r.enemyIds, hazards: r.hazards,
});

/** Rooms per biome for an expedition of n rooms: fill three biomes as evenly as possible, front-loaded. */
export function distributeRooms(n: number): number[] {
  const total = Math.min(MAX_ROOMS, Math.max(1, n));
  const biomes = Math.min(3, total);
  const counts = Array.from({ length: biomes }, (_, i) => Math.floor(total / biomes) + (i < total % biomes ? 1 : 0));
  return counts;
}

/** The deep interior of a world: darker floors and walls, hotter hazard, same identity. */
function deepen(base: Palette): Palette {
  return {
    ...base,
    background: shift(base.background, 8, 0.05, -0.02),
    floor: shift(base.floor, 10, 0.06, -0.05),
    floorAlt: shift(base.floorAlt, 10, 0.06, -0.05),
    wall: shift(base.wall, 10, 0.08, -0.06),
    wallEdge: shift(base.wallEdge, 12, 0.1, 0),
    accent: shift(base.accent, 14, 0.1, 0.02),
    accentSoft: shift(base.accentSoft, -20, 0.1, 0),
    hazard: shift(base.hazard, 0, 0.15, 0.06),
  };
}

export function composeWorldRecipe(request: GenerationRequest): WorldRecipe {
  return composeWorld(request).recipe;
}
