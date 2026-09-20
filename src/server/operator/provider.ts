/**
 * Operator provider — DEMO ONLY (Agent A).
 *
 * A `RecipeProvider` that needs no API key. Instead of calling a model over HTTP it hands
 * each generation request to a coding agent that is watching a directory:
 *
 *   <dir>/inbox/<requestId>-<attempt>.json   written by the server: contributions, rules, registry
 *   <dir>/outbox/<requestId>-<attempt>.json  written by the agent: ONE WorldRecipe JSON object
 *   <dir>/done/                              consumed request/reply pairs (audit trail)
 *   <dir>/README.md, world-recipe.schema.json protocol + schema for the agent
 *
 * Everything the agent writes is untrusted data: it is validated with `WorldRecipeSchema`,
 * checked for markup/URLs/code, then compiled by the same trusted compiler as the API
 * providers (see src/server/generation/liveService.ts). An invalid reply triggers the
 * normal one-bounded-repair loop; silence past the deadline resolves to the labelled
 * fixture fallback. Provenance stays honest: the world is `live` with model `cursor-agent`.
 *
 * POLISH MODE (`polish` option): the offline composer drafts the whole world in milliseconds
 * and the agent gets a short window to edit it. The inbox file then carries the `draft` and an
 * `edit` sheet of its player-facing text; the reply is the sheet with changes (a partial patch,
 * merged over the draft by position) or a full recipe. Silence, or no presence heartbeat at
 * `<dir>/PRESENT`, ships the draft unchanged, so a crew never waits on an absent operator. The
 * world is `procedural` either way; the provenance notes say whether it was edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ZodError } from 'zod';
import { FloorsWorldRecipeSchema, type GenerationRequest, type WorldRecipe } from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import { ENEMY_IDS, MOTIF_IDS, PROP_IDS } from '../../shared/registry';
import { buildSystemPrompt, namePool, registryText, worldSeeds } from '../generation/prompt';
import { GenerationFailure, assertDisplayText, type RecipeProvider } from '../generation/provider';
import { FullRecipeToolSchema, StageParseError, jsonSchema, parseFullRecipe } from '../generation/stages';

/** Shown in provenance labels: "LIVE · cursor-agent". */
export const OPERATOR_MODEL = 'cursor-agent';
/** Heartbeat file the operator's watcher touches; polish mode waits only while it is fresh. */
export const OPERATOR_PRESENCE_FILE = 'PRESENT';
export const DEFAULT_POLISH_TIMEOUT_MS = 90_000;
export const DEFAULT_PRESENCE_MAX_AGE_MS = 20_000;
const MAX_REPLY_BYTES = 256 * 1024;
const INVALID_JSON_GRACE_POLLS = 5;
/** Arrays a patch may lengthen. Rooms, biomes and the bible keep the draft's counts. */
const GROWABLE_ARRAYS: ReadonlySet<string> = new Set(['contributionMappings', 'lore', 'laws', 'attunements', 'terrainSkins']);

export interface OperatorPolishOptions {
  /** Builds the instant draft (the offline composer). Throws only on a composer bug. */
  draft: (request: GenerationRequest) => WorldRecipe;
  /** How long to wait for the operator's edit before the draft ships unchanged. Default 90 s. */
  timeoutMs?: number;
  /** Max age of `<dir>/PRESENT` for the operator to count as watching. Default 20 s; Infinity waits regardless. */
  presenceMaxAgeMs?: number;
}

export interface OperatorProviderOptions {
  /** Root directory; inbox/outbox/done are created inside it. */
  dir: string;
  /** Deadline for a reply before the labelled fixture fallback. Default 180 s. */
  timeoutMs?: number;
  /** Outbox poll interval. Default 400 ms. */
  pollMs?: number;
  /** Composer-drafts-operator-edits mode; see the module comment. */
  polish?: OperatorPolishOptions;
  log?: (message: string) => void;
  now?: () => number;
}

