#!/usr/bin/env node
/**
 * ui-matrix.mjs — batch screenshot harness for the final UI audit (agent U2a).
 *
 * Reuses ONE Chromium instance across many shots (shot.mjs relaunches per call), runs them
 * with a small concurrency, and takes its shot list from a JSON file so a whole coverage
 * matrix is one command. Playwright is loaded exactly the way scripts/shot.mjs does it
 * (isolated temp install, no repo dependency).
 *
 *   node scripts/ui-matrix.mjs --plan /tmp/plan.json --base http://localhost:7073 --out-dir /tmp/shots
 *
 * Plan format: [{ name, url, width, height, wait?, keys?, click?, eval?, waitFor? }, ...]
 *  - `eval` is a string of JS run in the page after `keys` (a story harness: it may poke the
 *    UI store via the `__relayUi` dev handle, which only exists in dev builds).
 *  - `waitFor` is a CSS selector to wait for before shooting.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPS_DIR = '/tmp/relay-shot-deps';
const PLAYWRIGHT_SPEC = 'playwright@1.61';
const CHROMIUM_ARGS = [
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
];

function execInherit(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on('error', reject);
  });
}

async function ensurePlaywright() {
  const pkgDir = path.join(DEPS_DIR, 'node_modules', 'playwright');
  if (!fs.existsSync(pkgDir)) {
    await fs.promises.mkdir(DEPS_DIR, { recursive: true });
    const pkgJson = path.join(DEPS_DIR, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      await fs.promises.writeFile(pkgJson, JSON.stringify({ name: 'relay-shot-deps', private: true, version: '0.0.0' }));
    }
    await execInherit('npm', ['install', PLAYWRIGHT_SPEC, '--no-audit', '--no-fund'], { cwd: DEPS_DIR });
  }
  const marker = path.join(DEPS_DIR, '.chromium-installed');
  if (!fs.existsSync(marker)) {
    await execInherit('npx', ['-y', PLAYWRIGHT_SPEC, 'install', 'chromium'], { cwd: DEPS_DIR });
    await fs.promises.writeFile(marker, new Date().toISOString());
  }
  return createRequire(path.join(DEPS_DIR, 'package.json'))('playwright');
}

const KEY_ALIASES = {
  shift: 'Shift', space: 'Space', tab: 'Tab', esc: 'Escape', escape: 'Escape', enter: 'Enter',
  ctrl: 'Control', control: 'Control', alt: 'Alt', up: 'ArrowUp', down: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', backspace: 'Backspace',
};
function normalizeKey(raw) {
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  return raw.length === 1 ? raw.toLowerCase() : raw;
}

async function runKeys(page, spec) {
  const stage = page.locator('.stage');
  await stage.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  await stage.focus().catch(() => {});
  for (const token of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = token.indexOf(':');
    const name = idx === -1 ? token : token.slice(0, idx);
    const msRaw = idx === -1 ? null : token.slice(idx + 1);
    if (name.toLowerCase() === 'wait') {
      await page.waitForTimeout(Number(msRaw) || 500);
      continue;
    }
    if (name.toLowerCase() === 'type') {
      await page.keyboard.type(msRaw ?? '');
      continue;
    }
    const key = normalizeKey(name);
    await page.keyboard.down(key);
    await page.waitForTimeout(msRaw !== null ? Number(msRaw) || 150 : 90);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
  }
}

async function shoot(browser, base, outDir, spec, errors) {
  const width = spec.width ?? 1440;
  const height = spec.height ?? 900;
  const out = path.join(outDir, `${spec.name}.png`);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    const url = /^https?:/.test(spec.url) ? spec.url : `${base}${spec.url.startsWith('/') ? '' : '/'}${spec.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.stage canvas', { timeout: 20000 }).catch(() => {
      pageErrors.push('canvas never appeared');
    });
    await page.waitForTimeout(spec.wait ?? 2200);
    if (spec.keys) await runKeys(page, spec.keys);
    if (spec.eval) await page.evaluate(spec.eval).catch((e) => pageErrors.push(`eval: ${e.message}`));
    if (spec.click) {
      const [cx, cy] = String(spec.click).split(',').map(Number);
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(250);
    }
    if (spec.clickSel) {
      await page.locator(spec.clickSel).first().click({ timeout: 5000 }).catch((e) => pageErrors.push(`clickSel ${spec.clickSel}: ${e.message}`));
      await page.waitForTimeout(spec.afterClickWait ?? 500);
    }
    if (spec.keys2) await runKeys(page, spec.keys2);
    if (spec.waitFor) {
      await page.waitForSelector(spec.waitFor, { timeout: 8000 }).catch(() => pageErrors.push(`waitFor ${spec.waitFor} missed`));
    }
    if (spec.settle) await page.waitForTimeout(spec.settle);
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: !!spec.fullPage });
    if (spec.probe) {
      const result = await page.evaluate(spec.probe).catch((e) => ({ probeError: e.message }));
      await fs.promises.writeFile(out.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
    }
    console.error(`[ui-matrix] ok  ${spec.name}${pageErrors.length ? `  (${pageErrors.length} console errors)` : ''}`);
  } catch (err) {
    pageErrors.push(`FATAL ${err.message}`);
    console.error(`[ui-matrix] ERR ${spec.name}: ${err.message}`);
  } finally {
    if (pageErrors.length) errors[spec.name] = pageErrors.slice(0, 8);
    await context.close().catch(() => {});
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i === -1 ? dflt : argv[i + 1];
  };
  const planPath = get('--plan');
  const base = get('--base', 'http://localhost:7073');
  const outDir = get('--out-dir', '/tmp/relay-shots/u2/round');
  const concurrency = Number(get('--concurrency', '4'));
  const only = get('--only', null);
  if (!planPath) throw new Error('--plan <file.json> required');

  let plan = JSON.parse(await fs.promises.readFile(planPath, 'utf8'));
  if (only) {
    const names = only.split(',');
    plan = plan.filter((s) => names.some((n) => s.name.includes(n)));
  }
  await fs.promises.mkdir(outDir, { recursive: true });

  const playwright = await ensurePlaywright();
  const browser = await playwright.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const errors = {};
  try {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, plan.length) }, async () => {
      while (cursor < plan.length) {
        const spec = plan[cursor++];
        await shoot(browser, base, outDir, spec, errors);
      }
    });
    await Promise.all(workers);
  } finally {
    await browser.close();
  }
  await fs.promises.writeFile(path.join(outDir, '_console-errors.json'), JSON.stringify(errors, null, 2));
  console.error(`[ui-matrix] ${plan.length} shots -> ${outDir}`);
  if (Object.keys(errors).length) console.error(`[ui-matrix] console errors in: ${Object.keys(errors).join(', ')}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[ui-matrix] FATAL:', err.stack || err.message);
  process.exit(1);
});
