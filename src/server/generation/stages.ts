/**
 * Staged world generation (agent W2): model-facing schemas, slot planning, lenient parsing
 * and the prose-lint view. No network here; liveService.ts orchestrates, provider.ts transports.
 *
 * Model-facing schemas keep every key required (nullable where needed) so they are valid
 * for strict structured output, and put facts before prose: bible first, and on each lore
 * fragment `authorIndex` / `eventIndex` before `text`.
 */
import { z } from 'zod';
import {
  AttunementSchema, ContributionMappingSchema, LoreFragmentSchema, PaletteSchema, RoomBlueprintSchema,
  WorldRecipeSchema, MotifIdSchema, type WorldRecipe,
} from '../../shared/contracts';
import { BIOME_LINE_KINDS, WorldBibleSchema, clampLoreRefs, type BiomeRoomLines, type WorldBible } from '../../shared/bible';
import { BIOME_BRIEF_COUNT, BiomeBriefSchema, BiomeTerrainSchema, ROOM_KINDS, type BiomeBrief } from '../../shared/floors';
import { hashString } from '../../shared/ids';
import {
  CustodianSchema, TerrainSkinSchema, WorldLawSchema, WorldLookSchema, sanitizeCustodian, sanitizeLaws, sanitizeTerrainSkins,
  type Custodian, type TerrainSkin, type WorldLaw, type WorldLook,
} from '../../shared/laws';
import { KIND_SPECS, lintProse, lintRecipeText, formatRepairFeedback, type ProseKind } from '../../shared/prose';
import { ENEMY_IDS, MOTIF_IDS, PROP_IDS, TERRAIN_FEATURE_IDS, type EnemyId } from '../../shared/registry';

// ---------------------------------------------------------------------------
// Model-facing schemas
// ---------------------------------------------------------------------------

const refIndex = (max: number) => z.number().int().min(0).max(max).nullable();

export const ModelLoreFragmentSchema = z.object({
  authorIndex: refIndex(2),
  eventIndex: refIndex(6),
  kind: LoreFragmentSchema.shape.kind,
  title: LoreFragmentSchema.shape.title,
  source: LoreFragmentSchema.shape.source,
  text: LoreFragmentSchema.shape.text,
  roomIndex: LoreFragmentSchema.shape.roomIndex,
  enemyId: LoreFragmentSchema.shape.enemyId,
});
export type ModelLoreFragment = z.infer<typeof ModelLoreFragmentSchema>;

const roomLineText = z.string().trim().min(1).max(140);
/** One line per room kind, as fixed keys: cheaper in output tokens than a list of {kind, text}. */
const ModelRoomLinesSchema = z.object({
  entrance: roomLineText, combat: roomLineText, elite: roomLineText, treasure: roomLineText, lore: roomLineText, rest: roomLineText, exit: roomLineText,
});

/** BiomeBrief (same bounds as src/shared/floors.ts) plus the per-kind room lines. */
export const ModelBriefSchema = z.object({
  name: z.string().trim().min(1).max(40),
  tagline: z.string().trim().min(1).max(140),
  motifIds: z.array(z.enum(MOTIF_IDS)).min(1).max(3),
  enemyPool: z.array(z.enum(ENEMY_IDS)).min(1).max(5),
  propPool: z.array(z.enum(PROP_IDS)).min(1).max(5),
  hazards: z.boolean(),
  layout: BiomeBriefSchema.shape.layout,
  terrain: BiomeTerrainSchema.nullable(),
  roomLines: ModelRoomLinesSchema,
});

const tight = (max: number) => z.string().trim().min(1).max(max);
/**
 * The bible as the MODEL sees it: same shape as WorldBibleSchema with tighter character
 * bounds, because call 1 gates the portal and output tokens are the whole latency
 * (measured: ~54 tokens/s on claude-sonnet-4-6). Parsing still uses WorldBibleSchema, so a
 * line a few characters over is not a failed world.
 */