/** The player-facing text of a draft, in the shape the operator edits and sends back. */
export interface PolishSheet {
  title: string;
  tagline: string;
  themeSummary: string;
  rooms: Array<{ name: string; description: string }>;
  laws?: Array<{ name: string; description: string }>;
  custodian?: { title: string; phaseTitles: string[]; moves: Array<{ name: string; tell: string }> };
  biomes?: Array<{ name: string; tagline: string }>;
  lore: Array<{ title: string; source: string; text: string }>;
  attunements: Array<{ name: string; description: string }>;
}

/** Exact shape of an inbox file (also documented in <dir>/README.md for the agent). */
export interface OperatorRequestFile {
  kind: 'relay_operator_request';
  /** `author`: write the whole recipe. `polish`: edit the composer's `draft` via the `edit` sheet. */
  mode: 'author' | 'polish';
  requestId: string;
  sessionId: string;
  attempt: number;
  plannedRoomCount: number;
  createdAt: number;
  deadlineAt: number;
  contributions: Array<{ id: string; playerName: string; text: string }>;
  /** Validation feedback from the previous attempt, or null on the first attempt. */
  repair: string | null;
  /** True when the world will be played as floors: write the 8 `biomes` too. */
  floors: boolean;
  /** Plain names to draw on for bible people when the ideas imply no culture. */
  namePool: string[];
  registry: { motifIds: string[]; propIds: string[]; enemyIds: string[]; full: unknown };
  /**
   * The single-call runtime instructions (prompts/runtime/world-recipe.md with the house rules,
   * every section and this request's rotated exemplars): bible first, then text derived from it.
   * In polish mode: the short editing brief instead.
   */
  instructions: string;
  /** Polish mode only: the composer's complete draft recipe. */
  draft?: WorldRecipe;
  /** Polish mode only: the draft's editable text, pre-filled. Change what you like, keep the positions. */
  edit?: PolishSheet;
  reply: { path: string; format: string };
}

export interface OperatorProvider extends RecipeProvider {
  readonly dir: string;
  readonly inboxDir: string;
  readonly outboxDir: string;
  readonly doneDir: string;
  /** Inbox file names still waiting for a reply. */
  pending(): string[];
}

