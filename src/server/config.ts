/**
 * Server-only configuration boundary.
 *
 * Secrets (OPENAI_API_KEY) are read here and ONLY here. Nothing in this module is
 * imported by client code; `describeForClient()` is the only shape that may leave the
 * process, and it never contains the key or the raw env.
 *
 * Missing credentials are normal: the server starts in fixture mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type GenerationMode = 'fixture' | 'live';

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  generation: {
    mode: GenerationMode;
    openaiApiKey: string | null;
    openaiModel: string;
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
  const requestedMode: GenerationMode = env.RELAY_GENERATION_MODE === 'live' ? 'live' : 'fixture';

  const staticDir = path.join(REPO_ROOT, 'dist', 'client');

  return {
    port: Number.isFinite(port) ? port : 8787,
    host,
    nodeEnv,
    generation: {
      mode: requestedMode,
      openaiApiKey: apiKey.length > 0 ? apiKey : null,
      openaiModel: (env.OPENAI_MODEL ?? '').trim() || 'unset',
    },
    staticDir: fs.existsSync(path.join(staticDir, 'index.html')) ? staticDir : null,
    fixturesDir: path.join(REPO_ROOT, 'fixtures', 'worlds'),
  };
}

/** Safe, non-secret subset for GET /api/config. */
export function describeForClient(config: ServerConfig): { generationMode: GenerationMode; liveGenerationAvailable: boolean } {
  return {
    generationMode: config.generation.mode,
    liveGenerationAvailable: config.generation.mode === 'live' && config.generation.openaiApiKey !== null,
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
