#!/usr/bin/env node
/**
 * check-docker-context.mjs — does the production image actually contain every file
 * the server reads at runtime?
 *
 * The bug class this exists for: `Dockerfile` copies a hand-written subset of the repo
 * into the runtime stage. `npm run build`, `npm test` and `npm start` all run against the
 * full working tree, so a server module that reads `prompts/exemplars/` passes every local
 * gate and then throws ENOENT in the container — where, because generation falls back to a
 * fixture world on error, it shows up as "live mode is on but every world is canned"
 * rather than as a crash. Nothing else in the repo notices.
 *
 * How it works, in two halves:
 *   1. Parse the Dockerfile's FINAL stage COPY instructions into the set of paths that
 *      exist inside the image (relative to WORKDIR).
 *   2. Walk the server's import graph from src/server/index.ts through anything under
 *      src/, and pull out the repo-relative paths it reads from disk:
 *        - new URL('../../x', import.meta.url)      (incl. `${...}` templates: static prefix)
 *        - path.join/resolve(REPO_ROOT, 'a', 'b')
 *      plus a floor of known runtime data dirs, so a refactor that moves a read behind a
 *      helper cannot silently drop coverage.
 *
 * Exits 0 when every required read is inside the image, non-zero with the offending paths
 * otherwise. Deliberately pragmatic: only literal, statically-resolvable paths are checked,
 * and paths the server creates or treats as optional are listed in OPTIONAL below.
 *
 * Usage: node scripts/check-docker-context.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const VERBOSE = process.argv.includes('--verbose');
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

/**
 * Paths the server may reference that the image is not expected to contain.
 * Each needs a reason — this list is the only way to silence the check.
 */
const OPTIONAL = new Map([
  ['.env', 'Secrets come from Render env vars; loadDotEnv() returns early when absent.'],
  ['.relay', 'Operator-mode scratch dir, created by the server at runtime (demo only).'],
  ['.relay/operator', 'Operator-mode scratch dir, created by the server at runtime (demo only).'],
]);

/** Runtime data the server reads no matter how the code is refactored. */
const KNOWN_RUNTIME_DIRS = [
  'prompts/runtime',   // staged prompt text (generation/prompt.ts)
  'prompts/exemplars', // house-style exemplar bank (generation/exemplars.ts)
  'fixtures/worlds',   // offline + fallback worlds (generation/fixtureService.ts)
  'dist/client',       // built client the Node server serves itself (config.ts staticDir)
];

// ---------------------------------------------------------------- Dockerfile