export function createOperatorProvider(options: OperatorProviderOptions): OperatorProvider {
  const dir = path.resolve(options.dir);
  const inboxDir = path.join(dir, 'inbox');
  const outboxDir = path.join(dir, 'outbox');
  const doneDir = path.join(dir, 'done');
  const timeoutMs = Math.max(1, options.timeoutMs ?? 180_000);
  const pollMs = Math.max(20, options.pollMs ?? 400);
  const polish = options.polish;
  const polishTimeoutMs = Math.max(1, polish?.timeoutMs ?? DEFAULT_POLISH_TIMEOUT_MS);
  const presenceMaxAgeMs = polish?.presenceMaxAgeMs ?? DEFAULT_PRESENCE_MAX_AGE_MS;
  const presenceFile = path.join(dir, OPERATOR_PRESENCE_FILE);
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number>();
  const waiting = new Set<string>();
  let protocolWritten = false;


  function ensureLayout(): void {
    for (const d of [inboxDir, outboxDir, doneDir]) fs.mkdirSync(d, { recursive: true });
    if (protocolWritten) return;
    protocolWritten = true;
    atomicWrite(path.join(dir, 'world-recipe.schema.json'), JSON.stringify(jsonSchema(FullRecipeToolSchema), null, 2));
    atomicWrite(path.join(dir, 'README.md'), protocolReadme(dir, timeoutMs, polish ? polishTimeoutMs : null));
  }

  /** Polish mode waits only while somebody is demonstrably watching: `PRESENT` touched recently. */
  function operatorPresent(): boolean {
    if (!Number.isFinite(presenceMaxAgeMs)) return true;
    try {
      return now() - fs.statSync(presenceFile).mtimeMs <= presenceMaxAgeMs;
    } catch {
      return false;
    }
  }

  function retire(name: string, outcome: string): void {
    const stamp = `${new Date(now()).toISOString().replace(/[:.]/g, '-')}.${outcome}`;
    for (const [from, suffix] of [[path.join(inboxDir, name), 'request'], [path.join(outboxDir, name), 'reply']] as const) {
      try {
        if (fs.existsSync(from)) fs.renameSync(from, path.join(doneDir, `${name.replace(/\.json$/, '')}.${stamp}.${suffix}.json`));
      } catch {
        // best effort; the audit trail must never break generation
      }
    }
  }

  async function waitForReply(file: string, deadlineAt: number, signal?: AbortSignal): Promise<unknown> {
    let invalidReads = 0;
    while (true) {
      signal?.throwIfAborted();
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file);
        if (stat.size > MAX_REPLY_BYTES) throw new GenerationFailure('Operator reply exceeded the size limit.', true);
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        } catch {
          // a partially written file; give the writer a moment before giving up
          if (++invalidReads >= INVALID_JSON_GRACE_POLLS) throw new GenerationFailure('Recipe was not valid JSON.', true);
        }
      }
      if (now() >= deadlineAt) {
        throw new GenerationFailure(`Operator did not reply within ${Math.round(timeoutMs / 1000)}s.`);
      }
      await sleep(pollMs, undefined, signal ? { signal } : {});
    }
  }

  /**
   * Next inbox/outbox file pair for a request; attempts count up across re-issues. The id is
   * percent-encoded rather than stripped, so two distinct request ids cannot share a filename.
   */
  function nextAttempt(request: GenerationRequest): { attempt: number; name: string; inboxPath: string; outboxPath: string } {
    const attempt = (attempts.get(request.requestId) ?? 0) + 1;
    attempts.set(request.requestId, attempt);
    const name = `${encodeURIComponent(request.requestId)}-${attempt}.json`;
    return { attempt, name, inboxPath: path.join(inboxDir, name), outboxPath: path.join(outboxDir, name) };
  }

  function writeRequest(inboxPath: string, outboxPath: string, file: OperatorRequestFile): void {
    try {
      if (fs.existsSync(outboxPath)) fs.rmSync(outboxPath, { force: true });
      atomicWrite(inboxPath, JSON.stringify(file, null, 2));
    } catch (error) {
      throw new GenerationFailure(`Operator inbox is not writable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
    }
  }

  /**
   * Polish mode. The draft is final unless a valid edit arrives in time; nothing here can end
   * in a fixture, and an absent operator costs the crew nothing.
   */
  async function polishFlow(request: GenerationRequest, repair: string | undefined, signal: AbortSignal | undefined, polishOptions: OperatorPolishOptions) {
    let draft: WorldRecipe;
    try {
      draft = polishOptions.draft(request);
    } catch (error) {
      throw new GenerationFailure(`Composer could not draft a recipe: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
    }
    if (!operatorPresent()) {
      log(`operator: nobody is watching the inbox (no fresh ${OPERATOR_PRESENCE_FILE}); composer draft "${draft.title}" ships unchanged`);
      return { recipe: draft, notes: ['No operator was watching the inbox; the composed draft is used as composed.'] };
    }
    const createdAt = now();
    const deadlineAt = createdAt + polishTimeoutMs;
    const seed = request.seed ?? hashString(request.requestId);
    let feedback: string | null = repair ?? null;
    while (true) {
      const { attempt, name, inboxPath, outboxPath } = nextAttempt(request);
      const file: OperatorRequestFile = {
        kind: 'relay_operator_request',
        mode: 'polish',
        requestId: request.requestId,
        sessionId: request.sessionId,
        attempt,
        plannedRoomCount: request.plannedRoomCount,
        createdAt,
        deadlineAt,
        contributions: request.contributions.map(({ id, playerName, text }) => ({ id, playerName, text })),
        repair: feedback,
        floors: request.floors === true,
        namePool: namePool(seed),
        registry: { motifIds: [...MOTIF_IDS], propIds: [...PROP_IDS], enemyIds: [...ENEMY_IDS], full: null },
        instructions: polishInstructions(Math.round(polishTimeoutMs / 1000)),
        draft,
        edit: polishSheet(draft),
        reply: {
          path: outboxPath,
          format: 'Write ONE JSON object to reply.path: the `edit` sheet with your changes (same keys and array positions; leave out what you did not change), or a full WorldRecipe. Nothing else.',
        },
      };
      writeRequest(inboxPath, outboxPath, file);
      waiting.add(name);
      log(`operator: polish window ${Math.max(0, Math.round((deadlineAt - now()) / 1000))}s for ${outboxPath} (draft "${draft.title}"${feedback ? ', repair' : ''})`);
      let outcome = 'failed';
      try {
        const raw = await waitForReply(outboxPath, deadlineAt, signal);
        const merged = mergePatch(draft, raw);
        const parsed = FloorsWorldRecipeSchema.safeParse(merged);
        if (!parsed.success) throw new GenerationFailure(`Edited recipe failed schema validation at ${zodIssues(parsed.error)}.`, true);
        assertDisplayText(parsed.data);
        const changed = changedKeys(draft, parsed.data);
        outcome = 'accepted';
        const seconds = Math.round((now() - createdAt) / 1000);
        log(`operator: edit accepted for "${parsed.data.title}" after ${seconds}s (attempt ${attempt}; changed ${changed.join(', ') || 'nothing'})`);
        return {
          recipe: parsed.data,
          notes: [changed.length ? `Composed draft edited by the operator in ${seconds}s: ${changed.join(', ')}.` : `The operator returned the composed draft unchanged after ${seconds}s.`],
        };
      } catch (error) {
        if (signal?.aborted) {
          outcome = 'cancelled';
          throw error;
        }
        if (!(error instanceof GenerationFailure)) throw error;
        log(`operator: ${error.message}`);
        if (error.repairable) {
          outcome = 'rejected';
          feedback = error.message;
          continue;
        }
        outcome = 'timeout';
        return { recipe: draft, notes: [`The operator did not edit the composed draft within ${Math.round(polishTimeoutMs / 1000)}s; it is used as composed.`] };
      } finally {
        waiting.delete(name);
        retire(name, outcome);
      }
    }
  }

  return {
    dir, inboxDir, outboxDir, doneDir,
    // Authoring mode is a live model call in all but transport. Polish mode is the composer's
    // procedural world with edits, and is labelled as the composer's.
    source: polish ? 'procedural' : 'live',
    badge: polish ? 'COMPOSED' : 'LIVE',
    pending: () => [...waiting],
    async generate(request: GenerationRequest, repair?: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      ensureLayout();
      if (polish) return polishFlow(request, repair, signal, polish);
      const createdAt = now();
      const deadlineAt = createdAt + timeoutMs;
      let feedback: string | null = repair ?? null;
      const seed = request.seed ?? hashString(request.requestId);
      const instructions = buildSystemPrompt({ stage: 'full', seed, ideas: request.contributions.map((c) => c.text) });
      // Unlike an API model, the operator can be corrected cheaply: every invalid reply is
      // retired and the request is re-issued (attempt+1, with the validation message as
      // `repair`) until the single deadline passes. The caller sees one attempt.
      while (true) {
        const { attempt, name, inboxPath, outboxPath } = nextAttempt(request);
        const file: OperatorRequestFile = {
          kind: 'relay_operator_request',
          mode: 'author',
          requestId: request.requestId,
          sessionId: request.sessionId,
          attempt,
          plannedRoomCount: request.plannedRoomCount,
          createdAt,
          deadlineAt,
          contributions: request.contributions.map(({ id, playerName, text }) => ({ id, playerName, text })),
          repair: feedback,
          floors: request.floors === true,
          namePool: namePool(seed),
          ...worldSeeds(seed),
          registry: { motifIds: [...MOTIF_IDS], propIds: [...PROP_IDS], enemyIds: [...ENEMY_IDS], full: JSON.parse(registryText('full')) as unknown },
          instructions,
          reply: {
            path: outboxPath,
            format: 'Write exactly one WorldRecipe JSON object (see ../world-recipe.schema.json) to reply.path. Nothing else.',
          },
        };
        writeRequest(inboxPath, outboxPath, file);
        waiting.add(name);
        const remaining = Math.max(0, Math.round((deadlineAt - now()) / 1000));
        log(`operator: waiting up to ${remaining}s for ${outboxPath} (${request.contributions.length} idea(s)${feedback ? ', repair' : ''})`);
        let outcome = 'failed';
        try {
          const raw = await waitForReply(outboxPath, deadlineAt, signal);
          let parsed: ReturnType<typeof parseFullRecipe>;
          try {
            parsed = parseFullRecipe(raw);
          } catch (error) {
            if (error instanceof StageParseError) throw new GenerationFailure(error.message.slice(0, 200), true);
            throw error;
          }
          assertDisplayText(parsed.recipe);
          outcome = 'accepted';
          log(`operator: accepted "${parsed.recipe.title}" after ${Math.round((now() - createdAt) / 1000)}s (attempt ${attempt})`);
          return { recipe: parsed.recipe, ...(parsed.notes.length ? { notes: parsed.notes } : {}) };
        } catch (error) {
          if (signal?.aborted) outcome = 'cancelled';
          else if (error instanceof GenerationFailure) outcome = error.repairable ? 'rejected' : 'timeout';
          if (error instanceof GenerationFailure) log(`operator: ${error.message}`);
          if (outcome !== 'rejected' || !(error instanceof GenerationFailure)) throw error;
          feedback = error.message;
        } finally {
          waiting.delete(name);
          retire(name, outcome);
        }
      }
    },
  };
}

