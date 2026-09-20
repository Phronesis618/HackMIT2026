#!/usr/bin/env node
/**
 * Operator presence + inbox watcher for RELAY_AI_PROVIDER=operator (see src/server/operator).
 *
 *   node scripts/operator-watch.mjs [operatorDir]      (default .relay/operator)
 *
 * While this runs it touches <dir>/PRESENT every 5 s, which is how the server knows an
 * operator is actually watching: in polish mode it waits for an edit only while that file is
 * fresh, and ships the composer's draft at once otherwise. For every new inbox file it prints
 * one AGENT_LOOP_WAKE_relay_operator line (a coding agent can watch stdout for that pattern) with
 * the request's mode, ideas, deadline and reply path. Nothing here reads or writes replies.
 */
import { readdirSync, readFileSync, writeFileSync, utimesSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? path.join('.relay', 'operator'));
const inbox = path.join(dir, 'inbox');
const presence = path.join(dir, 'PRESENT');
const seen = new Set();

function heartbeat() {
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(presence)) writeFileSync(presence, 'operator watcher heartbeat; mtime is what matters\n');
    const now = new Date();
    utimesSync(presence, now, now);
  } catch (error) {
    console.error(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function poll() {
  let names = [];
  try {
    names = readdirSync(inbox).filter((name) => name.endsWith('.json'));
  } catch {
    return; // inbox not created yet: the server writes it on its first request
  }
  for (const name of names) {
    if (seen.has(name)) continue;
    let request;
    try {
      request = JSON.parse(readFileSync(path.join(inbox, name), 'utf8'));
    } catch {
      continue; // partially written; next tick
    }
    seen.add(name);
    const ideas = (request.contributions ?? []).map((c) => `${c.playerName}: ${c.text}`);
    const secondsLeft = Math.max(0, Math.round((request.deadlineAt - Date.now()) / 1000));
    const summary = {
      prompt: request.mode === 'polish'
        ? `RELAY polish request ${name}: edit the composer draft "${request.draft?.title ?? '?'}" for the ideas ${JSON.stringify(ideas)} within ${secondsLeft}s. Read inbox/${name} (fields: instructions, edit, draft, repair), write the edited sheet (only changed fields, same positions) to ${request.reply?.path}.`
        : `RELAY world request ${name}: author ONE WorldRecipe for the ideas ${JSON.stringify(ideas)} per its instructions and ${path.join(dir, 'world-recipe.schema.json')} within ${secondsLeft}s, write it to ${request.reply?.path}.`,
      mode: request.mode ?? 'author',
      attempt: request.attempt,
      repair: request.repair ?? null,
      deadlineAt: new Date(request.deadlineAt).toISOString(),
    };
    console.log(`AGENT_LOOP_WAKE_relay_operator ${JSON.stringify(summary)}`);
  }
  // forget files the server has retired so a re-used name (tests) is not skipped
  for (const name of seen) if (!names.includes(name)) seen.delete(name);
}

console.log(`operator watcher: heartbeat ${presence} every 5 s; watching ${inbox}`);
heartbeat();
poll();
setInterval(heartbeat, 5_000);
setInterval(poll, 500);
