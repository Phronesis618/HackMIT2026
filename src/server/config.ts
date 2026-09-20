/**
 * Server-only configuration boundary.
 *
 * Provider API keys are read here and ONLY here. Nothing in this module is
 * imported by client code; `describeForClient()` is the only shape that may leave the
 * process, and it never contains the key or the raw env.
 *
 * Missing credentials are normal: the server starts in fixture mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type GenerationMode = 'fixture' | 'live';
/**
 * anthropic / openai — direct API providers (need a key).
 * composer          — no key: the offline composer builds a distinct, honestly-labelled
 *                     `procedural` world from the players' ideas in milliseconds
 *                     (src/server/composer). Also the fallback for every other provider.
 * operator          — DEMO ONLY: no key. Each request is written to an inbox directory and a
 *                     coding agent watching that directory (e.g. Cursor) writes the WorldRecipe
 *                     reply. See src/server/operator/provider.ts and docs/DEMO.md.
 */
export type AIProvider = 'anthropic' | 'openai' | 'composer' | 'operator';
const KEYLESS_PROVIDERS: ReadonlySet<string> = new Set(['composer', 'operator']);
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_OPERATOR_TIMEOUT_MS = 180_000;

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  generation: {
    mode: GenerationMode;
    provider: AIProvider;
    anthropicApiKey: string | null;
    anthropicModel: string;
    openaiApiKey: string | null;
    openaiModel: string;
    /** Inbox/outbox root for the `operator` provider. */
    operatorDir: string;
    /** How long the `operator` provider waits for a reply before the labelled fixture fallback. */
    operatorTimeoutMs: number;
    /** RELAY_FLOORS=1: worlds are floors worlds unless a request says `floors: false`. Default off. */
    floors: boolean;
    /** RELAY_LAWS=1: derive laws + a look for worlds whose recipe has none. Default off. */
    laws: boolean;
  };
  /** Absolute path to the production client bundle, or null if not built. */
  staticDir: string | null;
  /** Absolute path to fixtures/worlds. */
  fixturesDir: string;
}

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Minimal .env loader (KEY=VALUE, # comments, optional quotes). Never overrides real env. */
export function loadDotEnv(file = path.join(REPO_ROOT, '.env'), env: NodeJS.ProcessEnv = process.env): void {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** CLI overrides, e.g. `--host 0.0.0.0 --port 9000`. */
  argv?: string[];
}

export function loadServerConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const args = parseArgs(options.argv ?? process.argv.slice(2));

  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const port = Number(args.port ?? env.PORT ?? 8787);
  const host = args.host ?? env.HOST ?? (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');

  const apiKey = (env.OPENAI_API_KEY ?? '').trim();
  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  const provider = (env.RELAY_AI_PROVIDER ?? '').trim() || (anthropicApiKey ? 'anthropic' : 'openai');
  if (provider !== 'anthropic' && provider !== 'openai' && provider !== 'composer' && provider !== 'operator') {
    throw new Error('RELAY_AI_PROVIDER must be anthropic, openai, composer or operator.');
  }
  const requestedMode: GenerationMode = env.RELAY_GENERATION_MODE === 'live' ? 'live' : 'fixture';
  const operatorTimeoutMs = Number((env.RELAY_OPERATOR_TIMEOUT_MS ?? '').trim());

  const staticDir = path.join(REPO_ROOT, 'dist', 'client');

  return {
    port: Number.isFinite(port) ? port : 8787,
    host,
    nodeEnv,
    generation: {
      mode: requestedMode,
      provider,
      anthropicApiKey: anthropicApiKey || null,
      anthropicModel: (env.ANTHROPIC_MODEL ?? '').trim() || DEFAULT_ANTHROPIC_MODEL,
      openaiApiKey: apiKey.length > 0 ? apiKey : null,
      openaiModel: (env.OPENAI_MODEL ?? '').trim() || 'gpt-5-mini',
      operatorDir: path.resolve(REPO_ROOT, (env.RELAY_OPERATOR_DIR ?? '').trim() || path.join('.relay', 'operator')),
      operatorTimeoutMs: Number.isFinite(operatorTimeoutMs) && operatorTimeoutMs > 0 ? operatorTimeoutMs : DEFAULT_OPERATOR_TIMEOUT_MS,
      floors: ['1', 'true'].includes((env.RELAY_FLOORS ?? '').trim().toLowerCase()),
      laws: ['1', 'true'].includes((env.RELAY_LAWS ?? '').trim().toLowerCase()),
    },
    staticDir: fs.existsSync(path.join(staticDir, 'index.html')) ? staticDir : null,
    fixturesDir: path.join(REPO_ROOT, 'fixtures', 'worlds'),
  };
}

/**
 * Safe, non-secret subset for GET /api/config.
 *
 * `floors` and `laws` are here so the SERVER decides them for every client in the session:
 * a crew must not play one game while half their screens draw another (see src/shared/flags.ts).
 */
export function describeForClient(config: ServerConfig): {
  generationMode: GenerationMode; liveGenerationAvailable: boolean; floors: boolean; laws: boolean;
} {
  const { provider, anthropicApiKey, openaiApiKey } = config.generation;
  const apiKey = provider === 'anthropic' ? anthropicApiKey : openaiApiKey;
  return {
    generationMode: config.generation.mode,
    // In live mode a world is always generated from the crew's ideas: by the selected API model
    // when its key is present, otherwise by the offline composer (see app.ts). Keyless API
    // providers are therefore still 'available'; the provenance label says which one built it.
    liveGenerationAvailable: config.generation.mode === 'live' && (KEYLESS_PROVIDERS.has(provider) || Boolean(apiKey?.trim()) || provider === 'anthropic' || provider === 'openai'),
    floors: config.generation.floors,
    laws: config.generation.laws,
  };
}

function parseArgs(argv: string[]): { host?: string; port?: string } {
  const out: { host?: string; port?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--host' && argv[i + 1]) out.host = argv[++i];
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a === '--port' && argv[i + 1]) out.port = argv[++i];
    else if (a.startsWith('--port=')) out.port = a.slice('--port='.length);
  }
  return out;
}
