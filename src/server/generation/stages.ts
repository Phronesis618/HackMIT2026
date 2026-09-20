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
import { seededInt } from './exemplars';
import {
  CustodianSchema, LAW_INFO, TerrainSkinSchema, WorldLawSchema, WorldLookSchema, sanitizeCustodian, sanitizeLaws, sanitizeTerrainSkins,
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

/**
 * The storage limit (`BiomeRoomLineSchema`), deliberately, not the house target of 100.
 * Measured: the model writes room lines of 110 to 130 characters whatever the schema says
 * (407 of 448 in one run were over 100), and a line over 100 is a warning, never a hard
 * fail. Advertising 100 therefore bought no score and cost complete sentences: trusted code
 * cut 407 lines, some of them mid-phrase. The prompt asks for one short sentence instead.
 */
const roomLineText = z.string().trim().min(1).max(140);
/** One line per room kind, as fixed keys: cheaper in output tokens than a list of {kind, text}. */
const ModelRoomLinesSchema = z.object({
  entrance: roomLineText, combat: roomLineText, elite: roomLineText, treasure: roomLineText, lore: roomLineText, rest: roomLineText, exit: roomLineText,
});
export const MODEL_ROOM_LINE_MAX = 140;

/** BiomeBrief (same bounds as src/shared/floors.ts) plus the per-kind room lines. */
export const ModelBriefSchema = z.object({
  name: z.string().trim().min(1).max(40),
  // 80 is the linter's biomeTagline limit; every over-long tagline in the last live run was
  // between 95 and 113 characters, i.e. written to the old 140 the schema advertised.
  tagline: z.string().trim().min(1).max(80),
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
  collapse: tight(200),
  people: z.array(z.object({ name: tight(32), job: tight(36), want: tight(56) })).min(3).max(4),
  places: z.array(tight(28)).min(3).max(4),
  objects: z.array(tight(28)).min(3).max(4),
  events: z.array(z.object({ date: tight(20), fact: tight(120) })).min(5).max(6),
  authors: z.array(z.object({ name: tight(32), document: tight(36), register: tight(110), never: tight(56) })).length(3),
  enemies: z.array(z.object({ enemyId: z.enum(ENEMY_IDS), formerJob: tight(48) })).min(3).max(5),
});

/**
 * Room lines are validated OUTSIDE the brief schema (see `parseBrief`): a floor is worth more
 * than its seven room lines, and a single over-long one used to cost the whole brief, which
 * trusted code then had to derive (seen live: one floor lost to four lines over the limit).
 * Missing and null lines are normal too (`rest: null` for a floor with no rest room).
 *
 * The tagline is parsed at the STORED limit of 140, not the 80 the model is shown. Measured:
 * 56 of 64 taglines in the last live run were written over 80, and cutting at parse time hid
 * the fault from the linter, so the player, not the model, got the half sentence. At 140 the
 * over-long tagline survives to the linter, fails `too-long`, and the polish call rewrites it;
 * `fitOverlong` still cuts anything that comes back long, as a last resort rather than a habit.
 */
const LenientBriefSchema = ModelBriefSchema.omit({ roomLines: true }).extend({
  tagline: z.string().trim().min(1).max(140),
});

const foundationShape = {
  bible: ModelBibleSchema,
  title: WorldRecipeSchema.shape.title,
  tagline: WorldRecipeSchema.shape.tagline,
};
/**
 * Call 1 asks for the bible's fields at the TOP level, with no `bible` wrapper.
 * Measured: with a nested `bible` object, 4 of 8 live worlds sent it as one JSON string and
 * paid a 22 s repair round for it (the single largest term in time to first room). A field
 * that is a plain string, list or list-of-objects is not a thing the model can stringify by
 * mistake. `parseFoundation` still reads the nested form, which the single-call tool uses.
 */
const flatFoundationShape = { ...ModelBibleSchema.shape, title: foundationShape.title, tagline: foundationShape.tagline };
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
export const FoundationToolSchema = z.object(flatFoundationShape);
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

/**
 * A word that was leading somewhere. A cut that ends on one reads as a truncation even
 * though it is a whole word: "Dalgaard's desk faces the photocopier that" (seen live).
 */
const DANGLING_WORD = /[\s,;:·-]+(?:an?|the|and|or|but|of|to|in|on|at|by|for|from|with|into|onto|over|under|through|that|which|who|whose|while|when|as|is|was|were|are|has|had|its|his|her|their|this|these|those|one|two|three|four|no|not|still|never|only|just|both|each|every|then|after|before|since)$/i;

/** Cuts at the last sentence end inside the limit, else at a clause or word end; never mid-word, never an ellipsis. */
export function fitText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max + 1);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentence >= max * 0.3) return head.slice(0, sentence + 1);
  const tidy = (value: string): string => value.replace(/[\s,;:·-]+$/, '');
  const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' · '), head.lastIndexOf(' ('));
  if (clause >= max * 0.5) return tidy(head.slice(0, clause));
  const word = head.lastIndexOf(' ');
  let byWord = tidy(word > 0 ? head.slice(0, word) : trimmed.slice(0, max));
  while (byWord.length > max * 0.3 && DANGLING_WORD.test(byWord)) byWord = tidy(byWord.replace(DANGLING_WORD, ''));
  // What is left of a clause the cut landed inside is noise ("...; the remaining 8"); a
  // clause with something in it is content ("...; Dalgaard's desk faces the photocopier").
  const stub = /[,;:]\s+[^,;:]{1,20}$/.exec(byWord);
  const trimmedStub = stub ? tidy(byWord.slice(0, stub.index)) : byWord;
  return trimmedStub.length >= max * 0.3 ? trimmedStub : byWord;
}

