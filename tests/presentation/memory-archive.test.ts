import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createFieldReport, filterMemories, memoryWorlds } from '../../src/client/chronicle/memoryArchive';
import { createMemorySeed, memorySeedBlockReason, validMemorySeed, type MemorySeedContext } from '../../src/client/chronicle/memorySeeds';
import { MemorySeedComposer } from '../../src/client/ui/MemorySeedComposer';
import { MemoryWall } from '../../src/client/ui/MemoryWall';
import { ContributionText, IDLE_GENERATION_STATUS, type MemoryRecord } from '../../src/shared/contracts';
import { samplePlayers } from '../../src/shared/samples';
import type { UiActions } from '../../src/shared/ui';

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'memory-a', kind: 'arrival_keepsake', worldId: 'world-a', worldTitle: 'The Flooded Archive',
    roomIndex: 0, createdAt: 1000, participants: [{ id: 'player-a', displayName: 'Aster' }],
    title: 'First light', summary: 'Aster arrived in the flooded archive.',
    sourceEventIds: ['world-a:1'], provenanceSource: 'fixture', ...overrides,
  };
}

function context(): MemorySeedContext {
  return {
    phase: 'headquarters', connection: { mode: 'local', status: 'connected' },
    generation: IDLE_GENERATION_STATUS, contributions: [], liveGenerationAvailable: false,
    localPlayer: { ...samplePlayers[0]!, isLocal: true },
  };
}

function actions(): UiActions {
  return {
    setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
    enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(),
  };
}

const emptyFilters = { query: '', worldId: '', kind: '' };