export const ModelBibleSchema = z.object({
  premise: tight(120),
  collapse: tight(240),
  people: z.array(z.object({ name: tight(32), job: tight(36), want: tight(64) })).min(3).max(4),
  places: z.array(tight(28)).min(3).max(4),
  objects: z.array(tight(28)).min(3).max(4),
  events: z.array(z.object({ date: tight(20), fact: tight(120) })).min(5).max(6),
  authors: z.array(z.object({ name: tight(32), document: tight(36), register: tight(130), never: tight(56) })).length(3),
  enemies: z.array(z.object({ enemyId: z.enum(ENEMY_IDS), formerJob: tight(48) })).min(3).max(5),
});

const foundationShape = {
  bible: ModelBibleSchema,
  title: WorldRecipeSchema.shape.title,
  tagline: WorldRecipeSchema.shape.tagline,
};
const roomsShape = {
  themeSummary: z.string().trim().min(1).max(200),
  motifIds: z.array(MotifIdSchema).min(1).max(4),
  palette: PaletteSchema,
  rooms: z.array(RoomBlueprintSchema).min(1).max(3),
  contributionMappings: z.array(ContributionMappingSchema).max(24),
};
const lawsShape = {
  look: WorldLookSchema,
  laws: z.array(WorldLawSchema).max(3),
  terrainSkins: z.array(TerrainSkinSchema).max(4),
  custodian: CustodianSchema,
};
export const FoundationToolSchema = z.object(foundationShape);
export const RoomsToolSchema = z.object(roomsShape);
export const LawsToolSchema = z.object(lawsShape);
export const RelicsToolSchema = z.object({ lore: z.array(ModelLoreFragmentSchema).max(8) });
export const RemainsToolSchema = z.object({
  lore: z.array(ModelLoreFragmentSchema).max(8),
  attunements: z.array(AttunementSchema).max(4),
});
export const BiomesToolSchema = z.object({ biomes: z.array(ModelBriefSchema).max(BIOME_BRIEF_COUNT) });
export const PolishToolSchema = z.object({
  fixes: z.array(z.object({ path: z.string().max(80), text: z.string().trim().min(1).max(520) })).max(16),
});
/** The whole world in one call (operator inbox, custom single-call providers). */
export const FullRecipeToolSchema = z.object({
  ...foundationShape,
  ...roomsShape,
  ...lawsShape,
  biomes: z.array(ModelBriefSchema).max(BIOME_BRIEF_COUNT).nullable(),
  lore: z.array(ModelLoreFragmentSchema).max(12),
  attunements: z.array(AttunementSchema).max(4),
});

export const jsonSchema = (schema: z.ZodType): unknown => z.toJSONSchema(schema, { target: 'draft-7' });

// ---------------------------------------------------------------------------
// Lenient parsing: the bible and rooms are load-bearing; everything else degrades per item
// ---------------------------------------------------------------------------

export class StageParseError extends Error {}

function issuesText(error: z.ZodError, prefix = ''): string {
  return error.issues.slice(0, 4).map((issue) => {
    const path = `${prefix}${issue.path.join('.')}`;
    return issue.code === 'too_big' && issue.origin === 'string' ? `${path}: maximum ${issue.maximum} characters` : `${path}: ${issue.message}`;
  }).join('; ');
}

/** Cuts at the last sentence end inside the limit, else at the last word; never mid-word, never an ellipsis. */
export function fitText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max + 1);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return (word > 0 ? head.slice(0, word) : trimmed.slice(0, max)).replace(/[\s,;:·-]+$/, '');
}

/**
 * safeParse that treats an over-long string, an over-long list or an unknown id inside a list
 * of registry ids as something to fit, not a failed world: strings are cut with `fitText`,
 * lists are cut to their maximum, unknown list entries are dropped, and the value is parsed
 * again. Anything else (a missing field, a wrong type, an unknown id outside a list) still fails.
 */