/**
 * One string trusted code shortened to make it fit. A cut is a defect, not a tidy-up: the
 * player is left with a sentence that stops, which reads as machine-written more reliably
 * than any word choice. The pipeline turns these into polish failures so the line is written
 * again, short, by the writer (`cutFailures`).
 */
export interface TextCut { path: string; length: number; max: number }

/** `a.b.3.c` (Zod issue path) -> `a.b[3].c` (the lint path shape). */
const lintPath = (path: readonly PropertyKey[]): string =>
  path.reduce<string>((out, key) => (typeof key === 'number' ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)), '');

/**
 * safeParse that treats an over-long string, an over-long list or an unknown id inside a list
 * of registry ids as something to fit, not a failed world: strings are cut with `fitText`,
 * lists are cut to their maximum, unknown list entries are dropped, and the value is parsed
 * again. Anything else (a missing field, a wrong type, an unknown id outside a list) still fails.
 *
 * Every string cut is appended to `cuts` when one is supplied, because in most fields the
 * schema maximum and the linter's maximum are the same number: cutting here is what stopped
 * the linter ever seeing an over-long line.
 */
export function parseWithFit<T extends z.ZodType>(schema: T, raw: unknown, cuts?: TextCut[]): ReturnType<T['safeParse']> {
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
      else if (issue.origin === 'string') {
        const before = String((parent as Record<PropertyKey, unknown>)[last]);
        cuts?.push({ path: lintPath(issue.path), length: before.trim().length, max: Number(issue.maximum) });
        (parent as Record<PropertyKey, unknown>)[last] = fitText(before, Number(issue.maximum));
      }
      else (parent as Record<PropertyKey, unknown>)[last] = ((parent as Record<PropertyKey, unknown>)[last] as unknown[]).slice(0, Number(issue.maximum));
    }
  }
  return schema.safeParse(value) as ReturnType<T['safeParse']>;
}

/**
 * Tool input sometimes arrives with a nested object or list serialised as a JSON string
 * (seen live: `bible` as a string). Parse such values back, one level deep, and clone the rest.
 */
