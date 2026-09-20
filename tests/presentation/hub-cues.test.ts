/**
 * Quartermaster cues: deterministic selection, once-per-run suppression, whitelist-only
 * interpolation, and every written line passing the prose linter as an `npcLine`.
 */
import { describe, expect, it } from 'vitest';
import { lintProse } from '../../src/shared/prose';
import {
  HUB_CUES, HUB_CUE_LINES, createCueSuppressor, cueEvidence, cueVariables, pickCue, renderCue, renderCueLine, templateVars,
  type HubCueContext,
} from '../../src/client/chronicle/hubCues';
import { createHubState, emptyRecords, type LastRun } from '../../src/client/chronicle/hubState';

function lastRun(overrides: Partial<LastRun> = {}): LastRun {
  return {
    worldId: 'world-a', worldTitle: 'Vantage Spire', outcome: 'anchored', classId: 'shade', endedAt: 1_758_300_100_000, durationMs: 4 * 60_000,
    roomsEntered: 3, deepestRoomIndex: 2, roomsCleared: 2, enemiesDefeated: 5, damageDealt: 120, damageTaken: 33, downs: 0,
    lastDownedByEnemyId: null, revivesGiven: 0, revivesReceived: 0, loreRead: 1, abilityUnlocked: null,
    crew: [{ id: 'local', displayName: 'Jon' }], worldSource: 'fixture', sourceEventIds: ['1:0', '2:0'],
    ...overrides,
  };
}

function context(run: LastRun | null, session: Partial<HubCueContext['session']> = {}): HubCueContext {
  const empty = createHubState();
  return {
    lastRun: run,
    records: emptyRecords(),
    totals: run ? { runs: 1, anchors: run.outcome === 'anchored' ? 1 : 0, worldsVisited: 1, relics: 0 } : empty.totals,
    session: { classId: 'shade', classChangedSinceLastRun: false, worldPrepared: false, crewSize: 1, ...session },
  };
}

describe('pickCue', () => {
  it('shows first_visit on a fresh device and fallback_idle once a world is charted', () => {
    expect(pickCue(HUB_CUES, context(null), new Set())?.id).toBe('first_visit');
    expect(pickCue(HUB_CUES, context(null, { worldPrepared: true }), new Set())?.id).toBe('fallback_idle');
  });

  it('anchored with zero downs → anchored_clean (scripted example)', () => {
    const ctx = context(lastRun());
    const cue = renderCue(ctx)!;
    expect(cue.id).toBe('anchored_clean');
    expect(cue.lines).toHaveLength(1);
    expect(cue.lines[0]).not.toMatch(/\{/);
    expect(cue.evidence).toContain('run_ended (anchored)');
    expect(cue.evidence).toContain('player_downed ×0');
  });

  it('collapsed, downed twice, last hit by a warden → downed_by names the warden (scripted example)', () => {
    const ctx = context(lastRun({ outcome: 'collapsed', downs: 2, lastDownedByEnemyId: 'warden' }));
    const cue = renderCue(ctx)!;
    expect(cue.id).toBe('downed_by');
    expect(cue.evidence).toBe('from: run_ended (collapsed) · player_downed ×2 · player_damaged.sourceEnemyId = warden · room_entered.roomIndex max 2 · 2 event ids');
    // Once downed_by has been shown for this run, the outcome cue takes over.
    expect(pickCue(HUB_CUES, ctx, new Set(['downed_by']))?.id).toBe('collapsed');
  });

  it('never guesses the killer: an unattributed down fires downed_unattributed', () => {
    const ctx = context(lastRun({ outcome: 'collapsed', downs: 1, lastDownedByEnemyId: null }));
    expect(pickCue(HUB_CUES, ctx, new Set())?.id).toBe('downed_unattributed');
    expect(cueEvidence(HUB_CUES.find((c) => c.id === 'downed_unattributed')!, ctx)).toContain('sourceEnemyId = null');
  });

  it('routes aborted and costly anchors, and is deterministic for the same state', () => {
    expect(pickCue(HUB_CUES, context(lastRun({ outcome: 'aborted' })), new Set())?.id).toBe('aborted');
    expect(pickCue(HUB_CUES, context(lastRun({ downs: 1, lastDownedByEnemyId: null })), new Set(['downed_unattributed']))?.id).toBe('anchored_costly');
    const ctx = context(lastRun({ endedAt: 1_758_300_100_007 }));
    const a = renderCue(ctx);
    const b = renderCue(ctx);
    expect(a).toEqual(b);
  });

  it('falls back to fallback_idle when everything else is suppressed', () => {
    const ctx = context(lastRun());
    expect(pickCue(HUB_CUES, ctx, new Set(HUB_CUES.map((c) => c.id)))?.id).toBe('fallback_idle');
  });
});

describe('cue suppression', () => {
  it('suppresses a shown cue for the run and clears when endedAt changes', () => {
    const suppressor = createCueSuppressor();
    const first = lastRun({ outcome: 'collapsed', downs: 2, lastDownedByEnemyId: 'warden' });
    expect(pickCue(HUB_CUES, context(first), suppressor.forRun(first))?.id).toBe('downed_by');
    suppressor.shown('downed_by');
    expect(pickCue(HUB_CUES, context(first), suppressor.forRun(first))?.id).toBe('collapsed');
    const second = { ...first, endedAt: first.endedAt + 1 };
    expect(pickCue(HUB_CUES, context(second), suppressor.forRun(second))?.id).toBe('downed_by');
    suppressor.shown('fallback_idle');
    expect(suppressor.forRun(second).has('fallback_idle')).toBe(false);
  });
});

describe('line templates', () => {
  it('has exactly three lines for each one-night cue and no cue without lines', () => {
    expect(HUB_CUES.map((c) => c.id).sort()).toEqual(
      ['aborted', 'anchored_clean', 'anchored_costly', 'collapsed', 'downed_by', 'downed_unattributed', 'fallback_idle', 'first_visit'],
    );
    for (const cue of HUB_CUES) expect(HUB_CUE_LINES[cue.id], cue.id).toHaveLength(3);
  });

  it('only interpolates variables in the cue whitelist (the mechanical honesty rule)', () => {
    for (const cue of HUB_CUES) {
      for (const line of HUB_CUE_LINES[cue.id]!) {
        for (const name of templateVars(line)) expect(cue.vars, `${cue.id}: {${name}}`).toContain(name);
      }
    }
    const aborted = HUB_CUES.find((c) => c.id === 'aborted')!;
    const rendered = renderCueLine(aborted, 'Room {deepestRoomIndex}, {enemyName}, {worldTitle}.', { deepestRoomIndex: '3', enemyName: 'Warden', worldTitle: 'Vantage Spire' });
    expect(rendered).toBe('Room 3, {enemyName}, Vantage Spire.');
  });

  it('every line passes lintProse as an npcLine with real values substituted', () => {
    const ctx = context(lastRun({ outcome: 'collapsed', downs: 2, lastDownedByEnemyId: 'warden', revivesReceived: 1, roomsCleared: 2 }));
    const vars = cueVariables(ctx);
    for (const cue of HUB_CUES) {
      for (const template of HUB_CUE_LINES[cue.id]!) {
        const line = renderCueLine(cue, template, vars);
        const result = lintProse(line, { kind: 'npcLine' });
        expect(!result.hardFail && result.score < 30, `${cue.id}: "${line}" → score ${result.score} ${result.issues.map((i) => `${i.rule}:${i.excerpt}`).join(', ')}`).toBe(true);
      }
    }
  });
});
