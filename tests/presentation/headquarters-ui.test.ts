import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HeadquartersPanel } from '../../src/client/ui/HeadquartersPanel';
import { createHubState, createHubStateBus, type HubRelic, type LastRun } from '../../src/client/chronicle/hubState';
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
    expect(html).toContain('No records yet');
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
    expect(html).toContain('armory stands');
    // U2a: the "walk up to a station and press F" paragraph was cut — the onboarding prompt
    // and the station prompt over the canvas already say it. The rail keeps one lead line.
    expect(html).toContain('Pick a weapon, add an idea for the next world, then take the gate.');
    expect(html).not.toContain('press F');
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
    expect(shrine).toContain('CURRENT · Arc-blade and tower shield');
    expect(shrine).not.toMatch(/attune/i);
    expect(shrine).toContain('Bulwark');
    expect(shrine).toContain('Shockwave');
  });

  it('shows the weapon copy at the armory stands and never says attune', () => {
    const ui = model();
    ui.headquarters = { nearbyStationId: 'shade', activeStationId: 'shade' };
    const prompt = renderToStaticMarkup(createElement(HeadquartersPrompt, { model: ui, actions }));
    expect(prompt).toContain('Take the phase blades');
    const panel = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions }));
    expect(panel).toContain('Carrying · Arc-blade and tower shield');
    expect(panel).not.toMatch(/attune/i);
    expect(renderToStaticMarkup(createElement(HeadquartersPanel, { model: ui, actions }))).not.toMatch(/attune|shrine/i);
  });

  it('quartermaster panel derives its line and evidence from the recorded last run only', () => {
    const ui = model();
    ui.headquarters = { nearbyStationId: 'quartermaster', activeStationId: 'quartermaster' };
    const hub = createHubStateBus();
    const empty = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions, hub }));
    expect(empty).toContain('No expedition has been recorded on this browser yet.');
    expect(empty).toContain('from: run_ended ×0 · world_prepared: none · device-local');
    const lastRun: LastRun = {
      worldId: 'w', worldTitle: 'Vantage Spire', outcome: 'collapsed', classId: 'bastion', endedAt: 5, durationMs: 60_000, roomsEntered: 3,
      deepestRoomIndex: 2, deepestTier: -1, biomesCleared: 0, roomsCleared: 1, enemiesDefeated: 2, damageDealt: 10, damageTaken: 70, downs: 2, lastDownedByEnemyId: 'warden',
      revivesGiven: 0, revivesReceived: 1, loreRead: 0, abilityUnlocked: null, crew: [{ id: 'p1', displayName: 'Jon' }], worldSource: 'fixture', sourceEventIds: ['1:0', '2:0'],
    };
    hub.set({ ...createHubState(), lastRun, totals: { runs: 1, anchors: 0, worldsVisited: 1, relics: 0 } });
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions, hub }));
    expect(html).toContain('Warden');
    expect(html).toContain('from: run_ended (collapsed) · player_downed ×2 · player_damaged.sourceEnemyId = warden');
    expect(html).toContain('Jon');
    expect(html).toContain('not lifetime totals');
  });

  it('records panel keeps unplayed classes unlit and lists the required labels for a played one', () => {
    const ui = model();
    ui.headquarters = { nearbyStationId: 'records', activeStationId: 'records' };
    const hub = createHubStateBus();
    const state = createHubState();
    state.records.bastion = {
      ...state.records.bastion, runs: 2, anchors: 1, collapses: 1, deepestRoomIndex: 3, roomsCleared: 5, enemiesDefeated: 9, damageDealt: 120, damageTaken: 80,
      timesDowned: 1, revivesGiven: 2, revivesReceived: 1, loreRead: 3, abilityUseCounts: { 'bastion.e.shockwave': 4, 'bastion.q.bulwark': 2 }, nemesisCounts: { warden: 1 },
    };
    hub.set(state);
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions, hub }));
    for (const label of ['Expeditions', 'Anchored', 'Collapsed', 'Deepest room', 'Rooms cleared', 'Hostiles down', 'Damage dealt', 'Damage taken', 'Times downed', 'Picked up', 'Picked up others', 'Most used ability', 'Nemesis', 'Fragments read']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Counts reflect events recorded on this browser. They are not lifetime totals.');
    expect(html.match(/hq-tab--unlit/g)).toHaveLength(3);
    expect(html).toContain('aria-selected="true"');
  });

  it('relic shelf shows empty brackets until an anchored run recovers one, then the world and recoverer', () => {
    const ui = model();
    ui.headquarters = { nearbyStationId: 'relics', activeStationId: 'relics' };
    const hub = createHubStateBus();
    const empty = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions, hub }));
    expect(empty).toContain('0 of 5 brackets filled');
    expect(empty).toContain('Empty brackets');
    const relic: HubRelic = {
      id: 'relic-w-1', worldId: 'w', worldTitle: 'Vantage Spire', title: 'Red wrench', source: 'Tarn', text: 'A wrench, painted red.',
      recoveredBy: [{ id: 'p', displayName: 'Jon' }], recoveredAt: 1, worldSource: 'live', sourceEventIds: ['2:0'],
    };
    hub.set({ ...createHubState(), relics: [relic], totals: { runs: 1, anchors: 1, worldsVisited: 1, relics: 1 } });
    const html = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: ui, actions, hub }));
    expect(html).toContain('Red wrench');
    expect(html).toContain('Vantage Spire · Live generation · recovered by Jon');
    expect(html).toContain('1 of 5 brackets filled');
  });
});