/**
 * A nested object that arrived as a string (seen live on `bible`, 4 of 8 worlds in one run).
 * Tries, in order: the string as JSON, without code fences, from the first bracket to the last,
 * and once more if the result is itself a string (double encoding). Returns undefined when
 * nothing parses to an object or list: the caller then reports an ordinary repairable failure.
 * NOT verified against a live payload: failed attempts were not being saved when this was seen.
 */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const open = trimmed.search(/[[{]/);
  const close = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  const candidates = [trimmed, ...(open >= 0 && close > open ? [trimmed.slice(open, close + 1)] : [])];
  for (const candidate of candidates) {
    try {
      let value = JSON.parse(candidate) as unknown;
      if (typeof value === 'string') value = JSON.parse(value) as unknown;
      if (typeof value === 'object' && value !== null) return value;
    } catch {
      // next candidate
    }
  }
  return undefined;
}

/** Models sometimes mark emphasis with Markdown; the game renders plain text. */
const stripMarkdown = (text: string): string => text.replace(/\*\*|__|`/g, '').replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|[.,;:!?]|$)/g, '$1$2');
function plainStrings(value: unknown): unknown {
  if (typeof value === 'string') return stripMarkdown(value);
  if (Array.isArray(value)) return value.map(plainStrings);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plainStrings(inner)]));
  return value;
}

export function coerceJson(input: unknown): unknown {
  const raw = plainStrings(input);
  if (typeof raw === 'string' && /^\s*[[{]/.test(raw)) {
    try {
      return coerceJson(JSON.parse(raw) as unknown);
    } catch {
      return raw;
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
    if (typeof value === 'string') {
      const parsed = parseLooseJson(value);
      if (parsed !== undefined) return [key, parsed];
    }
    return [key, value];
  }));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ParsedBrief {
  brief: BiomeBrief;
  lines: BiomeRoomLines['lines'];
  /** Strings trusted code cut, addressed relative to this brief: `tagline`, `rooms[2].description`. */
  cuts: TextCut[];
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'biome';

/** Why the last `parseBrief` call per index failed; read by the pipeline for an honest provenance note. */
export const briefRejections = new Map<number, string>();

/**
 * Validates one model brief against the real BiomeBriefSchema; the id is assigned by trusted
 * code. Pools are tidied first (duplicates, director-only ids) so a slip there costs an entry,
 * not the whole brief.
 */
export function parseBrief(raw: unknown, index: number): ParsedBrief | undefined {
  briefRejections.delete(index);
  const value = coerceJson(raw);
  let roomLines: unknown;
  if (isRecord(value)) {
    for (const key of ['motifIds', 'enemyPool', 'propPool'] as const) {
      if (Array.isArray(value[key])) value[key] = [...new Set(value[key] as unknown[])];
    }
    if (Array.isArray(value.propPool)) value.propPool = (value.propPool as unknown[]).filter((id) => id !== 'anchor_pedestal');
    roomLines = coerceJson(value.roomLines);
    delete value.roomLines;
  }
  const cuts: TextCut[] = [];
  const model = parseWithFit(LenientBriefSchema, value, cuts);
  if (!model.success) {
    briefRejections.set(index, issuesText(model.error));
    return undefined;
  }
  const { terrain, ...rest } = model.data;
  const brief = BiomeBriefSchema.safeParse({ ...rest, ...(terrain ? { terrain } : {}), id: `b${index}-${slug(rest.name)}` });
  if (!brief.success) {
    briefRejections.set(index, issuesText(brief.error));
    return undefined;
  }
  const lines = parseRoomLines(roomLines, cuts);
  return { brief: brief.data, lines, cuts };
}

/**
 * One line per room kind, each fitted to the storage limit; anything that is not text is
 * dropped. A line that had to be cut is recorded so the polish call can write a short one
 * instead: the cut itself is the tell (`docs/design/WORLDGEN_EVAL.md` follow-up).
 */
export function parseRoomLines(raw: unknown, cuts?: TextCut[]): ParsedBrief['lines'] {
  if (!isRecord(raw)) return [];
  let index = 0;
  return BIOME_LINE_KINDS.flatMap((kind) => {
    const value = raw[kind];
    if (typeof value !== 'string') return [];
    const text = fitText(value, MODEL_ROOM_LINE_MAX);
    if (!text) return [];
    if (value.trim().length > MODEL_ROOM_LINE_MAX) cuts?.push({ path: `rooms[${index}].description`, length: value.trim().length, max: MODEL_ROOM_LINE_MAX });
    index++;
    return [{ kind, text }];
  });
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
  cuts: TextCut[];
}
export interface LawsPart {
  look?: WorldLook;
  laws: WorldLaw[];
  terrainSkins: TerrainSkin[];
  custodian?: Custodian;
  notes: string[];
  cuts: TextCut[];
}

/**
 * Accepts three shapes, in this order:
 *   - call 1's flat reply: the bible's own fields at the top level beside `title`/`tagline`;
 *   - a nested `bible` object (the single-call tool, and anything older);
 *   - `legacy` = a complete pre-bible recipe (old model output), accepted as-is, no second call.
 */
export function parseFoundation(input: unknown): { legacy: z.infer<typeof WorldRecipeSchema> } | { foundation: Foundation } {
  const raw = coerceJson(input);
  if (!isRecord(raw)) throw new StageParseError('Recipe failed schema validation at (root): expected an object.');
  // `coerceJson` has already tried to parse a stringified value back; a nested bible that is
  // still not an object falls through to the flat reading, whose error names the real field.
  const nested = raw.bible == null ? undefined : coerceJson(raw.bible);
  const flat = raw.premise !== undefined || raw.events !== undefined;
  const bibleSource = isRecord(nested) ? nested : flat ? raw : undefined;
  if (!bibleSource) {
    if (raw.bible != null) throw new StageParseError(`Recipe failed schema validation at bible: expected the bible's fields at the top level, received ${typeof raw.bible}.`);
    const legacy = WorldRecipeSchema.safeParse(raw);
    if (!legacy.success) throw new StageParseError(`Recipe failed schema validation at ${issuesText(legacy.error)}.`);
    return { legacy: legacy.data };
  }
  // Over-long header lines are kept here and sent to the polish call (see `headerOverflow`); `fitHeader` is the last resort.
  const core = parseWithFit(
    z.object({ bible: WorldBibleSchema, title: z.string().trim().min(1).max(120), tagline: z.string().trim().min(1).max(240) }),
    { ...raw, bible: bibleSource },
  );
  // A flat reply never saw a `bible` key, so the repair note must name the field it did see.
  if (!core.success) throw new StageParseError(`Recipe failed schema validation at ${flat && !isRecord(nested) ? issuesText(core.error).replaceAll('bible.', '') : issuesText(core.error)}.`);
  const { bible, ...header } = core.data;
  return { foundation: { bible, header } };
}

/** Rooms are load-bearing: a failure here is a failed world. */
export function parseRooms(input: unknown): RoomsPart {
  const raw = coerceJson(input);
  if (!isRecord(raw)) throw new StageParseError('Recipe failed schema validation at (root): expected an object.');
  const cuts: TextCut[] = [];
  const core = parseWithFit(z.object({
    themeSummary: WorldRecipeSchema.shape.themeSummary, motifIds: roomsShape.motifIds, palette: roomsShape.palette,
    rooms: roomsShape.rooms, contributionMappings: roomsShape.contributionMappings.catch([]),
  }), raw, cuts);
  if (!core.success) throw new StageParseError(`Recipe failed schema validation at ${issuesText(core.error)}.`);
  return { ...core.data, cuts };
}

