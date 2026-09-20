/**
 * Recipe generation pipeline (agent W2): bible first, prose second, linter in the loop.
 *
 * STAGED (providers with `callStage`, i.e. the Claude and OpenAI API providers)
 *   call 1  foundation: bible, title/tagline/summary, palette, look, laws, 3 legacy room
 *           blueprints, opener biome (floors only), contribution mappings. Up to one repair
 *           round on schema/text-guard failure, as before.
 *   call 2  in parallel, conditioned on the bible from call 1: relics · remains + attunements ·
 *           biome briefs 1-4 · biome briefs 5-7 (floors only) · a polish call for call-1 lines
 *           the linter rejected. Each call-2 task: one retry on a schema failure, then one polish
 *           call for lint failures. Anything still running at the world budget is dropped:
 *           missing briefs are derived per brief, missing lore stays missing, provenance says so.
 *
 * WHY CALL 2 IS AWAITED: the client's prefix check (`parseWorldPrefix`) rejects any change to
 * `recipe` after the first committed world, and a floors world is a single record, so late
 * lore or briefs cannot reach a running world without a transport change. The split still
 * pays: four short parallel calls finish in the time of the longest instead of their sum.
 *
 * SINGLE CALL (operator inbox, custom providers): `generate()` returns a whole recipe. If it
 * carries a bible, prose-lint failures trigger the one bounded repair with rule-specific
 * feedback and the better-scoring attempt is kept. A recipe without a bible (old model
 * output) is accepted unchanged and its lint score is only recorded.
 */
import type { GenerationRequest, GenerationStatus, WorldRecipe } from '../../shared/contracts';
import { deriveBiomeBriefs } from '../../shared/floorgen';
import { BIOME_BRIEF_COUNT } from '../../shared/floors';
import { buildSystemPrompt, namePool, type PromptStage } from './prompt';
import { GenerationFailure, assertDisplayText, type ProviderUsage, type RecipeProvider } from './provider';
import {
  BiomesToolSchema, FoundationToolSchema, PolishToolSchema, RelicsToolSchema, RemainsToolSchema, StageParseError,
  applyFixes, assembleRecipe, displayTexts, isUnsafeText, jsonSchema, lintWorld, parseAttunements, parseBiomes,
  parseFoundation, parseLore, planBiomeSlots, planRelicSlots, planRemainsEnemies,
  type Foundation, type ParsedBrief, type WorldLint,
} from './stages';
import { PolishToolSchema as _PolishSchema } from './stages';
import type { z } from 'zod';

void _PolishSchema;

export const DEFAULT_WORLD_BUDGET_MS = 75_000;

export interface CallMetric { stage: string; ms: number; ok: boolean; inputTokens?: number; outputTokens?: number }
type LintSummary = Pick<WorldLint, 'score' | 'failedFields' | 'fieldCount' | 'rules'>;
export interface GenerationMetrics {
  mode: 'staged' | 'single' | 'legacy';
  calls: CallMetric[];
  /** Time until call 1 was accepted (the point a transport that supports late content could open the portal). */
  foundationMs: number;
  totalMs: number;
  lint: { before: LintSummary; after: LintSummary };
  derivedBriefs: number[];
  dropped: string[];
}
export interface GeneratedRecipe { recipe: WorldRecipe; metrics: GenerationMetrics }

interface PipelineOptions {
  provider: RecipeProvider;
  request: GenerationRequest;
  seed: number;
  floors: boolean;
  floorsSeed: string;
  budgetMs: number;
  startedAt: number;
  signal?: AbortSignal | undefined;
  notes: string[];
  status: (phase: GenerationStatus['phase'], message: string) => void;
  countCall: () => void;
}

const summary = (lint: WorldLint): LintSummary => ({ score: lint.score, failedFields: lint.failedFields, fieldCount: lint.fieldCount, rules: lint.rules });
const clipNote = (text: string): string => (text.length <= 200 ? text : `${text.slice(0, 199)}…`);
const lintNote = (before: LintSummary, after: LintSummary, polished: boolean): string =>
  clipNote(`Prose lint score ${after.score} (${after.failedFields}/${after.fieldCount} lines failing${polished ? `; before repair ${before.score}, ${before.failedFields} failing` : ''}${after.rules.length ? `; rules: ${after.rules.slice(0, 4).join(', ')}` : ''}).`);