function atomicWrite(file: string, contents: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

/** The draft's player-facing text, pre-filled, in the positions the merge expects back. */
export function polishSheet(recipe: WorldRecipe): PolishSheet {
  return {
    title: recipe.title,
    tagline: recipe.tagline,
    themeSummary: recipe.themeSummary,
    rooms: recipe.rooms.map(({ name, description }) => ({ name, description })),
    ...(recipe.laws?.length ? { laws: recipe.laws.map(({ name, description }) => ({ name, description })) } : {}),
    ...(recipe.custodian
      ? { custodian: { title: recipe.custodian.title, phaseTitles: [...recipe.custodian.phaseTitles], moves: recipe.custodian.moves.map(({ name, tell }) => ({ name, tell })) } }
      : {}),
    ...(recipe.biomes?.length ? { biomes: recipe.biomes.map(({ name, tagline }) => ({ name, tagline })) } : {}),
    lore: recipe.lore.map(({ title, source, text }) => ({ title, source, text })),
    attunements: recipe.attunements.map(({ name, description }) => ({ name, description })),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Merge an operator patch over the draft. Objects merge key by key, arrays position by
 * position (so a sheet with only some rooms' text touched leaves the rest alone), and a
 * `null`/missing value means "unchanged". Only the arrays in GROWABLE_ARRAYS may gain items;
 * rooms, biomes and the bible keep the draft's counts. Every scalar the patch does set replaces
 * the draft's, and the whole result is schema-validated afterwards, so the patch is never trusted.
 */
export function mergePatch(base: unknown, patch: unknown, key = ''): unknown {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(base) && Array.isArray(patch)) {
    const merged = base.map((item, index) => (index < patch.length ? mergePatch(item, patch[index], key) : item));
    if (GROWABLE_ARRAYS.has(key) && patch.length > base.length) merged.push(...patch.slice(base.length));
    return merged;
  }
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = k in base ? mergePatch(base[k], v, k) : v;
    return out;
  }
  return patch;
}

/** Top-level keys whose serialised value differs: what the note tells the crew was edited. */
export function changedKeys(before: WorldRecipe, after: WorldRecipe): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k])).sort();
}