/** Look, laws, terrain skins and the Custodian are flavour: they degrade item by item and never fail a world. */
export function parseLaws(input: unknown, bible: WorldBible): LawsPart {
  const raw = coerceJson(input);
  const record = isRecord(raw) ? raw : {};
  const notes: string[] = [];
  const look = WorldLookSchema.safeParse(record.look);
  if (!look.success && record.look != null) notes.push('World look was invalid and was dropped; the renderer derives it from motifs.');
  // Each law is parsed with its own cut list, then re-addressed by its place in the kept
  // laws: sanitizeLaws drops and reorders, so the index the model wrote at is not the path.
  const perLawCuts = new Map<WorldLaw, TextCut[]>();
  const lawItems = Array.isArray(record.laws) ? record.laws.flatMap((law) => {
    const lawCuts: TextCut[] = [];
    const parsed = parseWithFit(WorldLawSchema, law, lawCuts);
    if (!parsed.success) return [];
    perLawCuts.set(parsed.data, lawCuts);
    return [parsed.data];
  }) : [];
  // Honesty: a live world never carries a law the engine does not apply (LAW_INFO.implemented).
  const { laws } = sanitizeLaws(lawItems.filter((law) => LAW_INFO[law.lawId].implemented));
  const cuts = laws.flatMap((law, index) => (perLawCuts.get(law) ?? []).map((cut) => ({ ...cut, path: `laws[${index}].${cut.path}` })));
  const lawCount = Array.isArray(record.laws) ? record.laws.length : 0;
  if (lawCount > laws.length) notes.push(`Dropped ${lawCount - laws.length} world law(s): invalid, conflicting, over a group cap, outside the difficulty budget or not implemented by the engine.`);
  const skins = (Array.isArray(record.terrainSkins) ? record.terrainSkins : []).map((skin) => parseWithFit(TerrainSkinSchema, skin)).flatMap((r) => (r.success ? [r.data] : []));
  const boss = parseCustodian(record, nonBossKinds(bible));
  return {
    ...(look.success ? { look: look.data } : {}), laws, terrainSkins: sanitizeTerrainSkins(skins, [...TERRAIN_FEATURE_IDS]),
    ...(boss.custodian ? { custodian: boss.custodian } : {}), notes: [...notes, ...boss.notes], cuts,
  };
}

export function parseLore(input: unknown, bible: WorldBible, expected: { kind: 'relic' | 'remains'; count: number }): { lore: WorldRecipe['lore']; dropped: number; cuts: TextCut[] } {
  const raw = coerceJson(input);
  const items = isRecord(raw) && Array.isArray(raw.lore) ? raw.lore : undefined;
  if (!items) throw new StageParseError('Recipe failed schema validation at lore: expected an array.');
  const lore: WorldRecipe['lore'] = [];
  const cuts: TextCut[] = [];
  let firstError = '';
  items.slice(0, 12).forEach((item, index) => {
    const itemCuts: TextCut[] = [];
    const parsed = parseWithFit(ModelLoreFragmentSchema, item, itemCuts);
    if (parsed.success && parsed.data.kind === expected.kind) {
      for (const cut of itemCuts) cuts.push({ ...cut, path: `lore[${lore.length}].${cut.path}` });
      lore.push(clampLoreRefs(parsed.data, bible));
    } else if (!parsed.success && !firstError) firstError = issuesText(parsed.error, `lore.${index}.`);
  });
  if (lore.length === 0) throw new StageParseError(`Recipe failed schema validation at ${firstError || 'lore: no valid fragments'}.`);
  return { lore, dropped: items.length - lore.length, cuts };
}

