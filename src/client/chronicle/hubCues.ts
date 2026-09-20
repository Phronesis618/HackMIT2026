/**
 * Quartermaster cues — pure, deterministic, no randomness.
 *
 * A cue fires only on `HubCueContext`, which is reduced from real recorded events
 * (`hubState.ts`). Each line template may interpolate ONLY the variables in the cue's `vars`
 * whitelist; a unit test enforces that, and another runs every line through `lintProse`.
 * Lines follow docs/WRITING.md §5.15: one speaker who counts things and is mildly put out.
 */
import { ENEMY_INFO, type ClassId } from '../../shared/registry';
import type { ClassRecord, HubTotals, LastRun } from './hubState';

export interface HubCueContext {
  lastRun: LastRun | null;
  records: Record<ClassId, ClassRecord>;
  totals: HubTotals;
  session: { classId: ClassId; classChangedSinceLastRun: boolean; worldPrepared: boolean; crewSize: number };
}

export interface HubCue {
  /** Stable; used for once-per-run suppression. */
  id: string;
  /** Higher wins; ties broken by id, never by random. */
  priority: number;
  slots: 1 | 2;
  /** Pure predicate. MUST only read HubCueContext. */
  when(ctx: HubCueContext): boolean;
  /** The ONLY interpolation vars a line for this cue may use. */
  vars: readonly string[];
}

export const HUB_CUES: readonly HubCue[] = [
  { id: 'first_visit', priority: 10, slots: 1, vars: [], when: (ctx) => ctx.totals.runs === 0 && !ctx.session.worldPrepared },
  {
    id: 'downed_by', priority: 70, slots: 2, vars: ['enemyName', 'deepestRoomIndex', 'worldTitle', 'downs'],
    when: (ctx) => ctx.lastRun !== null && ctx.lastRun.downs > 0 && ctx.lastRun.lastDownedByEnemyId !== null,
  },
  {
    id: 'downed_unattributed', priority: 65, slots: 1, vars: ['deepestRoomIndex', 'downs'],
    when: (ctx) => ctx.lastRun !== null && ctx.lastRun.downs > 0 && ctx.lastRun.lastDownedByEnemyId === null,
  },
  {
    id: 'anchored_clean', priority: 80, slots: 2, vars: ['worldTitle', 'durationMin', 'damageTaken'],
    when: (ctx) => ctx.lastRun?.outcome === 'anchored' && ctx.lastRun.downs === 0,
  },
  {
    id: 'anchored_costly', priority: 75, slots: 2, vars: ['worldTitle', 'downs', 'revivesReceived'],
    when: (ctx) => ctx.lastRun?.outcome === 'anchored' && ctx.lastRun.downs > 0,
  },
  {
    id: 'collapsed', priority: 60, slots: 2, vars: ['worldTitle', 'deepestRoomIndex', 'roomsCleared'],
    when: (ctx) => ctx.lastRun?.outcome === 'collapsed',
  },
  {
    id: 'floors_collapsed', priority: 62, slots: 2, vars: ['worldTitle', 'deepestTier', 'biomesCleared'],
    when: (ctx) => ctx.lastRun?.outcome === 'collapsed' && ctx.lastRun.deepestTier >= 0,
  },
  { id: 'aborted', priority: 55, slots: 1, vars: ['worldTitle', 'deepestRoomIndex'], when: (ctx) => ctx.lastRun?.outcome === 'aborted' },
  {
    id: 'floors_aborted', priority: 57, slots: 1, vars: ['worldTitle', 'deepestTier'],
    when: (ctx) => ctx.lastRun?.outcome === 'aborted' && ctx.lastRun.deepestTier >= 0,
  },
  { id: 'fallback_idle', priority: 0, slots: 1, vars: [], when: () => true },
];