export async function generateRecipe(options: PipelineOptions): Promise<GeneratedRecipe> {
  return options.provider.callStage ? staged(options) : single(options);
}

// ---------------------------------------------------------------------------
// Single-call providers
// ---------------------------------------------------------------------------

async function single(options: PipelineOptions): Promise<GeneratedRecipe> {
  const { provider, request, signal, notes, status } = options;
  const calls: CallMetric[] = [];
  let repair: string | undefined;
  let best: { recipe: WorldRecipe; lint: WorldLint } | undefined;
  let first: WorldLint | undefined;
  let lastFailure: GenerationFailure | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    options.countCall();
    status('generating', repair ? 'Repairing the generated recipe…' : 'Generating a world from your ideas…');
    const began = Date.now();
    try {
      const result = await provider.generate(request, repair, signal);
      signal?.throwIfAborted();
      calls.push({ stage: 'full', ms: Date.now() - began, ok: true, ...(result.usage ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } : {}) });
      for (const note of result.notes ?? []) notes.push(clipNote(note));
      const lint = lintWorld(result.recipe, result.recipe.bible);
      first ??= lint;
      if (!best || lint.failedFields < best.lint.failedFields || (lint.failedFields === best.lint.failedFields && lint.score < best.lint.score)) {
        best = { recipe: result.recipe, lint };
      }
      if (!result.recipe.bible || !lint.hardFail || attempt === 2) break;
      repair = `An editor rejected these lines under the house rules. Keep the bible and every passing line; rewrite only what is listed.\n${lint.feedback.slice(0, 12).join('\n')}`.slice(0, 1_600);
      notes.push(clipNote(`Prose lint rejected ${lint.failedFields} line(s) (${lint.rules.slice(0, 4).join(', ')}); requesting one bounded repair.`));
      status('validating', 'An editor rejected some lines; requesting one bounded repair…');
    } catch (error) {
      signal?.throwIfAborted();
      const failure = error instanceof GenerationFailure ? error : new GenerationFailure('Live generation failed.');
      calls.push({ stage: 'full', ms: Date.now() - began, ok: false });
      lastFailure = failure;
      if (best) {
        notes.push(clipNote(`Repair attempt failed (${failure.message}); kept the first attempt.`));
        break;
      }
      if (!failure.repairable || attempt === 2) break;
      notes.push(failure.message);
      repair = failure.message;
      status('validating', 'Recipe rejected; requesting one bounded repair…');
    }
  }
  if (!best) throw lastFailure ?? new GenerationFailure('Live generation failed.');
  const before = summary(first ?? best.lint);
  const after = summary(best.lint);
  notes.push(best.recipe.bible ? lintNote(before, after, calls.length > 1 && first !== best.lint) : clipNote(`No world bible in the model output; prose lint score ${after.score} recorded, not enforced.`));
  const totalMs = Date.now() - options.startedAt;
  return {
    recipe: best.recipe,
    metrics: { mode: best.recipe.bible ? 'single' : 'legacy', calls, foundationMs: totalMs, totalMs, lint: { before, after }, derivedBriefs: [], dropped: [] },
  };
}

// ---------------------------------------------------------------------------
// Staged providers
// ---------------------------------------------------------------------------

