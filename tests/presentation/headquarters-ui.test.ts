import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HeadquartersPanel } from '../../src/client/ui/HeadquartersPanel';
import { HeadquartersPrompt, HeadquartersStationPanel } from '../../src/client/ui/HeadquartersStations';
import { IDLE_GENERATION_STATUS, type MemoryRecord } from '../../src/shared/contracts';
import { samplePlayers } from '../../src/shared/samples';
import type { UiActions, UiModel } from '../../src/shared/ui';

const actions: UiActions = {
  setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
  enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(),
  activateHeadquartersStation: vi.fn(), closeHeadquartersStation: vi.fn(), enterTraining: vi.fn(),
};

function model(): UiModel {
  return {
    phase: 'headquarters', connection: { mode: 'local', status: 'connected', isHost: true },
    localPlayer: { ...samplePlayers[0]!, isLocal: true }, players: [],
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: null, room: null, hud: null, discoveredLore: [], memories: [],
    classStatus: { bastion: 'implemented', shade: 'implemented', beacon: 'implemented', weaver: 'implemented' },
    preview: { fixtureWorld: false, startRoom: null }, notice: null,
    headquarters: { nearbyStationId: 'archive', activeStationId: 'archive' },
  };
}

describe('headquarters station UI', () => {
  it('clearly labels empty records as device-local without claiming lifetime wins', () => {
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: model(), actions }));
    expect(html).toContain('Device-local records');
    expect(html).toContain('not lifetime totals or win counts');
    expect(html).toContain('The archive is quiet');
    expect(html.match(/<dd>0<\/dd>/g)).toHaveLength(6);
  });

  it.each(['fixture', 'live', 'live_fallback_fixture'] as const)('labels each saved echo provenance honestly: %s', (source) => {
    const ui = model();
    const memory: MemoryRecord = {
      id: 'test-memory', kind: 'creation_receipt', worldId: 'test-world', worldTitle: 'Test world', roomIndex: null,
      createdAt: 1, participants: [samplePlayers[0]!], title: 'Test receipt', summary: 'A real recorded test event',
      sourceEventIds: ['test:1'], provenanceSource: source,
    };
    ui.memories = [memory];
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions }));
    expect(html).toContain(source === 'live' ? 'Live generation' : source === 'fixture' ? 'Offline fixture' : 'Fallback fixture');
    if (source !== 'live') expect(html).not.toContain('Live generation');
  });

  it('offers an accessible F-equivalent button and disables it during preparation', () => {
    const ui = model();
    const html = renderToStaticMarkup(createElement(HeadquartersPrompt, { model: ui, actions }));
    expect(html).toContain('<kbd>F</kbd>');
    expect(html).toContain('Read records');
    ui.phase = 'preparing';
    expect(renderToStaticMarkup(createElement(HeadquartersPrompt, { model: ui, actions }))).toContain('disabled=""');
  });

  it('retains world preparation and the collapsed accessible class controls', () => {
    const html = renderToStaticMarkup(createElement(HeadquartersPanel, { model: model(), actions }));
    expect(html).toContain('Prepare world');
    expect(html).toContain('id="contribution"');
    expect(html).toContain('<details class="operative">');
    expect(html).toContain('armory shrines');
    expect(html).toContain('press F');
  });

  it('keeps training solo-only and displays current class abilities at shrines', () => {
    const ui = model();
    ui.headquarters = { nearbyStationId: 'training', activeStationId: 'training' };
    ui.connection.mode = 'remote';
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('available in solo play');
    ui.headquarters = { nearbyStationId: 'bastion', activeStationId: 'bastion' };
    const shrine = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions }));
    expect(shrine).toContain('Attuned · Bastion');
    expect(shrine).toContain('Bulwark');
    expect(shrine).toContain('Shockwave');
  });
});