export function parseWithFit<T extends z.ZodType>(schema: T, raw: unknown): ReturnType<T['safeParse']> {
  let value = raw;
  for (let pass = 0; pass < 4; pass++) {
    const result = schema.safeParse(value);
    if (result.success) return result as ReturnType<T['safeParse']>;
    const at = (path: readonly PropertyKey[]): unknown => path.reduce<unknown>((node, key) => (node as Record<PropertyKey, unknown> | undefined)?.[key], value);
    const fixable = result.error.issues.filter((issue) => {
      const node = at(issue.path);
      if (issue.code === 'too_big') return (issue.origin === 'string' && typeof node === 'string') || (issue.origin === 'array' && Array.isArray(node));
      // an unknown id inside a list of registry ids: drop that entry, keep the list
      return issue.code === 'invalid_value' && typeof issue.path.at(-1) === 'number' && Array.isArray(at(issue.path.slice(0, -1))) && typeof node === 'string';
    });
    if (fixable.length === 0 || fixable.length !== result.error.issues.length) return result as ReturnType<T['safeParse']>;
    value = structuredClone(value);
    // deepest and last indices first, so removing list entries does not shift later paths
    fixable.sort((a, b) => b.path.length - a.path.length || Number(b.path.at(-1)) - Number(a.path.at(-1)));
    for (const issue of fixable) {
      const parent = at(issue.path.slice(0, -1)) as Record<PropertyKey, unknown> | unknown[] | undefined;
      const last = issue.path.at(-1);
      if (!parent || last === undefined) continue;
      if (issue.code === 'invalid_value') (parent as unknown[]).splice(Number(last), 1);
      else if (issue.code !== 'too_big') continue;
      else if (issue.origin === 'string') (parent as Record<PropertyKey, unknown>)[last] = fitText(String((parent as Record<PropertyKey, unknown>)[last]), Number(issue.maximum));
      else (parent as Record<PropertyKey, unknown>)[last] = ((parent as Record<PropertyKey, unknown>)[last] as unknown[]).slice(0, Number(issue.maximum));
    }
  }
  return schema.safeParse(value) as ReturnType<T['safeParse']>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ParsedBrief { brief: BiomeBrief; lines: BiomeRoomLines['lines'] }

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'biome';

/** Validates one model brief against the real BiomeBriefSchema; the id is assigned by trusted code. */
export function parseBrief(raw: unknown, index: number): ParsedBrief | undefined {
  const model = parseWithFit(ModelBriefSchema, raw);
  if (!model.success) return undefined;
  const { roomLines, terrain, ...rest } = model.data;
  const brief = BiomeBriefSchema.safeParse({ ...rest, ...(terrain ? { terrain } : {}), id: `b${index}-${slug(rest.name)}` });
  if (!brief.success) return undefined;
  const lines = BIOME_LINE_KINDS.flatMap((kind) => {
    const text = roomLines[kind as keyof typeof roomLines];
    return text ? [{ kind, text }] : [];
  });
  return { brief: brief.data, lines };
}

export interface Foundation {
  bible: WorldBible;
  header: Pick<WorldRecipe, 'title' | 'tagline'>;
}
export interface RoomsPart {
  themeSummary: string;
  motifIds: WorldRecipe['motifIds'];
  palette: WorldRecipe['palette'];
  rooms: WorldRecipe['rooms'];
  contributionMappings: WorldRecipe['contributionMappings'];
}
export interface LawsPart {
  look?: WorldLook;
  laws: WorldLaw[];
  terrainSkins: TerrainSkin[];
  custodian?: Custodian;
  notes: string[];
}

/** `legacy` = a complete pre-bible recipe (old model output): accepted as-is, no second call. */
export function parseFoundation(raw: unknown): { legacy: z.infer<typeof WorldRecipeSchema> } | { foundation: Foundation } {
  if (!isRecord(raw)) throw new StageParseError('Recipe failed schema validation at (root): expected an object.');
  if (raw.bible == null) {
    const legacy = WorldRecipeSchema.safeParse(raw);
    if (!legacy.success) throw new StageParseError(`Recipe failed schema validation at ${issuesText(legacy.error)}.`);
    return { legacy: legacy.data };
  }
  const core = parseWithFit(z.object({ bible: WorldBibleSchema, title: foundationShape.title, tagline: foundationShape.tagline }), raw);
  if (!core.success) throw new StageParseError(`Recipe failed schema validation at ${issuesText(core.error)}.`);
  const { bible, ...header } = core.data;
  return { foundation: { bible, header } };
}

/** Rooms are load-bearing: a failure here is a failed world. */
export function parseRooms(raw: unknown): RoomsPart {
  if (!isRecord(raw)) throw new StageParseError('Recipe failed schema validation at (root): expected an object.');
  const core = parseWithFit(z.object({
    themeSummary: WorldRecipeSchema.shape.themeSummary, motifIds: roomsShape.motifIds, palette: roomsShape.palette,
    rooms: roomsShape.rooms, contributionMappings: roomsShape.contributionMappings.catch([]),
  }), raw);
  if (!core.success) throw new StageParseError(`Recipe failed schema validation at ${issuesText(core.error)}.`);
  return core.data;
}

/** Look, laws, terrain skins and the Custodian are flavour: they degrade item by item and never fail a world. */
export function parseLaws(raw: unknown, bible: WorldBible): LawsPart {
  const record = isRecord(raw) ? raw : {};
  const notes: string[] = [];
  const look = WorldLookSchema.safeParse(record.look);
  if (!look.success && record.look != null) notes.push('World look was invalid and was dropped; the renderer derives it from motifs.');
  const lawItems = Array.isArray(record.laws) ? record.laws.map((law) => parseWithFit(WorldLawSchema, law)).flatMap((r) => (r.success ? [r.data] : [])) : [];
  const { laws } = sanitizeLaws(lawItems);
  const lawCount = Array.isArray(record.laws) ? record.laws.length : 0;
  if (lawCount > laws.length) notes.push(`Dropped ${lawCount - laws.length} world law(s): invalid, conflicting, over a group cap or outside the difficulty budget.`);
  const skins = (Array.isArray(record.terrainSkins) ? record.terrainSkins : []).map((skin) => parseWithFit(TerrainSkinSchema, skin)).flatMap((r) => (r.success ? [r.data] : []));
  const boss = parseCustodian(record, nonBossKinds(bible));
  return {
    ...(look.success ? { look: look.data } : {}), laws, terrainSkins: sanitizeTerrainSkins(skins, [...TERRAIN_FEATURE_IDS]),
    ...(boss.custodian ? { custodian: boss.custodian } : {}), notes: [...notes, ...boss.notes],
  };
}

export function parseLore(raw: unknown, bible: WorldBible, expected: { kind: 'relic' | 'remains'; count: number }): { lore: WorldRecipe['lore']; dropped: number } {
  const items = isRecord(raw) && Array.isArray(raw.lore) ? raw.lore : undefined;
  if (!items) throw new StageParseError('Recipe failed schema validation at lore: expected an array.');
  const lore: WorldRecipe['lore'] = [];
  let firstError = '';
  items.slice(0, 12).forEach((item, index) => {
    const parsed = parseWithFit(ModelLoreFragmentSchema, item);
    if (parsed.success && parsed.data.kind === expected.kind) lore.push(clampLoreRefs(parsed.data, bible));
    else if (!parsed.success && !firstError) firstError = issuesText(parsed.error, `lore.${index}.`);
  });
  if (lore.length === 0) throw new StageParseError(`Recipe failed schema validation at ${firstError || 'lore: no valid fragments'}.`);
  return { lore, dropped: items.length - lore.length };
}

export function parseAttunements(raw: unknown): WorldRecipe['attunements'] {
  const items = isRecord(raw) && Array.isArray(raw.attunements) ? raw.attunements : [];
  const seen = new Set<string>();
  return items.map((item) => parseWithFit(AttunementSchema, item)).flatMap((r) => (r.success ? [r.data] : []))
    .filter((a) => !seen.has(a.effectId) && Boolean(seen.add(a.effectId))).slice(0, 4);
}

/** The Custodian is flavour: an invalid one is dropped, an illegal move set is repaired, never fatal. */
export function parseCustodian(raw: unknown, nonBossEnemyKinds: number): { custodian?: Custodian; notes: string[] } {
  const value = isRecord(raw) ? raw.custodian : undefined;
  if (value == null) return { notes: [] };
  const custodian = parseWithFit(CustodianSchema, value);
  if (!custodian.success) return { notes: ['Custodian moves were invalid and were dropped; the default boss is used.'] };
  const result = sanitizeCustodian(custodian.data, nonBossEnemyKinds);
  return { custodian: result.custodian, notes: result.substituted ? [`Replaced ${result.substituted} Custodian move(s) that broke the move-set rules with defaults.`] : [] };
}

export function parseBiomes(raw: unknown, firstIndex: number, count: number): Array<ParsedBrief | undefined> {
  const items = isRecord(raw) && Array.isArray(raw.biomes) ? raw.biomes : [];
  return Array.from({ length: count }, (_, offset) => parseBrief(items[offset], firstIndex + offset));
}

/** Single-call output (operator / custom providers): new-style with a bible, or a legacy recipe. */
export function parseFullRecipe(raw: unknown): { recipe: WorldRecipe; notes: string[] } {
  const first = parseFoundation(raw);
  if ('legacy' in first) return { recipe: first.legacy, notes: [] };
  const { foundation } = first;
  const record = raw as Record<string, unknown>;
  const roomsPart = parseRooms(record);
  const lawsPart = parseLaws(record, foundation.bible);
  const loreItems = Array.isArray(record.lore) ? record.lore : [];
  const lore = loreItems.map((item) => parseWithFit(ModelLoreFragmentSchema, item)).flatMap((r) => (r.success ? [clampLoreRefs(r.data, foundation.bible)] : [])).slice(0, 12);
  const notes = [...lawsPart.notes];
  if (lore.length < loreItems.length) notes.push(`Dropped ${loreItems.length - lore.length} invalid lore fragment(s).`);
  const briefs = Array.isArray(record.biomes) ? parseBiomes(record, 0, BIOME_BRIEF_COUNT) : undefined;
  return {
    recipe: assembleRecipe({ foundation, roomsPart, lawsPart, lore, attunements: parseAttunements(record), ...(briefs ? { briefs } : {}) }),
    notes,
  };
}

export const nonBossKinds = (bible: WorldBible): number => new Set(bible.enemies.map((enemy) => enemy.enemyId).filter((id) => id !== 'guardian')).size;

// ---------------------------------------------------------------------------
// Slots: trusted code plans what each call-2 request writes
// ---------------------------------------------------------------------------

function shuffled<T>(items: readonly T[], seed: string): T[] {
  return items.map((item, index) => ({ item, key: hashString(`${seed}:${index}`) })).sort((a, b) => a.key - b.key).map((entry) => entry.item);
}

export interface RelicSlot { roomIndex: number; authorIndex: number; length: 'short' | 'medium' | 'long' }
/** Two relics per legacy room; authors rotate and lengths are mixed so no two worlds share a rhythm. */
export function planRelicSlots(plannedRoomCount: number, seed: number): RelicSlot[] {
  const count = Math.min(6, plannedRoomCount * 2);
  const lengths = shuffled(['short', 'medium', 'long', 'medium', 'short', 'long'] as const, `${seed}:relic-length`);
  const authors = shuffled([0, 1, 2, 0, 1, 2], `${seed}:relic-author`);
  return Array.from({ length: count }, (_, index) => ({
    roomIndex: Math.min(plannedRoomCount - 1, Math.floor(index / 2)), authorIndex: authors[index]!, length: lengths[index]!,
  }));
}

/** One remains fragment per enemy kind the bible casts (the rooms and biomes draw from the same cast). */
export function planRemainsEnemies(bible: WorldBible, relicCount: number): EnemyId[] {
  const ids = new Set<EnemyId>(bible.enemies.map((enemy) => enemy.enemyId));
  ids.add('guardian');
  return [...ids].slice(0, Math.max(1, 12 - relicCount));
}

export interface BiomeSlot { index: number; position: 'opener' | 'middle' | 'finale'; setting: string; focusEvent: string }
const SLOT_TIERS = [0, 1, 1, 2, 2, 3, 3, 4] as const;
/**
 * Slots 0..7. Each gets a bible place and event so parallel calls do not name the same biome
 * twice. The six middle briefs are dealt onto tiers 1-3 by the route seed (FLOORS.md section 12),
 * so the model is told only opener / middle / finale.
 */
export function planBiomeSlots(bible: WorldBible, seed: number): BiomeSlot[] {
  const places = shuffled([...bible.places, ...bible.objects], `${seed}:biome-place`);
  return SLOT_TIERS.map((tier, index) => {
    const position = tier === 0 ? 'opener' as const : tier === 4 ? 'finale' as const : 'middle' as const;
    const event = bible.events[Math.min(bible.events.length - 1, Math.round((index / 7) * (bible.events.length - 1)))]!;
    return { index, position, setting: places[index % places.length]!, focusEvent: `${event.date}: ${event.fact}` };
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Minimal per-brief fallback used until `deriveBiomeBriefs` (floorgen) is injected. */
export function fallbackBrief(recipe: Pick<WorldRecipe, 'title' | 'rooms' | 'motifIds'>, index: number): BiomeBrief {
  const room = recipe.rooms[index % recipe.rooms.length]!;
  const enemies = [...new Set([...room.enemyIds, ...recipe.rooms.flatMap((r) => r.enemyIds)])].filter((id) => id !== 'guardian').slice(0, 4);
  const props = [...new Set([...room.propIds, ...recipe.rooms.flatMap((r) => r.propIds)])].filter((id) => id !== 'anchor_pedestal').slice(0, 4);
  const tier = SLOT_TIERS[index] ?? 4;
  return BiomeBriefSchema.parse({
    id: `b${index}-derived`,
    name: `${room.name}`.slice(0, 70) + (index >= recipe.rooms.length ? ` ${index + 1}` : ''),
    tagline: room.description.trim().slice(0, 140) || `${recipe.title}, level ${index + 1}.`,
    motifIds: room.motifIds.length ? room.motifIds : recipe.motifIds.slice(0, 3),
    enemyPool: enemies.length ? enemies : ['husk'],
    propPool: props.length ? props : ['crate'],
    hazards: room.hazards,
    layout: {
      linearity: [0.5, 0.3, 0.7, 0.4, 0.8, 0.35, 0.65, 0.9][index] ?? 0.5,
      branchiness: [0.4, 0.7, 0.3, 0.6, 0.2, 0.75, 0.45, 0.2][index] ?? 0.4,
      specials: { treasure: 1, lore: tier < 4 ? 2 : 1, rest: tier >= 2 ? 1 : 0, elite: Math.min(4, tier) },
    },
  });
}

export function assembleRecipe(parts: {
  foundation: Foundation;
  roomsPart: RoomsPart;
  /** Absent when the laws call failed: the world then has no laws, look, skins or named boss. */
  lawsPart?: LawsPart | undefined;
  lore: WorldRecipe['lore'];
  attunements: WorldRecipe['attunements'];
  /** Present only in floors mode: 8 entries, undefined where the model's brief was missing or invalid. */
  briefs?: Array<ParsedBrief | undefined>;
  deriveBriefs?: (recipe: WorldRecipe) => BiomeBrief[];
  onDerived?: (indices: number[]) => void;
}): WorldRecipe {
  const { foundation, roomsPart, lawsPart } = parts;
  const usedFeatures = roomsPart.rooms.flatMap((room) => room.terrain?.features ?? []);
  const skins = sanitizeTerrainSkins(lawsPart?.terrainSkins ?? [], usedFeatures);
  const recipe: WorldRecipe = {
    ...foundation.header,
    themeSummary: roomsPart.themeSummary,
    motifIds: roomsPart.motifIds,
    palette: roomsPart.palette,
    rooms: roomsPart.rooms,
    contributionMappings: roomsPart.contributionMappings,
    lore: parts.lore.slice(0, 12),
    attunements: parts.attunements,
    bible: foundation.bible,
    ...(lawsPart?.laws.length ? { laws: lawsPart.laws } : {}),
    ...(lawsPart?.look ? { look: lawsPart.look } : {}),
    ...(skins.length ? { terrainSkins: skins } : {}),
    ...(lawsPart?.custodian ? { custodian: lawsPart.custodian } : {}),
  };
  if (!parts.briefs) return recipe;
  const derivedIndices: number[] = [];
  let derived: BiomeBrief[] | undefined;
  const names = new Set<string>();
  const briefs = Array.from({ length: BIOME_BRIEF_COUNT }, (_, index) => {
    let parsed = parts.briefs![index];
    if (parsed && names.has(parsed.brief.name.toLowerCase())) parsed = undefined; // a duplicate door name is a useless choice
    if (parsed) {
      names.add(parsed.brief.name.toLowerCase());
      return parsed;
    }
    derivedIndices.push(index);
    derived ??= parts.deriveBriefs?.(recipe);
    const candidate = derived?.[index];
    const brief = candidate && BiomeBriefSchema.safeParse(candidate).success ? candidate : fallbackBrief(recipe, index);
    return { brief: { ...brief, id: `b${index}-${slug(brief.name)}-d` }, lines: [] } satisfies ParsedBrief;
  });
  if (derivedIndices.length) parts.onDerived?.(derivedIndices);
  return {
    ...recipe,
    biomes: briefs.map((entry) => entry.brief),
    biomeRoomLines: briefs.filter((entry) => entry.lines.length > 0).map((entry) => ({ biomeId: entry.brief.id, lines: entry.lines })),
  };
}

// ---------------------------------------------------------------------------
// Prose lint view + line-level fixes
// ---------------------------------------------------------------------------

export interface LintFailure { path: string; kind: ProseKind; maxChars: number; text: string; notes: string[] }
export interface WorldLint { score: number; hardFail: boolean; failedFields: number; fieldCount: number; rules: string[]; failures: LintFailure[]; feedback: string[] }

type Lintable = Partial<Pick<WorldRecipe, 'title' | 'tagline' | 'themeSummary' | 'rooms' | 'lore' | 'attunements' | 'laws' | 'biomes' | 'biomeRoomLines' | 'custodian' | 'terrainSkins'>>;

/** House maximum handed to the polish call (characters). Schema maxima still apply on top. */
const POLISH_MAX: Partial<Record<ProseKind, number>> = { roomLine: 100, relic: 480, remains: 320, themeSummary: 160, biomeTagline: 80 };

/**
 * `lintRecipeText` over everything the model wrote, including the fields it does not know
 * about (laws, per-biome room lines). Paths address the STORED recipe shape, except biome
 * room lines, which are `biomes[b].rooms[i].description` (i = index into that biome's lines).
 */
export function lintWorld(parts: Lintable, bible: WorldBible | undefined): WorldLint {
  const linesFor = (biomeId: string) => parts.biomeRoomLines?.find((entry) => entry.biomeId === biomeId)?.lines ?? [];
  const view = {
    title: parts.title, tagline: parts.tagline, themeSummary: parts.themeSummary, rooms: parts.rooms,
    lore: parts.lore, attunements: parts.attunements,
    biomes: parts.biomes?.map((brief) => ({ name: brief.name, tagline: brief.tagline, rooms: linesFor(brief.id).map((line) => ({ description: line.text })) })),
  };
  const base = lintRecipeText(view, bible ? { bible } : {});
  const fields = base.fields.map((field) => ({ path: field.path, kind: field.kind, text: field.text, result: field.result }));
  (parts.laws ?? []).forEach((law, index) => {
    fields.push({ path: `laws[${index}].name`, kind: 'boonName', text: law.name, result: lintProse(law.name, { kind: 'boonName', ...(bible ? { bible } : {}) }) });
    fields.push({ path: `laws[${index}].description`, kind: 'boonDescription', text: law.description, result: lintProse(law.description, { kind: 'boonDescription', ...(bible ? { bible } : {}) }) });
  });
  const extra = (path: string, kind: ProseKind, text: string): void => {
    fields.push({ path, kind, text, result: lintProse(text, { kind, ...(bible ? { bible } : {}) }) });
  };
  if (parts.custodian) {
    extra('custodian.title', 'bossName', parts.custodian.title);
    parts.custodian.moves.forEach((move, index) => extra(`custodian.moves[${index}].tell`, 'bossCallout', move.tell));
  }
  let weight = 0;
  let total = 0;
  const failures: LintFailure[] = [];
  const rules = new Set<string>();
  for (const field of fields) {
    const words = Math.max(field.result.words, 3);
    weight += words;
    total += field.result.score * words;
    if (!field.result.hardFail) continue;
    for (const issue of field.result.issues) if (issue.severity === 'hard') rules.add(issue.rule);
    if (!field.result.issues.some((issue) => issue.severity === 'hard')) rules.add('score-over-threshold');
    failures.push({
      path: field.path, kind: field.kind, text: field.text, notes: formatRepairFeedback(field.result),
      maxChars: Math.min(POLISH_MAX[field.kind] ?? Infinity, KIND_SPECS[field.kind].max),
    });
  }
  return {
    score: weight ? Math.round((total / weight) * 10) / 10 : 0,
    hardFail: failures.length > 0, failedFields: failures.length, fieldCount: fields.length, rules: [...rules],
    failures, feedback: failures.flatMap((failure) => failure.notes.map((note) => `${failure.path}: ${note}`)),
  };
}

const UNSAFE_TEXT = /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i;
export const isUnsafeText = (value: string): boolean => UNSAFE_TEXT.test(value);

/** Reads or replaces one text field by lint path. Returns undefined for unknown paths. */
function access(parts: Lintable, path: string): { get: () => string | undefined; set: (text: string) => void } | undefined {
  const top = /^(title|tagline|themeSummary)$/.exec(path);
  if (top) {
    const key = top[1] as 'title' | 'tagline' | 'themeSummary';
    return { get: () => parts[key], set: (text) => { parts[key] = text; } };
  }
  const line = /^biomes\[(\d+)\]\.rooms\[(\d+)\]\.description$/.exec(path);
  if (line) {
    const brief = parts.biomes?.[Number(line[1])];
    const target = parts.biomeRoomLines?.find((entry) => entry.biomeId === brief?.id)?.lines[Number(line[2])];
    return target ? { get: () => target.text, set: (text) => { target.text = text; } } : undefined;
  }
  if (path === 'custodian.title' && parts.custodian) {
    const custodian = parts.custodian;
    return { get: () => custodian.title, set: (text) => { custodian.title = text; } };
  }
  const item = /^(rooms|biomes|lore|attunements|laws|custodian\.moves)\[(\d+)\]\.(name|description|tagline|title|source|text|tell)$/.exec(path);
  if (!item) return undefined;
  const list = item[1] === 'custodian.moves' ? parts.custodian?.moves : parts[item[1] as 'rooms'];
  const target = (list as unknown as Array<Record<string, unknown>> | undefined)?.[Number(item[2])];
  const key = item[3]!;
  if (!target || typeof target[key] !== 'string') return undefined;
  return { get: () => target[key] as string, set: (text) => { target[key] = text; } };
}

/**
 * Applies polish-call replacements in place, each only if it is safe, within the length
 * bound and lints strictly better than the line it replaces (the best attempt is kept per line).
 */
export function applyFixes(parts: Lintable, bible: WorldBible | undefined, failures: LintFailure[], fixes: Array<{ path: string; text: string }>): number {
  let applied = 0;
  for (const fix of fixes) {
    const failure = failures.find((candidate) => candidate.path === fix.path);
    const field = failure && access(parts, fix.path);
    const text = fix.text.trim();
    if (!failure || !field || !text || isUnsafeText(text) || text.length > KIND_SPECS[failure.kind].max) continue;
    const before = lintProse(failure.text, { kind: failure.kind, ...(bible ? { bible } : {}) });
    const after = lintProse(text, { kind: failure.kind, ...(bible ? { bible } : {}) });
    const better = (before.hardFail && !after.hardFail) || (before.hardFail === after.hardFail && after.score < before.score);
    if (!better) continue;
    field.set(text);
    applied++;
  }
  return applied;
}

export function displayTexts(recipe: Lintable & Partial<Pick<WorldRecipe, 'contributionMappings'>>): string[] {
  return [
    recipe.title ?? '', recipe.tagline ?? '', recipe.themeSummary ?? '',
    ...(recipe.rooms ?? []).flatMap((room) => [room.name, room.description]),
    ...(recipe.contributionMappings ?? []).map((mapping) => mapping.featureDescription),
    ...(recipe.lore ?? []).flatMap((fragment) => [fragment.title, fragment.source, fragment.text]),
    ...(recipe.attunements ?? []).flatMap((a) => [a.name, a.description]),
    ...(recipe.laws ?? []).flatMap((law) => [law.name, law.description]),
    ...(recipe.terrainSkins ?? []).flatMap((skin) => [skin.name, skin.caption]),
    ...(recipe.custodian ? [recipe.custodian.title, ...recipe.custodian.phaseTitles, ...recipe.custodian.moves.flatMap((move) => [move.name, move.tell])] : []),
    ...(recipe.biomes ?? []).flatMap((brief) => [brief.name, brief.tagline]),
    ...(recipe.biomeRoomLines ?? []).flatMap((entry) => entry.lines.map((line) => line.text)),
  ];
}

export { BIOME_LINE_KINDS };