describe('memory archive', () => {
  it('combines normalized search terms across recorded fields with world and kind filters', () => {
    const records = [
      record(),
      record({ id: 'memory-b', kind: 'milestone' }),
      record({ id: 'memory-c', worldId: 'world-b' }),
    ];
    expect(filterMemories(records, { query: '  ＡＳＴＥＲ \n fixture  LIGHT ', worldId: 'world-a', kind: 'arrival_keepsake' }).map((item) => item.id)).toEqual(['memory-a']);
    expect(filterMemories(records, { ...emptyFilters, query: 'arrival flooded' })).toHaveLength(2);
    expect(filterMemories(records, { ...emptyFilters, query: 'invented victory' })).toEqual([]);
    expect(filterMemories(records, { ...emptyFilters, worldId: 'absent-world' })).toEqual([]);
  });

  it('sorts deterministically without modifying the original records or array', () => {
    const records = Object.freeze([
      Object.freeze(record({ id: 'z', createdAt: 2000 })),
      Object.freeze(record({ id: 'old', createdAt: 1000 })),
      Object.freeze(record({ id: 'a', createdAt: 2000 })),
    ]);
    expect(filterMemories(records, emptyFilters).map((item) => item.id)).toEqual(['a', 'z', 'old']);
    expect(records.map((item) => item.id)).toEqual(['z', 'old', 'a']);
  });

  it('keeps distinct worlds with the same title and deduplicates by world ID', () => {
    expect(memoryWorlds([
      record(), record({ id: 'second', worldId: 'world-b' }),
      record({ id: 'newer', createdAt: 2000, worldTitle: 'Latest recorded title' }),
    ])).toEqual([
      { id: 'world-a', title: 'Latest recorded title' },
      { id: 'world-b', title: 'The Flooded Archive' },
    ]);
  });

  it('exports only matching real records, oldest first, with evidence and provenance', () => {
    const records = [
      record({ id: 'later', createdAt: 2000, provenanceSource: 'live_fallback_fixture', sourceEventIds: ['world-a:2', 'world-a:3'] }),
      record({ provenanceSource: 'live' }),
      record({ id: 'excluded', worldId: 'elsewhere', title: 'Not in report' }),
    ];
    const report = createFieldReport(filterMemories(records, { ...emptyFilters, worldId: 'world-a' }));
    expect(report).toContain('2 saved records from this browser.');
    expect(report).toContain('Source: Live generation');
    expect(report).toContain('Source: Fallback fixture');
    expect(report).toContain('Evidence: world-a:2, world-a:3');
    expect(report).toContain('World: The Flooded Archive (world-a)');
    expect(report).toContain('Participants: Aster');
    expect(report).toContain('Recorded: 1970-01-01T00:00:01.000Z');
    expect(report).toContain(records[0]!.summary);
    expect(report).not.toContain('Not in report');
    expect(report.indexOf('Record: memory-a')).toBeLessThan(report.indexOf('Record: later'));
    expect(report).toContain('Missing records do not establish an outcome.');
    expect(report).toContain('They do not prove that ideas shaped a generated world.');
    expect(report).toContain('cannot restore game progress');
  });

  it('reports an empty archive without inventing an expedition', () => {
    expect(createFieldReport([])).toContain('0 saved records');
    expect(createFieldReport([])).not.toContain('Evidence:');
  });

  it('renders saved evidence as text and limits large archives without hiding their size', () => {
    const records = Array.from({ length: 25 }, (_, index) => record({
      id: `record-${index}`, createdAt: index, summary: '<script>alert("record")</script>',
    }));
    const html = renderToStaticMarkup(createElement(MemoryWall, { memories: records, actions: actions(), context: context() }));
    expect(html.match(/<article /g)).toHaveLength(18);
    expect(html).toContain('25 saved on this device');
    expect(html).toContain('7 remaining');
    expect(html).toContain('world-a:1');
    expect(html).toContain('Offline fixture');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('memory ideas', () => {
  it.each(['carry', 'before', 'after'] as const)('keeps the %s draft within the existing contribution contract', (direction) => {
    const memory = Object.freeze(record({ worldTitle: 'W'.repeat(40), summary: '🌊'.repeat(200) }));
    const draft = createMemorySeed(memory, direction);
    expect(ContributionText.safeParse(draft).success).toBe(true);
    expect(draft).toContain(`"${memory.worldTitle}"`);
    expect(draft).toContain('🌊');
    expect(draft.endsWith('…')).toBe(true);
    expect(draft).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(memory.summary).toBe('🌊'.repeat(200));
  });

  it('retains a short recorded summary and validates user edits after trimming', () => {
    const memory = record();
    expect(createMemorySeed(memory, 'after')).toContain(memory.summary);
    expect(validMemorySeed('  A place with whispering books. \n')).toBe('A place with whispering books.');
    expect(validMemorySeed('   ')).toBeNull();
    expect(validMemorySeed('x'.repeat(201))).toBeNull();
  });

  it.each(['preparing', 'training', 'expedition', 'debrief'] as const)('blocks contribution outside HQ: %s', (phase) => {
    expect(memorySeedBlockReason({ ...context(), phase })).not.toBeNull();
  });

  it.each(['queued', 'generating', 'validating'] as const)('blocks contribution while generation is %s', (phase) => {
    expect(memorySeedBlockReason({ ...context(), generation: { ...IDLE_GENERATION_STATUS, phase } })).not.toBeNull();
  });

  it('blocks disconnected and full sessions but allows connected co-op guests to contribute', () => {
    const ui = context();
    ui.connection = { mode: 'remote', status: 'connected', isHost: false };
    expect(memorySeedBlockReason(ui)).toBeNull();
    ui.connection.status = 'connecting';
    expect(memorySeedBlockReason(ui)).toContain('Reconnect');
    ui.connection.status = 'connected';
    ui.contributions = Array.from({ length: 24 }, (_, index) => ({
      id: `idea-${index}`, playerId: 'player-a', playerName: 'Aster', text: 'A flooded archive', submittedAt: index,
    }));
    expect(memorySeedBlockReason(ui)).toContain('24');
  });

  it('shows an editable draft and fixture disclosure without submitting during render', () => {
    const uiActions = actions();
    const html = renderToStaticMarkup(createElement(MemorySeedComposer, {
      memory: record({ provenanceSource: 'live_fallback_fixture' }), context: context(),
      actions: uiActions, onClose: vi.fn(), onSubmit: vi.fn(),
    }));
    expect(html).toContain('Fallback fixture');
    expect(html).toContain('offline fixtures do not change to match it');
    expect(html).toContain('saved record stays unchanged');
    expect(html).toMatch(/maxlength="200"/i);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('disabled=""');
    expect(uiActions.submitContribution).not.toHaveBeenCalled();
    expect(uiActions.requestWorld).not.toHaveBeenCalled();
  });

  it('disables an open composer when its current session is no longer eligible', () => {
    const html = renderToStaticMarkup(createElement(MemorySeedComposer, {
      memory: record(), context: { ...context(), phase: 'expedition' },
      actions: actions(), onClose: vi.fn(), onSubmit: vi.fn(),
    }));
    expect(html).toContain('type="submit" class="btn btn--primary" disabled=""');
    expect(html).toContain('Return to headquarters');
  });
});
