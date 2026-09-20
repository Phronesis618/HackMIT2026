/**
 * Recipe generation pipeline (agent W2): bible first, prose second, linter in the loop.
 *
 * STAGED (providers with `callStage`, i.e. the Claude and OpenAI API providers)
 *   call 1  foundation: bible, title/tagline/summary, motifs, palette. Nothing else: output
 *           tokens are the latency (~54 tokens/s measured), and everything else needs the bible.
 *           Up to one repair round on schema/text-guard failure, as before.
 *   call 2  in parallel, conditioned on the bible from call 1: rooms + palette + mappings
 *           (load-bearing) · laws + look + terrain skins + Custodian · relics · remains +
 *           attunements · biome briefs in four calls of two (floors only) · a polish call for
 *           rejected header lines. Every call is sized to about 1,200 output tokens (~25 s). Each call-2 task: one retry on a schema failure, then one polish
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
import { buildSystemPrompt, namePool, worldSeeds, type PromptStage } from './prompt';
import { GenerationFailure, assertDisplayText, type ProviderUsage, type RecipeProvider } from './provider';
import {
  BiomesToolSchema, FoundationToolSchema, PolishToolSchema, RelicsToolSchema, LawsToolSchema, RemainsToolSchema, RoomsToolSchema, StageParseError,
  applyFixes, assembleRecipe, briefRejections, cutFailures, displayTexts, fitOverlong, isUnsafeText, jsonSchema, lintWorld, parseAttunements, parseBiomes,
  fitHeader, headerOverflow, parseFoundation, parseLaws, parseLore, parseRooms, planBiomeSlots, planRelicSlots, planRemainsSlots, replaceEngineWords,
  type Foundation, type LawsPart, type ParsedBrief, type RoomsPart, type TextCut, type WorldLint,
} from './stages';
import type { z } from 'zod';

export const DEFAULT_WORLD_BUDGET_MS = 75_000;

export interface CallMetric { stage: string; ms: number; ok: boolean; inputTokens?: number; outputTokens?: number; error?: string }
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
  onCall?: ((metric: CallMetric) => void) | undefined;
  /** The shape (keys, types, first characters) of a reply that failed validation. Never the key, never the prompt. */
  onRejected?: ((stage: string, shape: string) => void) | undefined;
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
  // The seeded ingredients this world was handed. The document kinds go to the linter too, so
  // a fragment that copies its seed out of the prompt data is caught (`seeded-kind`).
  const seeds = worldSeeds(seed);
  const lintOptions = { seeds: seeds.documentKinds };
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
      options.onCall?.(calls.at(-1)!);
      return raw;
    } catch (error) {
      calls.push({ stage: label, ms: Date.now() - began, ok: false, error: error instanceof Error ? error.message.slice(0, 120) : 'failed' });
      options.onCall?.(calls.at(-1)!);
      throw error;
    }
  }

  /** Lines trusted code shortened at parse time, sent back to be written short instead of cut. */
  function cuts(parts: Parameters<typeof lintWorld>[0], bible: Foundation['bible'], list: readonly TextCut[]): WorldLint['failures'] {
    const failures = cutFailures(parts, bible, list);
    if (failures.length) notes.push(clipNote(`${failures.length} line(s) came back over their limit and were sent back to be rewritten short rather than cut.`));
    return failures;
  }

  /**
   * Polish: the lines the linter rejected go back with the editor's notes; a replacement is kept
   * only where it lints better. At most two rounds per stage (a round is ~2 s and ~100 tokens).
   */
  async function polish(label: string, parts: Parameters<typeof lintWorld>[0], bible: Foundation['bible'], lint: WorldLint, extra: WorldLint['failures'] = []): Promise<void> {
    let failures = [...extra, ...lint.failures].slice(0, 12);
    for (let round = 1; round <= 2 && failures.length > 0; round++) {
      const raw = await call('polish', `polish:${label}`, {
        bible,
        fixes: failures.map(({ path, kind, maxChars, text, notes: editorNotes }) => ({ path, kind, maxChars, text, editorNotes })),
      }, PolishToolSchema, 2_000);
      const parsed = PolishToolSchema.safeParse(raw);
      if (parsed.success) applyFixes(parts, bible, failures, parsed.data.fixes);
      failures = [...(label === 'header' ? headerOverflow(parts as Foundation['header']) : []), ...lintWorld(parts, bible, lintOptions).failures].slice(0, 12);
    }
    fitOverlong(parts, bible);
  }

  try {
    // ---- call 1: foundation (bible + header). Output tokens are the latency, so it is small. ----
    status('generating', 'Writing the world bible…');
    const contributions = request.contributions.map(({ id, text }) => ({ id, text }));
    let parsedFoundation: ReturnType<typeof parseFoundation> | undefined;
    let repair: string | undefined;
    for (let attempt = 1; attempt <= 2 && !parsedFoundation; attempt++) {
      try {
        const raw = await call('foundation', 'foundation', { contributions, namePool: namePool(seed), ...seeds, ...(repair ? { repair } : {}) }, FoundationToolSchema, 2_500);
        signal?.throwIfAborted();
        let candidate: ReturnType<typeof parseFoundation>;
        try {
          candidate = parseFoundation(raw);
        } catch (error) {
          const shape = raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' ? `string(${value.length}): ${value.slice(0, 160)}` : Array.isArray(value) ? `array(${value.length})` : typeof value])) : typeof raw;
          options.onRejected?.('foundation', JSON.stringify(shape).slice(0, 900));
          throw error;
        }
        assertDisplayText('legacy' in candidate ? candidate.legacy : { ...candidate.foundation.header, bible: candidate.foundation.bible });
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
    status('generating', 'Bible written. Writing rooms, relics, remains and floors from it…');

    const header = { ...foundation.header };
    const state: {
      rooms?: RoomsPart; laws?: LawsPart; relics?: WorldRecipe['lore']; remains?: WorldRecipe['lore']; attunements?: WorldRecipe['attunements'];
      briefs: Array<ParsedBrief | undefined>;
    } = { briefs: Array.from({ length: BIOME_BRIEF_COUNT }, () => undefined) };
    const before: WorldLint[] = [];
    let closed = false;
    const dropped: string[] = [];

    /** Runs `produce` with one retry on a schema/text failure. */
    async function withRetry<T>(produce: (repairNote?: string) => Promise<T>): Promise<T> {
      try {
        return await produce();
      } catch (error) {
        if (!(error instanceof StageParseError) || work.signal.aborted) throw error;
        notes.push(clipNote(error.message));
        return produce(error.message.slice(0, 200));
      }
    }
    const guard = (parts: Parameters<typeof displayTexts>[0]): void => {
      if (displayTexts(parts).some(isUnsafeText)) throw new StageParseError('Recipe text contained markup, a URL, or code.');
    };

    const relicSlots = planRelicSlots(request.plannedRoomCount, seed, bible.events.length);
    const remainsSlots = planRemainsSlots(bible, relicSlots.length, seed);
    const remainsEnemies = remainsSlots.map((slot) => slot.enemyId);
    const biomeSlots = options.floors ? planBiomeSlots(bible, seed) : [];
    const world = { title: header.title, tagline: header.tagline };

    const tasks: Array<[string, () => Promise<void>]> = [
      ['header polish', async () => {
        const lint = lintWorld(header, bible, lintOptions);
        before.push(lint);
        await polish('header', header, bible, lint, headerOverflow(header));
      }],
      ['rooms', async () => {
        const part = await withRetry(async (repairNote) => {
          const raw = await call('rooms', 'rooms', { plannedRoomCount: request.plannedRoomCount, contributions, world, bible, ...(repairNote ? { repair: repairNote } : {}) }, RoomsToolSchema, 3_000);
          const parsed = parseRooms(raw);
          guard(parsed);
          return parsed;
        });
        if (closed) return;
        state.rooms = part;
        const lint = lintWorld(part, bible, lintOptions);
        before.push(lint);
        await polish('rooms', part, bible, lint, cuts(part, bible, part.cuts));
      }],
      ['laws, look and Custodian', async () => {
        const raw = await call('laws', 'laws', { world, bible }, LawsToolSchema, 2_500);
        const part = parseLaws(raw, bible);
        guard(part);
        if (closed) return;
        state.laws = part;
        for (const note of part.notes) notes.push(clipNote(note));
        const lint = lintWorld(part, bible, lintOptions);
        before.push(lint);
        await polish('laws', part, bible, lint, cuts(part, bible, part.cuts));
      }],
      ['relics', async () => {
        const lore = await withRetry(async (repairNote) => {
          const raw = await call('relics', 'relics', { bible, slots: relicSlots, ...(repairNote ? { repair: repairNote } : {}) }, RelicsToolSchema, 3_000);
          const parsed = parseLore(raw, bible, { kind: 'relic', count: relicSlots.length });
          guard({ lore: parsed.lore });
          return {
            lore: parsed.lore.slice(0, relicSlots.length).map((fragment, index) => ({ ...fragment, enemyId: null, roomIndex: relicSlots[index]!.roomIndex })),
            cuts: parsed.cuts,
          };
        });
        if (closed) return;
        state.relics = lore.lore;
        const parts = { lore: lore.lore };
        const lint = lintWorld(parts, bible, lintOptions);
        before.push(lint);
        await polish('relics', parts, bible, lint, cuts(parts, bible, lore.cuts));
      }],
      ['remains and attunements', async () => {
        const parts = await withRetry(async (repairNote) => {
          const raw = await call('remains', 'remains', { bible, world, slots: remainsSlots, attunementOwners: bible.people.map((person) => person.name), ...(repairNote ? { repair: repairNote } : {}) }, RemainsToolSchema, 3_000);
          const parsed = parseLore(raw, bible, { kind: 'remains', count: remainsEnemies.length });
          const seen = new Set<string>();
          const lore = parsed.lore.filter((fragment) => fragment.enemyId !== null && remainsEnemies.includes(fragment.enemyId) && !seen.has(fragment.enemyId) && Boolean(seen.add(fragment.enemyId)))
            .map((fragment) => ({ ...fragment, roomIndex: 0 }));
          if (lore.length === 0) throw new StageParseError('Recipe failed schema validation at lore: every remains fragment needs an enemyId from the list.');
          // Remains fragments are re-indexed by the filter above, so only the attunement cuts carry over.
          const stageCuts: TextCut[] = [];
          const result = { lore, attunements: parseAttunements(raw, stageCuts), cuts: stageCuts };
          guard(result);
          return result;
        });
        if (closed) return;
        state.remains = parts.lore;
        state.attunements = parts.attunements;
        const lint = lintWorld(parts, bible, lintOptions);
        before.push(lint);
        await polish('remains', parts, bible, lint, cuts(parts, bible, parts.cuts));
      }],
      ...[biomeSlots.slice(0, 2), biomeSlots.slice(2, 4), biomeSlots.slice(4, 6), biomeSlots.slice(6)].filter((slots) => slots.length > 0).map((slots, part): [string, () => Promise<void>] => [`biome briefs ${slots[0]!.index + 1}-${slots.at(-1)!.index + 1}`, async () => {
        const raw = await call('biomes', `biomes:${part + 1}`, { bible, world, slots: slots.map(({ position, setting, focusEvent, namesTaken }) => ({ position, setting, focusEvent, namesTaken })) }, BiomesToolSchema, 3_000);
        const parsed = parseBiomes(raw, slots[0]!.index, slots.length);
        parsed.forEach((entry, offset) => {
          const reason = briefRejections.get(slots[0]!.index + offset);
          if (!entry && reason) notes.push(clipNote(`Biome brief ${slots[0]!.index + offset + 1} was rejected: ${reason}`));
        });
        const valid = parsed.filter((entry): entry is ParsedBrief => entry !== undefined && !displayTexts({ biomes: [entry.brief], biomeRoomLines: [{ biomeId: entry.brief.id, lines: entry.lines }] }).some(isUnsafeText));
        if (closed) return;
        parsed.forEach((entry, offset) => { state.briefs[slots[0]!.index + offset] = entry && valid.includes(entry) ? entry : undefined; });
        const parts = { biomes: valid.map((entry) => entry.brief), biomeRoomLines: valid.map((entry) => ({ biomeId: entry.brief.id, lines: entry.lines })) };
        const briefCuts = valid.flatMap((entry, local) => entry.cuts.map((cut) => ({ ...cut, path: `biomes[${local}].${cut.path}` })));
        const lint = lintWorld(parts, bible, lintOptions);
        before.push(lint);
        await polish(`biomes:${part + 1}`, parts, bible, lint, cuts(parts, bible, briefCuts));
      }]),
    ];

    const remaining = Math.max(1_000, options.budgetMs - (Date.now() - options.startedAt));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), remaining); });
    const finished = new Map<string, unknown>();
    const running = tasks.map(([label, run]) => run().then(() => { finished.set(label, null); }, (error: unknown) => { finished.set(label, error ?? new Error('failed')); }));
    const outcome = await Promise.race([Promise.all(running).then(() => 'done' as const), deadline]);
    clearTimeout(timer);
    closed = true;
    signal?.throwIfAborted();
    if (outcome === 'deadline') {
      work.abort(new GenerationFailure('World budget reached.'));
      notes.push(clipNote(`World budget of ${Math.round(options.budgetMs / 1000)}s reached; unfinished call-2 work was dropped.`));
    }
    for (const [label] of tasks) {
      const error = finished.has(label) ? finished.get(label) : new Error('not finished within the world budget');
      if (error === null) continue;
      dropped.push(label);
      notes.push(clipNote(`Call 2 (${label}) failed: ${error instanceof Error ? error.message : 'failed'}`));
    }
    if (!state.rooms) throw new GenerationFailure('The rooms call failed, so no world could be compiled.');
    if (!state.relics && !state.remains) notes.push('This world has no lore: both lore calls failed or ran out of time.');

    // ---- assemble ---------------------------------------------------------
    const derivedBriefs: number[] = [];
    const recipe = assembleRecipe({
      foundation: { bible, header: fitHeader(header) },
      roomsPart: state.rooms,
      lawsPart: state.laws,
      lore: [...(state.relics ?? []), ...(state.remains ?? [])],
      attunements: state.attunements ?? [],
      ...(options.floors ? {
        briefs: state.briefs,
        briefDates: biomeSlots.map((slot) => slot.focusDate),
        deriveBriefs: (partial: WorldRecipe) => deriveBiomeBriefs(partial, options.floorsSeed),
        onDerived: (indices: number[]) => derivedBriefs.push(...indices),
      } : {}),
    });
    if (derivedBriefs.length) notes.push(clipNote(`Biome brief(s) ${derivedBriefs.map((index) => index + 1).join(', ')} of 8 were derived by trusted code, not written by the model.`));
    const swapped = replaceEngineWords(recipe, bible);
    if (swapped) notes.push(clipNote(`${swapped} line(s) still naming a registry enemy id were rewritten to the bible's former job by trusted code.`));
    const cut = fitOverlong(recipe, bible);
    if (cut) notes.push(clipNote(`${cut} line(s) over their length limit were cut at a sentence or clause end by trusted code.`));
    assertDisplayText(recipe);

    const after = lintWorld(recipe, bible, lintOptions);
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