/** Three lines per cue. Written under docs/WRITING.md §5.15; every one lints as `npcLine`. */
export const HUB_CUE_LINES: Readonly<Record<string, readonly string[]>> = {
  first_visit: [
    'Nothing on the shelf yet. That is normal.',
    'Rack is on your left. Gate is behind me.',
    'You have not been anywhere. Go somewhere.',
  ],
  downed_by: [
    'A {enemyName} put you down in room {deepestRoomIndex} of {worldTitle}.',
    'Down {downs} times, the last one to a {enemyName}. Both are on your sheet.',
    '{enemyName}, room {deepestRoomIndex}. That is what the sheet says put you down.',
  ],
  downed_unattributed: [
    'Down {downs} times, and no creature on the sheet for any of them.',
    'Nothing on the sheet for room {deepestRoomIndex} but the floor. Check it before you stand on it.',
    'The room put you down {downs} times. It happens.',
  ],
  anchored_clean: [
    '{worldTitle} is anchored and you never went down. Log says {damageTaken} damage taken.',
    'Clean. {durationMin} minutes, no pickups needed.',
    'Anchored, no downs, {damageTaken} damage on the sheet. Do not make a habit of it.',
  ],
  anchored_costly: [
    '{worldTitle} holds. It cost you {downs} downs.',
    'Anchored. You were picked up {revivesReceived} times getting there.',
    '{worldTitle} is standing. You were not, {downs} times.',
  ],
  collapsed: [
    '{worldTitle} went down. You got to room {deepestRoomIndex}.',
    '{roomsCleared} rooms cleared before it folded. I have written that down.',
    '{worldTitle} collapsed with {roomsCleared} rooms cleared. Room {deepestRoomIndex} was as far as you got.',
  ],
  floors_collapsed: [
    '{worldTitle} went down at tier {deepestTier}. {biomesCleared} gates cleared before it.',
    'Tier {deepestTier} of {worldTitle}. The sheet says {biomesCleared} gatekeepers down.',
    '{worldTitle} folded. You were {biomesCleared} gates in.',
  ],
  aborted: [
    'You came back early from {worldTitle}. No anchor, no penalty either.',
    'Pulled out at room {deepestRoomIndex}. Leaving early is free.',
    'Aborted at room {deepestRoomIndex} of {worldTitle}. Logged as such.',
  ],
  floors_aborted: [
    'Pulled out of {worldTitle} at tier {deepestTier}. Logged.',
    'Tier {deepestTier}, then home. Nobody bills you for that.',
    'Aborted at tier {deepestTier} of {worldTitle}. No penalty for it.',
  ],
  fallback_idle: [
    'Rack is open. Gate is behind me.',
    'Nothing new to report.',
    'Take what you need. Sign for it.',
  ],
};

const FALLBACK_ID = 'fallback_idle';

export function pickCue(cues: readonly HubCue[], ctx: HubCueContext, suppressed: ReadonlySet<string>): HubCue | null {
  let best: HubCue | null = null;
  for (const cue of cues) {
    if (suppressed.has(cue.id) || !cue.when(ctx)) continue;
    if (!best || cue.priority > best.priority || (cue.priority === best.priority && cue.id < best.id)) best = cue;
  }
  if (best) return best;
  return cues.find((cue) => cue.id === FALLBACK_ID) ?? null;
}

/** Every `{var}` a template names. */
export function templateVars(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]!);
}

/** Variables derived from the context. Only values a cue whitelists are ever substituted. */
export function cueVariables(ctx: HubCueContext): Record<string, string> {
  const run = ctx.lastRun;
  if (!run) return {};
  return {
    worldTitle: run.worldTitle,
    enemyName: run.lastDownedByEnemyId ? ENEMY_INFO[run.lastDownedByEnemyId].name : '',
    deepestRoomIndex: String(run.deepestRoomIndex + 1),
    downs: String(run.downs),
    durationMin: String(Math.max(1, Math.round(run.durationMs / 60_000))),
    damageTaken: String(Math.round(run.damageTaken)),
    revivesReceived: String(run.revivesReceived),
    roomsCleared: String(run.roomsCleared),
    deepestTier: String(run.deepestTier + 1),
    biomesCleared: String(run.biomesCleared),
  };
}

