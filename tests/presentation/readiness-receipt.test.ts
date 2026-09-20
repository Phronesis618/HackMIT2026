import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorldPanel } from '../../src/client/ui/WorldPanel';
import type { UiWorldSummary } from '../../src/shared/ui';

function world(source: UiWorldSummary['provenance']['source'] = 'live'): UiWorldSummary {
  return {
    worldId: 'test-receipt-world', title: 'Test Echo Station', tagline: 'A test world', themeSummary: 'A station of bells',
    provenance: { source, label: source, generatedAt: 0, durationMs: 10, attempts: source === 'fixture' ? 0 : 1, notes: ['Test provenance note'] },
    committedRoomCount: 1, plannedRoomCount: 3, lore: [], attunements: [],
    receipt: {
      source, worldTitle: 'Test Echo Station', headline: source === 'live' ? 'Your bell became the arrival signal.' : 'Your ideas were recorded for this fixture.',
      lines: [
        { contributionId: 'test-used', playerId: 'test-player', playerName: 'Test Operative', text: 'A bell rings on arrival', used: source === 'live', featureDescription: source === 'live' ? 'A brass bell marks the station entrance.' : null },
        { contributionId: 'test-unused', playerId: 'test-ally', playerName: 'Test Ally', text: 'Snow that falls upward', used: false, featureDescription: null },
      ],
    },
  };
}

const visibleReceipt = (summary: UiWorldSummary) =>
  renderToStaticMarkup(createElement(WorldPanel, { world: summary })).split('<details')[0]!;

describe('immediate creation receipt', () => {
  it('shows real attribution and unused contributions before any collapsed dossier while rooms stream', () => {
    const summary = world();
    const html = visibleReceipt(summary);
    expect(html).toContain('World dossier · 1/3 rooms');
    expect(html).toContain('Creation receipt');
    expect(html).toContain(summary.receipt.headline);
    for (const line of summary.receipt.lines) {
      expect(html).toContain(line.playerName);
      expect(html).toContain(line.text);
    }
    expect(html).toContain('→ A brass bell marks the station entrance.');
    expect(html).toContain('recorded · not used in this world');
    expect(html).not.toContain('Your ideas are recorded, but did not shape this world.');
  });

  it.each(['fixture', 'live_fallback_fixture'] as const)('discloses %s without claiming its scenery came from player ideas', (source) => {
    const summary = world(source);
    const html = visibleReceipt(summary);
    expect(html).toContain(source === 'fixture' ? 'Offline fixture.' : 'Live generation failed; using an offline fixture.');
    expect(html).toContain('Your ideas are recorded, but did not shape this world.');
    expect(html).toContain(summary.receipt.headline);
    expect(html.match(/recorded · not used in this world/g)).toHaveLength(2);
    expect(html).not.toContain('→');
  });

  it('states when there were no submitted contributions without inventing attribution', () => {
    const summary = world('fixture');
    summary.receipt.lines = [];
    const html = visibleReceipt(summary);
    expect(html).toContain('No contributions were submitted for this world.');
    expect(html).not.toContain('list__who');
  });
});