async function staged(options: PipelineOptions): Promise<GeneratedRecipe> {
  const { provider, request, seed, signal, notes, status } = options;
  const ideas = request.contributions.map((contribution) => contribution.text);
  const calls: CallMetric[] = [];
  const work = new AbortController();
  const onAbort = () => work.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  async function call(stage: PromptStage, label: string, input: unknown, schema: z.ZodType, maxTokens: number): Promise<unknown> {
    options.countCall();
    const began = Date.now();
    try {
      const { raw, usage } = await provider.callStage!({
        stage: label, system: buildSystemPrompt({ stage, seed, ideas }), input, schema: jsonSchema(schema), maxTokens,
      }, work.signal);
      calls.push({ stage: label, ms: Date.now() - began, ok: true, ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}) });
      return raw;
    } catch (error) {
      calls.push({ stage: label, ms: Date.now() - began, ok: false });
      throw error;
    }
  }

  /** One polish call for the lines the linter rejected; replacements are kept only where they lint better. */
  async function polish(label: string, parts: Parameters<typeof lintWorld>[0], bible: Foundation['bible'], lint: WorldLint): Promise<void> {
    if (!lint.hardFail) return;
    const failures = lint.failures.slice(0, 12);
    const raw = await call('polish', `polish:${label}`, {
      bible,
      fixes: failures.map(({ path, kind, maxChars, text, notes: editorNotes }) => ({ path, kind, maxChars, text, editorNotes })),
    }, PolishToolSchema, 2_000);
    const parsed = PolishToolSchema.safeParse(raw);
    if (parsed.success) applyFixes(parts, bible, failures, parsed.data.fixes);
  }

  try {
    // ---- call 1: foundation -------------------------------------------------
    status('generating', 'Writing the world bible and the first rooms…');
    const baseInput = {
      plannedRoomCount: request.plannedRoomCount,
      floors: options.floors,
      contributions: request.contributions.map(({ id, text }) => ({ id, text })),
      namePool: namePool(seed),
    };
    let parsedFoundation: ReturnType<typeof parseFoundation> | undefined;
    let repair: string | undefined;
    for (let attempt = 1; attempt <= 2 && !parsedFoundation; attempt++) {
      try {
        const raw = await call('foundation', 'foundation', { ...baseInput, ...(repair ? { repair } : {}) }, FoundationToolSchema, 4_000);
        signal?.throwIfAborted();
        const candidate = parseFoundation(raw);
        if ('legacy' in candidate) assertDisplayText(candidate.legacy);
        else {
          assertDisplayText({
            ...candidate.foundation.base, laws: candidate.foundation.laws, bible: candidate.foundation.bible,
            ...(candidate.foundation.opener ? { biomes: [candidate.foundation.opener.brief], biomeRoomLines: [{ biomeId: candidate.foundation.opener.brief.id, lines: candidate.foundation.opener.lines }] } : {}),
          });
        }
        parsedFoundation = candidate;
      } catch (error) {
        signal?.throwIfAborted();
        const failure = error instanceof StageParseError ? new GenerationFailure(error.message.slice(0, 200), true)
          : error instanceof GenerationFailure ? error : new GenerationFailure('Live generation failed.');
        if (!failure.repairable || attempt === 2) throw failure;
        notes.push(failure.message);
        repair = failure.message;
        status('validating', 'Recipe rejected; requesting one bounded repair…');
      }
    }
    if (!parsedFoundation) throw new GenerationFailure('Live generation failed.');
    const foundationMs = Date.now() - options.startedAt;

    if ('legacy' in parsedFoundation) {
      const lint = summary(lintWorld(parsedFoundation.legacy, undefined));
      notes.push(clipNote(`No world bible in the model output; prose lint score ${lint.score} recorded, not enforced.`));
      return {
        recipe: parsedFoundation.legacy,
        metrics: { mode: 'legacy', calls, foundationMs, totalMs: foundationMs, lint: { before: lint, after: lint }, derivedBriefs: [], dropped: [] },
      };
    }

    // ---- call 2: parallel, conditioned on the bible --------------------------
    const { foundation } = parsedFoundation;
    const { bible } = foundation;
    for (const note of foundation.notes) notes.push(clipNote(note));
    status('generating', 'Bible written. Writing relics, remains and floors from it…');

    const head = {
      ...foundation.base, laws: foundation.laws,
      ...(foundation.opener ? { biomes: [foundation.opener.brief], biomeRoomLines: [{ biomeId: foundation.opener.brief.id, lines: foundation.opener.lines }] } : {}),
    };
    const state: {
      relics?: WorldRecipe['lore']; remains?: WorldRecipe['lore']; attunements?: WorldRecipe['attunements'];
      briefs: Array<ParsedBrief | undefined>;
    } = { briefs: Array.from({ length: BIOME_BRIEF_COUNT }, () => undefined) };
    state.briefs[0] = foundation.opener;
    const before: WorldLint[] = [];
    let closed = false;
    const dropped: string[] = [];

    /** Runs `produce` with one retry on a schema/text failure. */
    async function withRetry<T>(label: string, produce: (repairNote?: string) => Promise<T>): Promise<T> {
      try {
        return await produce();
      } catch (error) {
        if (!(error instanceof StageParseError) || work.signal.aborted) throw error;
        return produce(error.message.slice(0, 200));
      }
    }
    const guard = (parts: Parameters<typeof displayTexts>[0]): void => {
      if (displayTexts(parts).some(isUnsafeText)) throw new StageParseError('Recipe text contained markup, a URL, or code.');
    };

    const relicSlots = planRelicSlots(request.plannedRoomCount, seed);
    const remainsEnemies = planRemainsEnemies(foundation, relicSlots.length);
    const biomeSlots = options.floors ? planBiomeSlots(bible, seed) : [];
    const openerForPrompt = foundation.opener ? { name: foundation.opener.brief.name, tagline: foundation.opener.brief.tagline, enemyPool: foundation.opener.brief.enemyPool, layout: foundation.opener.brief.layout } : null;

    const tasks: Array<[string, () => Promise<void>]> = [
      ['foundation polish', async () => {
        const lint = lintWorld(head, bible);
        before.push(lint);
        await polish('foundation', head, bible, lint);
      }],
      ['relics', async () => {
        const lore = await withRetry('relics', async (repairNote) => {
          const raw = await call('relics', 'relics', { bible, rooms: foundation.base.rooms.map((room, index) => ({ roomIndex: index, name: room.name })), slots: relicSlots, ...(repairNote ? { repair: repairNote } : {}) }, RelicsToolSchema, 3_000);
          const parsed = parseLore(raw, bible, { kind: 'relic', count: relicSlots.length });
          guard({ lore: parsed.lore });
          return parsed.lore.slice(0, relicSlots.length).map((fragment) => ({ ...fragment, enemyId: null, roomIndex: Math.min(fragment.roomIndex, request.plannedRoomCount - 1) }));
        });
        if (closed) return;
        state.relics = lore;
        const lint = lintWorld({ lore }, bible);
        before.push(lint);
        await polish('relics', { lore }, bible, lint);
      }],
      ['remains and attunements', async () => {
        const parts = await withRetry('remains', async (repairNote) => {
          const raw = await call('remains', 'remains', { bible, enemyIds: remainsEnemies, dangers: foundation.base.rooms.map((room) => ({ enemyIds: room.enemyIds, hazards: room.hazards })), ...(repairNote ? { repair: repairNote } : {}) }, RemainsToolSchema, 3_000);
          const parsed = parseLore(raw, bible, { kind: 'remains', count: remainsEnemies.length });
          const seen = new Set<string>();
          const lore = parsed.lore.filter((fragment) => fragment.enemyId !== null && remainsEnemies.includes(fragment.enemyId) && !seen.has(fragment.enemyId) && Boolean(seen.add(fragment.enemyId)))
            .map((fragment) => ({ ...fragment, roomIndex: 0 }));
          if (lore.length === 0) throw new StageParseError('Recipe failed schema validation at lore: every remains fragment needs an enemyId from the list.');
          const result = { lore, attunements: parseAttunements(raw) };
          guard(result);
          return result;
        });
        if (closed) return;
        state.remains = parts.lore;
        state.attunements = parts.attunements;
        const lint = lintWorld(parts, bible);
        before.push(lint);
        await polish('remains', parts, bible, lint);
      }],
      ...[biomeSlots.slice(0, 4), biomeSlots.slice(4)].filter((slots) => slots.length > 0).map((slots, part): [string, () => Promise<void>] => [`biome briefs ${slots[0]!.index}-${slots.at(-1)!.index}`, async () => {
        const raw = await call('biomes', `biomes:${part + 1}`, { bible, opener: openerForPrompt, slots: slots.map(({ position, setting, focusEvent }) => ({ position, setting, focusEvent })) }, BiomesToolSchema, 4_000);
        const parsed = parseBiomes(raw, slots[0]!.index, slots.length);
        const valid = parsed.filter((entry): entry is ParsedBrief => Boolean(entry) && !displayTexts({ biomes: [entry!.brief], biomeRoomLines: [{ biomeId: entry!.brief.id, lines: entry!.lines }] }).some(isUnsafeText));
        if (closed) return;
        parsed.forEach((entry, offset) => { state.briefs[slots[0]!.index + offset] = entry && valid.includes(entry) ? entry : undefined; });
        const parts = { biomes: valid.map((entry) => entry.brief), biomeRoomLines: valid.map((entry) => ({ biomeId: entry.brief.id, lines: entry.lines })) };
        const lint = lintWorld(parts, bible);
        before.push(lint);
        await polish(`biomes:${part + 1}`, parts, bible, lint);
      }]),
    ];

    const remaining = Math.max(1_000, options.budgetMs - (Date.now() - options.startedAt));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), remaining); });
    const settled = tasks.map(([label, run]) => run().then(() => ({ label, done: true as const }), (error: unknown) => ({ label, done: false as const, error })));
    const outcome = await Promise.race([Promise.all(settled), deadline]);
    clearTimeout(timer);
    closed = true;
    signal?.throwIfAborted();
    if (outcome === 'deadline') {
      work.abort(new GenerationFailure('World budget reached.'));
      notes.push(clipNote(`World budget of ${Math.round(options.budgetMs / 1000)}s reached; unfinished call-2 work was dropped.`));
    }
    const results = outcome === 'deadline' ? await Promise.all(settled.map((entry) => Promise.race([entry, Promise.resolve({ label: '', done: true as const })]))) : outcome;
    for (const result of results) {
      if (result.done) continue;
      const message = result.error instanceof Error ? result.error.message : 'failed';
      dropped.push(result.label);
      notes.push(clipNote(`Call 2 (${result.label}) failed: ${message}`));
    }
    if (!state.relics && !state.remains) notes.push('This world has no lore: both lore calls failed or ran out of time.');

    // ---- assemble ---------------------------------------------------------
    const derivedBriefs: number[] = [];
    const polishedFoundation: Foundation = {
      ...foundation, base: { ...foundation.base, title: head.title, tagline: head.tagline, themeSummary: head.themeSummary, rooms: head.rooms }, laws: head.laws,
    };
    const recipe = assembleRecipe({
      foundation: polishedFoundation,
      lore: [...(state.relics ?? []), ...(state.remains ?? [])],
      attunements: state.attunements ?? [],
      ...(options.floors ? {
        briefs: state.briefs,
        deriveBriefs: (partial: WorldRecipe) => deriveBiomeBriefs(partial, options.floorsSeed),
        onDerived: (indices: number[]) => derivedBriefs.push(...indices),
      } : {}),
    });
    if (derivedBriefs.length) notes.push(clipNote(`Biome brief(s) ${derivedBriefs.map((index) => index + 1).join(', ')} of 8 were derived by trusted code, not written by the model.`));
    assertDisplayText(recipe);

    const after = lintWorld(recipe, bible);
    const beforeSummary = mergeLint(before);
    const polished = calls.some((entry) => entry.stage.startsWith('polish') && entry.ok);
    notes.push(lintNote(beforeSummary, summary(after), polished));
    return {
      recipe,
      metrics: { mode: 'staged', calls, foundationMs, totalMs: Date.now() - options.startedAt, lint: { before: beforeSummary, after: summary(after) }, derivedBriefs, dropped },
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!work.signal.aborted) work.abort();
  }
}

/** Field-count-weighted merge of per-stage lint results (an approximation of the word-weighted whole). */
function mergeLint(parts: WorldLint[]): LintSummary {
  const fieldCount = parts.reduce((sum, lint) => sum + lint.fieldCount, 0);
  return {
    score: fieldCount ? Math.round((parts.reduce((sum, lint) => sum + lint.score * lint.fieldCount, 0) / fieldCount) * 10) / 10 : 0,
    failedFields: parts.reduce((sum, lint) => sum + lint.failedFields, 0),
    fieldCount,
    rules: [...new Set(parts.flatMap((lint) => lint.rules))],
  };
}
