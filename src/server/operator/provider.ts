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
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { WorldRecipeSchema, type GenerationRequest, type WorldRecipe } from '../../shared/contracts';
import { ENEMY_IDS, MOTIF_IDS, PROP_IDS } from '../../shared/registry';
import { GenerationFailure, type RecipeProvider } from '../generation/provider';

/** Shown in provenance labels: "LIVE · cursor-agent". */
export const OPERATOR_MODEL = 'cursor-agent';
const MAX_REPLY_BYTES = 256 * 1024;
const INVALID_JSON_GRACE_POLLS = 5;

export interface OperatorProviderOptions {
  /** Root directory; inbox/outbox/done are created inside it. */
  dir: string;
  /** Deadline for a reply before the labelled fixture fallback. Default 180 s. */
  timeoutMs?: number;
  /** Outbox poll interval. Default 400 ms. */
  pollMs?: number;
  log?: (message: string) => void;
  now?: () => number;
}

/** Exact shape of an inbox file (also documented in <dir>/README.md for the agent). */
export interface OperatorRequestFile {
  kind: 'relay_operator_request';
  requestId: string;
  sessionId: string;
  attempt: number;
  plannedRoomCount: number;
  createdAt: number;
  deadlineAt: number;
  contributions: Array<{ id: string; playerName: string; text: string }>;
  /** Validation feedback from the previous attempt, or null on the first attempt. */
  repair: string | null;
  registry: { motifIds: string[]; propIds: string[]; enemyIds: string[] };
  /** The same runtime instructions an API model receives (prompts/runtime/world-recipe.md). */
  instructions: string;
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
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number>();
  const waiting = new Set<string>();
  let protocolWritten = false;

  const instructions = fs.readFileSync(new URL('../../../prompts/runtime/world-recipe.md', import.meta.url), 'utf8')
    .replace('{{registry}}', JSON.stringify({ motifIds: MOTIF_IDS, propIds: PROP_IDS, enemyIds: ENEMY_IDS }));

  function ensureLayout(): void {
    for (const d of [inboxDir, outboxDir, doneDir]) fs.mkdirSync(d, { recursive: true });
    if (protocolWritten) return;
    protocolWritten = true;
    atomicWrite(path.join(dir, 'world-recipe.schema.json'), JSON.stringify(z.toJSONSchema(WorldRecipeSchema, { target: 'draft-7' }), null, 2));
    atomicWrite(path.join(dir, 'README.md'), protocolReadme(dir, timeoutMs));
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

  return {
    dir, inboxDir, outboxDir, doneDir,
    pending: () => [...waiting],
    async generate(request: GenerationRequest, repair?: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      ensureLayout();
      const createdAt = now();
      const deadlineAt = createdAt + timeoutMs;
      let feedback: string | null = repair ?? null;
      // Unlike an API model, the operator can be corrected cheaply: every invalid reply is
      // retired and the request is re-issued (attempt+1, with the validation message as
      // `repair`) until the single deadline passes. The caller sees one attempt.
      while (true) {
        const attempt = (attempts.get(request.requestId) ?? 0) + 1;
        attempts.set(request.requestId, attempt);
        const name = `${request.requestId.replace(/[^A-Za-z0-9_-]/g, '_')}-${attempt}.json`;
        const inboxPath = path.join(inboxDir, name);
        const outboxPath = path.join(outboxDir, name);
        const file: OperatorRequestFile = {
          kind: 'relay_operator_request',
          requestId: request.requestId,
          sessionId: request.sessionId,
          attempt,
          plannedRoomCount: request.plannedRoomCount,
          createdAt,
          deadlineAt,
          contributions: request.contributions.map(({ id, playerName, text }) => ({ id, playerName, text })),
          repair: feedback,
          registry: { motifIds: [...MOTIF_IDS], propIds: [...PROP_IDS], enemyIds: [...ENEMY_IDS] },
          instructions,
          reply: {
            path: outboxPath,
            format: 'Write exactly one WorldRecipe JSON object (see ../world-recipe.schema.json) to reply.path. Nothing else.',
          },
        };
        try {
          if (fs.existsSync(outboxPath)) fs.rmSync(outboxPath, { force: true });
          atomicWrite(inboxPath, JSON.stringify(file, null, 2));
        } catch (error) {
          throw new GenerationFailure(`Operator inbox is not writable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
        }
        waiting.add(name);
        const remaining = Math.max(0, Math.round((deadlineAt - now()) / 1000));
        log(`operator: waiting up to ${remaining}s for ${outboxPath} (${request.contributions.length} idea(s)${feedback ? ', repair' : ''})`);
        let outcome = 'failed';
        try {
          const raw = await waitForReply(outboxPath, deadlineAt, signal);
          const parsed = WorldRecipeSchema.safeParse(raw);
          if (!parsed.success) {
            const issues = parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
            throw new GenerationFailure(`Recipe failed schema validation at ${issues}.`.slice(0, 200), true);
          }
          assertDisplayText(parsed.data);
          outcome = 'accepted';
          log(`operator: accepted "${parsed.data.title}" after ${Math.round((now() - createdAt) / 1000)}s (attempt ${attempt})`);
          return { recipe: parsed.data };
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

/** Same guard as the API providers: display text must never contain markup, URLs or code. */
function assertDisplayText(recipe: WorldRecipe): void {
  const text = [
    recipe.title, recipe.tagline, recipe.themeSummary,
    ...recipe.rooms.flatMap((room) => [room.name, room.description]),
    ...recipe.contributionMappings.map((mapping) => mapping.featureDescription),
    ...recipe.lore.flatMap((fragment) => [fragment.title, fragment.source, fragment.text]),
  ];
  if (text.some((value) => /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i.test(value))) {
    throw new GenerationFailure('Recipe text contained markup, a URL, or code.', true);
  }
}

function atomicWrite(file: string, contents: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function protocolReadme(dir: string, timeoutMs: number): string {
  return `# RELAY operator inbox (demo-only generation transport)

This directory is written by the RELAY server when \`RELAY_AI_PROVIDER=operator\`.
A coding agent watching it plays the role of the world-generation model.

## Protocol

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
contribution at most once to a feature you actually placed; 6–10 lore fragments including one
\`remains\` per enemy kind used; keep text under the schema limits.

Root: ${dir}
`;
}