export function parseAttunements(input: unknown, cuts?: TextCut[]): WorldRecipe['attunements'] {
  const raw = coerceJson(input);
  const items = isRecord(raw) && Array.isArray(raw.attunements) ? raw.attunements : [];
  const seen = new Set<string>();
  const kept: WorldRecipe['attunements'] = [];
  for (const item of items) {
    const itemCuts: TextCut[] = [];
    const parsed = parseWithFit(AttunementSchema, item, itemCuts);
    if (!parsed.success || seen.has(parsed.data.effectId) || kept.length >= 4) continue;
    seen.add(parsed.data.effectId);
    for (const cut of itemCuts) cuts?.push({ ...cut, path: `attunements[${kept.length}].${cut.path}` });
    kept.push(parsed.data);
  }
  return kept;
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

export function parseBiomes(input: unknown, firstIndex: number, count: number): Array<ParsedBrief | undefined> {
  const raw = coerceJson(input);
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

const HEADER_MAX = { title: 40, tagline: 80 } as const;
export function headerOverflow(header: Foundation['header']): LintFailure[] {
  return (['title', 'tagline'] as const).filter((key) => header[key].length > HEADER_MAX[key]).map((key) => ({
    path: key, kind: key === 'title' ? 'worldTitle' as const : 'tagline' as const, maxChars: HEADER_MAX[key], text: header[key],
    notes: [`${header[key].length} characters; the hard limit is ${HEADER_MAX[key]}. Keep the one fact that matters and end on it.`],
  }));
}
export function fitHeader(header: Foundation['header']): Foundation['header'] {
  return { title: fitText(header.title, HEADER_MAX.title), tagline: fitText(header.tagline, HEADER_MAX.tagline) };
}

export const nonBossKinds = (bible: WorldBible): number => new Set(bible.enemies.map((enemy) => enemy.enemyId).filter((id) => id !== 'guardian')).size;

// ---------------------------------------------------------------------------
// Slots: trusted code plans what each call-2 request writes
// ---------------------------------------------------------------------------

function shuffled<T>(items: readonly T[], seed: string): T[] {
  return items.map((item, index) => ({ item, key: seededInt(0, `${seed}:${index}`) })).sort((a, b) => a.key - b.key).map((entry) => entry.item);
}

export interface RelicSlot { roomIndex: number; authorIndex: number; eventIndex: number; length: 'short' | 'medium' | 'long' }
/**
 * Two relics per legacy room. Trusted code deals the author, the event and the length of each,
 * so the six fragments cover the whole chain of events in three voices and no two worlds
 * share a rhythm. An author who was not present reports the event as it reached them.
 */
export function planRelicSlots(plannedRoomCount: number, seed: number, eventCount = 6): RelicSlot[] {
  const count = Math.min(6, plannedRoomCount * 2);
  const lengths = shuffled(['short', 'medium', 'long', 'medium', 'short', 'medium'] as const, `${seed}:relic-length`);
  const authors = shuffled([0, 1, 2, 0, 1, 2], `${seed}:relic-author`);
  const events = shuffled(Array.from({ length: Math.max(1, eventCount) }, (_, index) => index), `${seed}:relic-event`);
  const slots = Array.from({ length: count }, (_, index) => ({ authorIndex: authors[index]!, eventIndex: events[index % events.length]!, length: lengths[index]! }));
  // found in roughly the order things happened: early events lie near the entrance
  return slots.sort((a, b) => a.eventIndex - b.eventIndex).map((slot, index) => ({ roomIndex: Math.min(plannedRoomCount - 1, Math.floor(index / 2)), ...slot }));
}

export interface RemainsSlot { enemyId: EnemyId; formerJob: string; eventIndex: number; shape: string }
const REMAINS_SHAPES = [
  'one sentence: the object and the mark on it',
  'what is printed or written on it, quoted, then who it belonged to',
  'the object, its wear, then the dated bible fact',
  'a short list of what was in the pockets or on the belt',
  'the object and a note one of the authors left on it',
];
/** One remains fragment per enemy kind the bible casts, each dated by a different event and given a different shape. */
export function planRemainsSlots(bible: WorldBible, relicCount: number, seed: number): RemainsSlot[] {
  const ids = new Set<EnemyId>(bible.enemies.map((enemy) => enemy.enemyId));
  ids.add('guardian');
  const events = shuffled(bible.events.map((_, index) => index), `${seed}:remains-event`);
  const shapes = shuffled(REMAINS_SHAPES, `${seed}:remains-shape`);
  return [...ids].slice(0, Math.max(1, 12 - relicCount)).map((enemyId, index) => ({
    enemyId,
    formerJob: bible.enemies.find((enemy) => enemy.enemyId === enemyId)?.formerJob ?? 'the person responsible',
    eventIndex: enemyId === 'guardian' ? bible.events.length - 1 : events[index % events.length]!,
    shape: shapes[index % shapes.length]!,
  }));
}

export interface BiomeSlot { index: number; position: 'opener' | 'middle' | 'finale'; setting: string; focusEvent: string; focusDate: string; namesTaken: string[] }
const SLOT_TIERS = [0, 1, 1, 2, 2, 3, 3, 4] as const;
/**
 * Slots 0..7. The calls that write briefs run in parallel and cannot see each other, so
 * trusted code deals each slot a different bible place (then objects) and a different
 * event, and tells it which settings the other floors took. The six middle briefs are dealt
 * onto tiers 1-3 by the route seed (FLOORS.md section 12), so the model is told only
 * opener / middle / finale.
 */
export function planBiomeSlots(bible: WorldBible, seed: number): BiomeSlot[] {
  const settings = [...shuffled(bible.places, `${seed}:biome-place`), ...shuffled(bible.objects, `${seed}:biome-object`)];
  return SLOT_TIERS.map((tier, index) => {
    const position = tier === 0 ? 'opener' as const : tier === 4 ? 'finale' as const : 'middle' as const;
    const event = bible.events[Math.min(bible.events.length - 1, Math.round((index / 7) * (bible.events.length - 1)))]!;
    const setting = settings[index % settings.length]!;
    return { index, position, setting, focusEvent: `${event.date}: ${event.fact}`, focusDate: event.date, namesTaken: settings.filter((other) => other !== setting) };
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
  /** In-world date of each slot's focus event, used to tell apart two briefs the model gave one name. */
  briefDates?: string[];
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
    if (parsed && names.has(parsed.brief.name.toLowerCase())) {
      // Two doors with one name is no choice. Parallel calls can collide: date the later one, else derive it.
      const dated = `${parsed.brief.name}, ${parts.briefDates?.[index] ?? ''}`;
      parsed = parts.briefDates?.[index] && dated.length <= 40 && !names.has(dated.toLowerCase())
        ? { ...parsed, brief: { ...parsed.brief, name: dated } } : undefined;
    }
    if (parsed) {
      names.add(parsed.brief.name.toLowerCase());
      return parsed;
    }
    derivedIndices.push(index);
    derived ??= parts.deriveBriefs?.(recipe);
    const candidate = derived?.[index];
    const brief = candidate && BiomeBriefSchema.safeParse(candidate).success ? candidate : fallbackBrief(recipe, index);
    return { brief: { ...brief, id: `b${index}-${slug(brief.name)}-d` }, lines: [], cuts: [] } satisfies ParsedBrief;
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

export interface LintField { path: string; kind: ProseKind; text: string; result: ReturnType<typeof lintProse> }

/**
 * Every player-facing string in `parts` with its lint path, kind and result, including the
 * fields `lintRecipeText` does not know about (laws, the Custodian, per-biome room lines).
 * Paths address the STORED recipe shape, except biome room lines, which are
 * `biomes[b].rooms[i].description` (i = index into that biome's lines).
 */
export function lintFields(parts: Lintable, bible: WorldBible | undefined): LintField[] {
  const linesFor = (biomeId: string) => parts.biomeRoomLines?.find((entry) => entry.biomeId === biomeId)?.lines ?? [];
  const view = {
    title: parts.title, tagline: parts.tagline, themeSummary: parts.themeSummary, rooms: parts.rooms,
    lore: parts.lore, attunements: parts.attunements,
    biomes: parts.biomes?.map((brief) => ({ name: brief.name, tagline: brief.tagline, rooms: linesFor(brief.id).map((line) => ({ description: line.text })) })),
  };
  const base = lintRecipeText(view, bible ? { bible } : {});
  const fields: LintField[] = base.fields.map((field) => ({ path: field.path, kind: field.kind, text: field.text, result: field.result }));
  const extra = (path: string, kind: ProseKind, text: string): void => {
    fields.push({ path, kind, text, result: lintProse(text, { kind, ...(bible ? { bible } : {}) }) });
  };
  (parts.laws ?? []).forEach((law, index) => {
    extra(`laws[${index}].name`, 'boonName', law.name);
    extra(`laws[${index}].description`, 'boonDescription', law.description);
  });
  if (parts.custodian) {
    extra('custodian.title', 'bossName', parts.custodian.title);
    parts.custodian.moves.forEach((move, index) => extra(`custodian.moves[${index}].tell`, 'bossCallout', move.tell));
  }
  return fields;
}

/** `lintFields` scored, with the checks that need more than one line to see. */
export function lintWorld(parts: Lintable, bible: WorldBible | undefined): WorldLint {
  const fields = lintFields(parts, bible);
  let weight = 0;
  let total = 0;
  const failures: LintFailure[] = [];
  const engineWords: Array<{ path: string; kind: ProseKind; text: string; word: string }> = [];
  for (const field of fields) {
    const word = ENGINE_WORDS.exec(field.text)?.[0];
    if (word && !field.result.hardFail) engineWords.push({ path: field.path, kind: field.kind, text: field.text, word });
  }
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
  for (const hit of engineWords) {
    rules.add('engine-word');
    // Naming the replacement is the whole note: the same advice without the former job in it
    // survived two polish rounds twice in the last live run.
    const job = formerJobFor(hit.word, bible);
    failures.push({
      path: hit.path, kind: hit.kind, text: hit.text, maxChars: Math.min(POLISH_MAX[hit.kind] ?? Infinity, KIND_SPECS[hit.kind].max),
      notes: [`Rule engine-word: "${hit.word}" is the engine's id for that enemy and no player ever reads it.${job ? ` In this world those creatures are ${job}: use that, in whatever wording the sentence needs.` : ' Call the creature by its former job from the bible.'}`],
    });
  }
  const known = new Set(failures.map((failure) => failure.path));
  for (const failure of [...lawFailures(parts), ...remainsNameFailures(parts, bible), ...openerFailures(parts)]) {
    if (known.has(failure.path)) continue;
    known.add(failure.path);
    rules.add(/^Rule ([a-z-]+):/.exec(failure.notes[0] ?? '')?.[1] ?? 'house-rule');
    failures.push(failure);
  }
  return {
    score: weight ? Math.round((total / weight) * 10) / 10 : 0,
    hardFail: failures.length > 0, failedFields: failures.length, fieldCount: fields.length, rules: [...rules],
    failures, feedback: failures.flatMap((failure) => failure.notes.map((note) => `${failure.path}: ${note}`)),
  };
}

const lawMax = Math.min(POLISH_MAX.boonDescription ?? Infinity, KIND_SPECS.boonDescription.max);
/**
 * A number the ENGINE already prints beside the law's name, in the units `lawEffectText`
 * uses: a percentage, a multiplier, a pixel radius, a millisecond window, an Integrity
 * total. A count of people or a date is a world fact and belongs here, so neither is listed.
 */
const ENGINE_NUMBER = /\b\d+(?:\.\d+)?\s*(?:%|x\b|px\b|ms\b|per\s?cent\b)|\b\d+\s*(?:Integrity|HP)\b/i;
/**
 * Two faults the linter cannot see in one line, both found by reading the last live run
 * (`docs/design/WORLDGEN_EVAL.md`, "what still reads as machine-written"):
 *  - the description states the world fact and never says what the law does to the fight;
 *  - it restates the engine's own numbers, which are printed beside it, and then disagrees
 *    with them ("a third faster" next to "Dash cooldown x0.67").
 */
function lawFailures(parts: Lintable): LintFailure[] {
  return (parts.laws ?? []).flatMap((law, index) => {
    const text = law.description.trim();
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => /[a-z]/i.test(sentence));
    const note = (rule: string, advice: string): LintFailure => ({ path: `laws[${index}].description`, kind: 'boonDescription', text: law.description, maxChars: lawMax, notes: [`Rule ${rule}: ${advice}`] });
    const engineNumber = ENGINE_NUMBER.exec(text);
    if (engineNumber) {
      return [note('law-engine-numbers', `"${engineNumber[0].trim()}" is the engine's own number. The game prints the exact effect beside this law's name, so a second number here competes with it. Give the rule in plain words ("dashes carry farther, and take longer to come back") and keep one fact about the person or place it is named after.`)];
    }
    if (sentences.length < 2 || text.length < 40) {
      return [note('law-needs-rule', 'this names the world fact but never says what the law does to the fight. Keep the fact, then add one short sentence, no numbers, telling the crew what to expect under it.')];
    }
    return [];
  });
}

/**
 * `prompts/runtime/remains.md`: the person a remains fragment names is a new minor person,
 * never one of the three authors. Seen live once in 8 worlds, with the title and the text
 * naming two different people. Checked on the title and the opening sentence, where the
 * object's owner is identified; a later sentence may quote an author's note, which is legal.
 * The guardian is exempt: that fragment is the person responsible, who may be an author.
 */
function remainsNameFailures(parts: Lintable, bible: WorldBible | undefined): LintFailure[] {
  const authors = (bible?.authors ?? []).map((author) => author.name).filter(Boolean);
  if (authors.length === 0) return [];
  const names = authors.flatMap((name) => {
    const words = name.split(/\s+/).filter((word) => word.length >= 4);
    return [name, ...words];
  });
  const pattern = new RegExp(`\\b(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:'s)?\\b`);
  return (parts.lore ?? []).flatMap((fragment, index) => {
    if (fragment.kind !== 'remains' || fragment.enemyId === 'guardian') return [];
    const opening = fragment.text.split(/(?<=[.!?])\s+/)[0] ?? '';
    const hit = pattern.exec(fragment.title) ?? pattern.exec(opening);
    if (!hit) return [];
    return [{
      path: `lore[${index}].text`, kind: 'remains' as const, text: fragment.text,
      maxChars: Math.min(POLISH_MAX.remains ?? Infinity, KIND_SPECS.remains.max),
      notes: [`Rule remains-author-name: "${hit[0]}" is one of the three authors, and the person this object belonged to is one of the many, not one of the three. Give the tag an ordinary name of your own, and keep the author's name only if they wrote a note on it.`],
    }];
  });
}

/** Digits, or the number words a room line counts enemies with. */
const COUNT_OPENER = /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)$/i;
/**
 * A floor's seven room lines, read in a row, must not all start the same way (WRITING.md
 * section 8). Measured in the last live run: nearly every line opened on a count or a piece
 * of furniture. Two lines may share an opening; the third is a rhythm.
 */
function openerFailures(parts: Lintable): LintFailure[] {
  const max = Math.min(POLISH_MAX.roomLine ?? Infinity, KIND_SPECS.roomLine.max);
  return (parts.biomes ?? []).flatMap((brief, biomeIndex) => {
    const lines = parts.biomeRoomLines?.find((entry) => entry.biomeId === brief.id)?.lines ?? [];
    const seen = new Map<string, number>();
    return lines.flatMap((line, lineIndex) => {
      const words = line.text.replace(/^[^A-Za-z0-9]+/, '').split(/\s+/);
      const first = (words[0] ?? '').replace(/[^A-Za-z0-9']/g, '');
      const opener = COUNT_OPENER.test(first) ? 'a count' : first.toLowerCase();
      const count = (seen.get(opener) ?? 0) + 1;
      seen.set(opener, count);
      if (count < 3) return [];
      return [{
        path: `biomes[${biomeIndex}].rooms[${lineIndex}].description`, kind: 'roomLine' as const, text: line.text, maxChars: max,
        notes: [`Rule opener-repeat: ${count} lines on this floor open the same way (${opener === 'a count' ? 'on a count' : `on "${first}"`}). Open this one somewhere else: on the fixture the room was built around, on what is on the floor, on a name from the bible, or mid-task.`],
      }];
    });
  });
}

/**
 * A line trusted code had to shorten, handed to the polish call so the writer can write a
 * short one. The cut is the defect: a sentence that stops mid-thought reads as machine-made
 * whatever its vocabulary, and it is the single most common fault in the last live run
 * (56 of 64 taglines). `fitOverlong` remains the last resort after polish.
 */
export function cutFailures(parts: Lintable, bible: WorldBible | undefined, cuts: readonly TextCut[]): LintFailure[] {
  if (cuts.length === 0) return [];
  const fields = new Map(lintFields(parts, bible).map((field) => [field.path, field]));
  const out: LintFailure[] = [];
  for (const cut of cuts) {
    const field = fields.get(cut.path);
    if (!field || out.some((failure) => failure.path === cut.path)) continue;
    const max = Math.min(POLISH_MAX[field.kind] ?? Infinity, KIND_SPECS[field.kind].max);
    // An over-long line the linter can still see is already a `too-long` failure with its own note.
    if (field.text.length > max) continue;
    const budget = Math.max(4, Math.floor(max / 6.5) - 1);
    out.push({
      path: cut.path, kind: field.kind, text: field.text, maxChars: max,
      notes: [`Rule cut-short: this was written at ${cut.length} characters against a limit of ${cut.max}, so trusted code cut it and the player is left with a sentence that stops. Write it again complete, at most ${budget} words, keeping the same facts and dropping the weakest one.`],
    });
  }
  return out;
}

/** Registry enemy ids that are not ordinary job words (`warden`, `guardian` and `sentinel` can be real titles). */
const ENGINE_WORDS = /\b(?:husks?|lurkers?|spewers?|swarmlings?|channell?ers?)\b/i;
const ENGINE_WORDS_ALL = /\b(husks?|lurkers?|spewers?|swarmlings?|channell?ers?)\b/gi;
/** "Swarmlings" / "Channellers" -> the registry id the bible casts a former job against. */
const engineWordId = (word: string): string => word.toLowerCase().replace(/s$/, '').replace(/^channeller$/, 'channeler');
const formerJobFor = (word: string, bible: WorldBible | undefined): string | undefined =>
  bible?.enemies.find((enemy) => enemy.enemyId === engineWordId(word))?.formerJob;

/**
 * Last resort, after two polish rounds have declined to do it: swap a registry id still
 * sitting in a player-facing line for the bible's former job for that creature. A former job
 * is a plural group ("Deck 4 loaders"), so a singular use becomes "one of the …".
 * Runs on the assembled recipe, next to `fitOverlong`, and is reported in provenance.
 */
export function swapEngineWords(text: string, bible: WorldBible | undefined): string {
  return text.replace(ENGINE_WORDS_ALL, (word) => {
    const job = formerJobFor(word, bible);
    if (!job) return word;
    const replacement = /s$/i.test(word) ? job : `one of the ${job}`;
    return /^[A-Z]/.test(word) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
  }).replace(/\b(?:an?|the)\s+(?=one of the )/gi, '').replace(/^\s*one of the /, 'One of the ');
}

export function replaceEngineWords(parts: Lintable, bible: WorldBible | undefined): number {
  if (!bible) return 0;
  let replaced = 0;
  for (const failure of lintWorld(parts, bible).failures) {
    if (!failure.notes.some((note) => note.startsWith('Rule engine-word'))) continue;
    const field = access(parts, failure.path);
    const text = swapEngineWords(failure.text, bible);
    if (!field || text === failure.text) continue;
    field.set(fitText(text, Math.min(failure.maxChars, KIND_SPECS[failure.kind].max)));
    replaced++;
  }
  return replaced;
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
    if (!failure || !field || !text || isUnsafeText(text) || text.length > Math.max(failure.maxChars, KIND_SPECS[failure.kind].max)) continue;
    const before = lintProse(failure.text, { kind: failure.kind, ...(bible ? { bible } : {}) });
    const after = lintProse(text, { kind: failure.kind, ...(bible ? { bible } : {}) });
    // Failures raised outside prose.ts (an engine word, a header over its hard limit) are fixed when the cause is gone.
    const causeFixed = !before.hardFail && !after.hardFail && !ENGINE_WORDS.test(text) && text.length <= Math.max(failure.maxChars, Math.min(failure.text.length, KIND_SPECS[failure.kind].max));
    const better = causeFixed || (before.hardFail && !after.hardFail && !ENGINE_WORDS.test(text)) || (before.hardFail === after.hardFail && after.score < before.score);
    if (!better) continue;
    field.set(text);
    applied++;
  }
  return applied;
}

/** Last resort after polish: a line whose only remaining fault is length is cut at a sentence or word end. */
export function fitOverlong(parts: Lintable, bible: WorldBible | undefined): number {
  let cut = 0;
  for (const failure of lintWorld(parts, bible).failures) {
    if (!failure.notes.some((note) => note.startsWith('Rule too-long'))) continue;
    const field = access(parts, failure.path);
    const limit = Math.min(failure.maxChars, KIND_SPECS[failure.kind].max);
    if (!field || failure.text.length <= limit) continue;
    field.set(fitText(failure.text, limit));
    cut++;
  }
  return cut;
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