/** Logical lines of a Dockerfile, with backslash continuations joined and comments dropped. */
function dockerfileLines(text) {
  const out = [];
  let buf = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!buf && /^\s*(#|$)/.test(line)) continue;
    if (line.endsWith('\\')) { buf += line.slice(0, -1) + ' '; continue; }
    out.push((buf + line).trim());
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** Strip the WORKDIR prefix off a COPY source so it reads as a repo-relative path. */
const stripWork = (p, workdir) => {
  const clean = p.replace(/^\.\//, '');
  const w = workdir.replace(/^\/|\/$/g, '');
  return w && clean.startsWith(`/${w}/`) ? clean.slice(w.length + 2) : clean.replace(/^\//, '');
};

/**
 * Paths present in the image's final stage, relative to its WORKDIR.
 * Returns { present:Set<string>, stageCount:number }.
 */
function imageContents(dockerfilePath) {
  const lines = dockerfileLines(fs.readFileSync(dockerfilePath, 'utf8'));

  // Split into stages; only the last FROM survives into the shipped image.
  const stages = [];
  for (const line of lines) {
    if (/^FROM\s/i.test(line)) stages.push({ workdir: '/', copies: [] });
    else if (stages.length) {
      const wd = line.match(/^WORKDIR\s+(\S+)/i);
      if (wd) stages[stages.length - 1].workdir = wd[1];
      else if (/^COPY\s/i.test(line)) stages[stages.length - 1].copies.push(line);
    }
  }
  if (!stages.length) throw new Error(`No FROM instruction found in ${rel(dockerfilePath)}`);

  const final = stages[stages.length - 1];
  const present = new Set();

  for (const line of final.copies) {
    // Drop `COPY` and every --flag=value (--from, --chown, --link, ...).
    const args = line.split(/\s+/).slice(1).filter((a) => !a.startsWith('--'));
    if (args.length < 2) continue;
    const dest = args[args.length - 1];
    const sources = args.slice(0, -1);

    // A dest ending in `/` (or `.`/`./`) is a directory: each source lands under it by
    // basename. Otherwise it is a rename of a single source.
    const destIsDir = /[/]$/.test(dest) || dest === '.' || dest === './' || sources.length > 1;
    const destBase = stripWork(dest.replace(/\/$/, '') || '.', final.workdir);

    for (const src of sources) {
      const srcPath = stripWork(src, final.workdir);
      const landed = destIsDir
        ? path.posix.join(destBase === '.' ? '' : destBase, path.posix.basename(srcPath))
        : destBase;
      if (landed && landed !== '.') present.add(landed.replace(/^\.\//, ''));
    }
  }
  return { present, stageCount: stages.length };
}

/** True when `p`, or any ancestor directory of it, was copied into the image. */
function covered(p, present) {
  const parts = p.split('/').filter(Boolean);
  for (let i = parts.length; i > 0; i--) if (present.has(parts.slice(0, i).join('/'))) return true;
  return false;
}

// ---------------------------------------------------- server import graph

const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

function resolveImport(spec, fromFile) {
  if (!spec.startsWith('.')) return null; // bare package or node: builtin
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of EXTS) {
    const candidate = base.replace(/\.(ts|tsx|js|mjs)$/, '') + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/** Every file under src/ reachable from the server entrypoints. */
function serverGraph(entries) {
  const seen = new Set();
  const queue = entries.filter((e) => fs.existsSync(e));
  const srcDir = path.join(REPO_ROOT, 'src');
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !file.startsWith(srcDir)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const next = resolveImport(m[1], file);
      if (next) queue.push(next);
    }
  }
  return [...seen].sort();
}

// ------------------------------------------------------------ path extraction

/** Take the statically-known part of a template literal: everything before the first `${`. */
const staticPrefix = (raw) => {
  const cut = raw.indexOf('${');
  return cut === -1 ? raw : path.posix.dirname(raw.slice(0, cut) + 'x');
};

/** Repo-relative paths that `file` reads from disk, as [path, evidence] pairs. */
function readsIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = new Map();
  const dir = path.dirname(file);
  const note = (p, evidence) => {
    const norm = p.replace(/\/+$/, '').replace(/^\.\//, '');
    if (!norm || norm.startsWith('..')) return; // outside the repo: not ours to check
    if (!found.has(norm)) found.set(norm, `${rel(file)}: ${evidence}`);
  };

  // new URL('../../x/y', import.meta.url) — including `${}` templates.
  for (const m of text.matchAll(/new URL\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*import\.meta\.url\s*\)/g)) {
    const raw = m[1] === '`' ? staticPrefix(m[2]) : m[2];
    if (!raw.startsWith('.') && !raw.startsWith('/')) continue; // http(s), data:, bare
    note(rel(path.resolve(dir, raw)), m[0].replace(/\s+/g, ' ').slice(0, 90));
  }

  // path.join(REPO_ROOT, 'a', 'b') / path.resolve(REPO_ROOT, 'a')
  for (const m of text.matchAll(/path\.(?:join|resolve)\(\s*REPO_ROOT\s*,\s*([^)]*)\)/g)) {
    const segs = [];
    for (const piece of m[1].split(',')) {
      const lit = piece.trim().match(/^(['"])((?:\\.|(?!\1).)*)\1$/);
      if (!lit) break; // stop at the first dynamic segment; the static prefix is what we check
      segs.push(lit[2]);
    }
    if (segs.length) note(path.posix.join(...segs), m[0].replace(/\s+/g, ' ').slice(0, 90));
  }

  return found;
}

// ------------------------------------------------------------------- main

function main() {
  const dockerfile = path.join(REPO_ROOT, 'Dockerfile');
  if (!fs.existsSync(dockerfile)) {
    console.error(`check-docker-context: no Dockerfile at ${rel(dockerfile)}`);
    process.exit(2);
  }

  const { present, stageCount } = imageContents(dockerfile);
  if (!present.size) {
    console.error('check-docker-context: parsed no COPY destinations out of the final Dockerfile stage.');
    process.exit(2);
  }

  const entries = [
    path.join(REPO_ROOT, 'src/server/index.ts'),
    path.join(REPO_ROOT, 'src/server/app.ts'),
  ];
  const files = serverGraph(entries);
  if (!files.length) {
    console.error('check-docker-context: could not resolve the server import graph (src/server/index.ts missing?).');
    process.exit(2);
  }

  /** path -> evidence string */
  const required = new Map();
  for (const f of files) for (const [p, evidence] of readsIn(f)) if (!required.has(p)) required.set(p, evidence);
  for (const d of KNOWN_RUNTIME_DIRS) if (!required.has(d)) required.set(d, 'known runtime data directory');

  const missing = [];
  const skipped = [];
  for (const [p, evidence] of [...required].sort()) {
    const optionalKey = [...OPTIONAL.keys()].find((k) => p === k || p.startsWith(`${k}/`));
    if (optionalKey) { skipped.push([p, OPTIONAL.get(optionalKey)]); continue; }
    if (!covered(p, present)) missing.push([p, evidence]);
  }

  if (VERBOSE) {
    console.log(`Dockerfile: ${stageCount} stage(s); final stage ships:`);
    for (const p of [...present].sort()) console.log(`  + ${p}`);
    console.log(`Scanned ${files.length} server module(s); ${required.size} runtime path(s) considered.`);
    for (const [p, why] of skipped) console.log(`  ~ ${p} (optional: ${why})`);
  }

  if (missing.length) {
    console.error('');
    console.error('check-docker-context: FAIL — the production image would not contain these runtime paths:');
    console.error('');
    for (const [p, evidence] of missing) {
      console.error(`  MISSING  ${p}`);
      console.error(`           read by ${evidence}`);
    }
    console.error('');
    console.error('The server reads them from disk, but no COPY in the Dockerfile\'s final stage puts');
    console.error('them in the image. Local `npm start` works because it runs against the whole repo;');
    console.error('the container will throw ENOENT. Add a COPY line to the final stage, e.g.:');
    console.error('');
    for (const [p] of missing) console.error(`  COPY --from=build --chown=node:node /app/${p} ./${p}`);
    console.error('');
    console.error('(If a path is genuinely optional or created at runtime, add it to OPTIONAL in');
    console.error(` ${rel(fileURLToPath(import.meta.url))} with a reason.)`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `check-docker-context: OK — ${required.size} runtime path(s) read by ${files.length} server module(s) ` +
    `are all inside the Docker COPY set (${[...present].sort().join(', ')}).`,
  );
  process.exit(0);
}

main();