function zodIssues(error: ZodError): string {
  return error.issues.slice(0, 4).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ').slice(0, 300);
}

/** The editing brief for polish mode: short, because the window is. */
export function polishInstructions(seconds: number): string {
  return `You have ${seconds} seconds to edit a world the offline composer has already drafted from the players' ideas
(\`contributions\`). The draft is complete and valid; the game ships it unchanged if you are silent.
Your job is to make its text belong to THESE ideas: rename the place, rewrite the tagline and theme
summary, and touch the room names, room descriptions and biome names/taglines so a player who typed
the idea recognises it in the first room. When \`floors\` is true the crew descends through the
\`biomes\`: their names and taglines are what players read on every floor, so edit those first and
treat \`rooms\` as the fallback. Edit the lore titles/texts and attunement names only if time
allows; leave anything you do not improve.

Reply with the \`edit\` sheet: same keys, same array positions, only the fields you changed (or the
whole sheet; unchanged values are harmless). Do not add or remove rooms or biomes. Do not touch ids,
motifs, props, enemies, terrain, palette or laws' ids. Plain text only: no markup, URLs or code.
Limits (characters): title 40 (four words at most), tagline 80 (eleven words), themeSummary 160,
room name 40, room description 300 (aim 100: threat first, then a usable feature, present tense),
law name 36 / description 160, biome name 40 / tagline 80, lore title 40 / source 60 / text 520,
attunement name 40 / description 160. Take every idea literally and treat it as somebody's
workplace; name creatures by a former job, never by an engine id (husk, sentinel, lurker...).`;
}