/** Fill a template, refusing any variable outside the cue's whitelist (left as `{var}`). */
export function renderCueLine(cue: HubCue, template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    cue.vars.includes(name) && vars[name] !== undefined ? vars[name]! : whole);
}

/**
 * Pick the line for a cue deterministically: the same run always yields the same line,
 * runs differ by `endedAt`. `first_visit` / `fallback_idle` rotate on total runs instead.
 */
export function cueLineIndex(cue: HubCue, ctx: HubCueContext): number {
  const lines = HUB_CUE_LINES[cue.id] ?? [];
  if (lines.length === 0) return 0;
  const seed = ctx.lastRun ? ctx.lastRun.endedAt : ctx.totals.runs;
  return Math.abs(Math.floor(seed)) % lines.length;
}

/**
 * The evidence footer: exact event derivation for the shown line. Small mono text under
 * the line — the proof that nothing was invented.
 */
export function cueEvidence(cue: HubCue, ctx: HubCueContext): string {
  const run = ctx.lastRun;
  if (!run) {
    return cue.id === 'first_visit'
      ? `from: run_ended ×0 · world_prepared: ${ctx.session.worldPrepared ? 'yes' : 'none'} · device-local`
      : 'from: no run recorded on this device';
  }
  const parts = [`run_ended (${run.outcome})`];
  if (cue.vars.includes('downs') || cue.id === 'anchored_clean') parts.push(`player_downed ×${run.downs}`);
  if (cue.id === 'downed_by' && run.lastDownedByEnemyId) parts.push(`player_damaged.sourceEnemyId = ${run.lastDownedByEnemyId}`);
  if (cue.id === 'downed_unattributed') parts.push('player_damaged.sourceEnemyId = null');
  if (cue.vars.includes('deepestRoomIndex')) parts.push(`room_entered.roomIndex max ${run.deepestRoomIndex}`);
  if (cue.vars.includes('roomsCleared')) parts.push(`room_cleared ×${run.roomsCleared}`);
  if (cue.vars.includes('deepestTier')) parts.push(`biome_entered.tier max ${run.deepestTier}`);
  if (cue.vars.includes('biomesCleared')) parts.push(`room_cleared (exit rooms) ×${run.biomesCleared}`);
  if (cue.vars.includes('revivesReceived')) parts.push(`player_revived ×${run.revivesReceived}`);
  if (cue.vars.includes('damageTaken')) parts.push(`Σ player_damaged.amount = ${Math.round(run.damageTaken)}`);
  if (cue.vars.includes('durationMin')) parts.push(`timeMs span ${Math.round(run.durationMs / 1000)} s`);
  parts.push(`${run.sourceEventIds.length} event ids`);
  return `from: ${parts.join(' · ')}`;
}

export interface RenderedCue {
  id: string;
  lines: string[];
  evidence: string;
}

/** Everything the speech box and the station panel need, for one deterministic pick. */
export function renderCue(ctx: HubCueContext, suppressed: ReadonlySet<string> = new Set()): RenderedCue | null {
  const cue = pickCue(HUB_CUES, ctx, suppressed);
  if (!cue) return null;
  const templates = HUB_CUE_LINES[cue.id] ?? [];
  const template = templates[cueLineIndex(cue, ctx)];
  const lines = template ? [renderCueLine(cue, template, cueVariables(ctx))] : [];
  return { id: cue.id, lines, evidence: cueEvidence(cue, ctx) };
}

/**
 * Once-per-run suppression. A cue id is suppressed after it has been shown and the whole set
 * clears when `lastRun.endedAt` changes.
 */
export function createCueSuppressor() {
  const suppressed = new Set<string>();
  let endedAt: number | null = null;
  return {
    forRun(lastRun: LastRun | null): ReadonlySet<string> {
      const key = lastRun?.endedAt ?? null;
      if (key !== endedAt) {
        endedAt = key;
        suppressed.clear();
      }
      return suppressed;
    },
    shown(cueId: string): void {
      if (cueId !== FALLBACK_ID) suppressed.add(cueId);
    },
  };
}