function protocolReadme(dir: string, timeoutMs: number, polishTimeoutMs: number | null): string {
  return `# RELAY operator inbox (demo-only generation transport)

This directory is written by the RELAY server when \`RELAY_AI_PROVIDER=operator\`.
A coding agent watching it plays the role of the world-generation model.
${polishTimeoutMs === null ? '' : `
## Polish mode (active: RELAY_OPERATOR_MODE=polish)

The offline composer drafts every world instantly; the agent gets ${Math.round(polishTimeoutMs / 1000)} s to edit it.
Each \`inbox/<requestId>-<attempt>.json\` has \`mode: "polish"\`, the complete \`draft\`, an \`edit\`
sheet of its player-facing text (pre-filled) and \`instructions\`. Write the sheet back with your
changes to \`reply.path\` (same keys and array positions; omit what you did not change), or a
full WorldRecipe. The server merges it over the draft, validates the whole recipe and compiles
it. Silence past the window ships the draft unchanged (never a fixture). The server only waits
while \`${OPERATOR_PRESENCE_FILE}\` in this directory has been touched within the last 20 s: keep touching
it while you are watching (\`node scripts/operator-watch.mjs\` does both).
`}
## Protocol (authoring mode)

1. The server drops \`inbox/<requestId>-<attempt>.json\` for every world request. It contains
   the players' real contributions, the runtime instructions, the closed registry of IDs and
   \`reply.path\`.
2. Author ONE WorldRecipe JSON object that follows \`instructions\` and
   \`world-recipe.schema.json\`, honouring the players' ideas, and write it to \`reply.path\`
   (\`outbox/<same file name>\`). Write nothing else there.
3. The server validates the reply (Zod schema, no markup/URLs/code), compiles it into rooms,
   and moves both files into \`done/\`. An invalid reply is retired and the request comes back
   as a new inbox file (attempt+1) with a \`repair\` message, as often as needed until the
   deadline. No accepted reply within ${Math.round(timeoutMs / 1000)} s of the first request
   serves a clearly labelled offline fixture instead.

Rules of thumb for the reply: exactly \`plannedRoomCount\` rooms; the last room lists
\`guardian\` in enemyIds and \`anchor_pedestal\` in propIds; use only registry IDs; map each
contribution at most once to a feature you actually placed; write the \`bible\` first and take
every name, date and number in the text from it; two relics per room plus one \`remains\` per
enemy kind used, each with \`authorIndex\` and \`eventIndex\`; keep text under the schema limits.
The server runs the prose linter (docs/WRITING.md) on a reply that has a bible: rejected lines
come back once as a \`repair\` message, and the better-scoring of the two replies is used.
A legacy reply without a bible is still accepted, unlinted.

Root: ${dir}
`;
}
