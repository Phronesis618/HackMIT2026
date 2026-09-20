import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DebriefPanel } from '../../src/client/ui/DebriefPanel';
import { AbilityBar } from '../../src/client/ui/AbilityBar';
import { Hud, RunStatus } from '../../src/client/ui/Hud';
import { MemoryBrief } from '../../src/client/ui/MemoryWall';
import { createChronicleState, reduceChronicle } from '../../src/chronicle';
import { IDLE_GENERATION_STATUS, type GameEvent } from '../../src/shared/contracts';
import { SAMPLE_WORLD_ID, SAMPLE_WORLD_TITLE, sampleEvents, samplePlayers } from '../../src/shared/samples';
import type { UiActions, UiModel } from '../../src/shared/ui';

const actions: UiActions = {
  setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
  enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(),
};

function model(): UiModel {
  return {
    phase: 'expedition',
    connection: { mode: 'local', status: 'connected' },
    localPlayer: { ...samplePlayers[0]!, isLocal: true },
    players: samplePlayers.map((p, i) => ({ ...p, isLocal: i === 0 })),
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: {
      worldId: SAMPLE_WORLD_ID, title: SAMPLE_WORLD_TITLE, tagline: 'Test world', themeSummary: 'Test theme',
      provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
      receipt: { source: 'fixture', worldTitle: SAMPLE_WORLD_TITLE, headline: 'Test receipt', lines: [] },
      committedRoomCount: 3, plannedRoomCount: 3, lore: [], attunements: [],
    },
    room: { index: 0, name: 'Test room', description: 'Test description', isFinal: false },
    hud: { hp: 100, maxHp: 100, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 2 },
    discoveredLore: [],
    memories: [], classStatus: { bastion: 'partial', shade: 'planned', beacon: 'planned', weaver: 'planned' },
    preview: { fixtureWorld: true, startRoom: null }, notice: null,
  };
}

function debrief(events: GameEvent[]) {
  const ui = model();
  const world = ui.world!;
  ui.phase = 'debrief';
  ui.memories = reduceChronicle(createChronicleState(), events, {
    now: 100, players: samplePlayers,
    world: { worldId: world.worldId, title: world.title, provenanceSource: world.provenance.source, receipt: world.receipt },
  }).created;
  return ui;
}

describe('run rail and command bar', () => {
  it('reserves an empty, named minimap slot at the top of the run rail', () => {
    const html = renderToStaticMarkup(createElement(RunStatus, { model: model() }));
    expect(html).toContain('class="hud-minimap-slot"');
    expect(html).toContain('data-slot="minimap"');
    expect(html.indexOf('hud-minimap-slot')).toBeLessThan(html.indexOf('rail-status'));
  });

  it('shows hostiles, room progress and the crew, and flips to Clear when the room is empty', () => {
    const ui = model();
    const html = renderToStaticMarkup(createElement(RunStatus, { model: ui }));
    expect(html).toContain('Hostiles');
    expect(html).toContain('Test room');
    expect(html).toContain('Crew · ' + ui.players.length + '/4');
    ui.hud = { ...ui.hud!, enemiesRemaining: 0 };
    expect(renderToStaticMarkup(createElement(RunStatus, { model: ui }))).toContain('Clear');
  });

  it('marks a crew seat whose client has gone away (A11)', () => {
    const ui = model();
    ui.players = ui.players.map((p, i) => ({ ...p, connected: i !== 1 }));
    const html = renderToStaticMarkup(createElement(RunStatus, { model: ui }));
    expect(html).toContain('is-offline');
    expect(html).toContain('· offline');
    // Everyone present: no marker anywhere.
    ui.players = ui.players.map((p) => ({ ...p, connected: true }));
    expect(renderToStaticMarkup(createElement(RunStatus, { model: ui }))).not.toContain('offline');
  });

  it('puts a readable Integrity number and resources beside the abilities', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, hp: 42, resources: 5, dashCooldownMs: 400 };
    const html = renderToStaticMarkup(createElement(AbilityBar, { model: ui, actions }));
    expect(html).toContain('vitals--hurt');
    expect(html).toMatch(/42<small>\/100<\/small>/);
    expect(html).toContain('resource__num');
    expect(html).toContain('abilityslot--cooldown');
    expect(html).toContain('abilityslot--locked');
    expect(html).not.toContain('Unlock E'); // only offered at headquarters
  });

  it('summarises the memory wall in the rail instead of a bottom strip', () => {
    expect(renderToStaticMarkup(createElement(MemoryBrief, { memories: [] }))).toContain('Nothing yet');
    const ui = debrief(sampleEvents);
    const html = renderToStaticMarkup(createElement(MemoryBrief, { memories: ui.memories }));
    expect(html).toContain(String(ui.memories.length));
    expect(html).toContain('memory-brief__latest');
  });
});

describe('combat HUD', () => {
  it('does not advertise usable attacks or movement when the operative is down', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, state: 'down', hp: -10 };
    const html = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(html).toContain('Operative down');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain('WASD');
    expect(html).not.toContain('Integrity critical');
    expect(html).not.toContain('Hostiles');
  });

  it('stays empty apart from the accessible meter when nothing needs the player\'s attention', () => {
    const ui = model();
    const html = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(html).not.toContain('combat-status');
    expect(html).toContain('aria-valuenow="100"');
  });

  it('prompts for the Anchor only once the room is clear', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, anchor: { x: 0, y: 0, state: 'dormant', progress: 0 } };
    expect(renderToStaticMarkup(createElement(Hud, { model: ui, actions }))).not.toContain('Anchor');
    ui.hud = { ...ui.hud, enemiesRemaining: 0 };
    expect(renderToStaticMarkup(createElement(Hud, { model: ui, actions }))).toContain('Hold F at the Anchor');
  });

  it('warns only at low integrity and clamps the accessible health meter', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, hp: 25, attackReady: false };
    const low = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(low).toContain('Integrity critical');
    ui.hud.hp = 125;
    const full = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(full).not.toContain('Integrity critical');
    expect(full).toContain('aria-valuenow="100"');
  });
});

describe('event-derived debrief', () => {
  it('never infers an outcome from arrival or a first defeat', () => {
    const ui = debrief(sampleEvents);
    const html = renderToStaticMarkup(createElement(DebriefPanel, { model: ui, actions }));
    expect(html).toContain('No expedition outcome has been recorded yet');
    expect(html).toContain('Arrival preserved');
    expect(html).toContain('defeated the first hostile');
    expect(html).toContain('3 memories from this world');
    expect(html).not.toContain('world anchored');
  });

  it.each(['anchored', 'collapsed', 'aborted'] as const)('shows the recorded %s outcome without changing its meaning', (outcome) => {
    const ui = debrief([...sampleEvents, {
      id: 'test-run-ended', type: 'run_ended', tick: 900, timeMs: 15000, worldId: SAMPLE_WORLD_ID,
      outcome, playerIds: [samplePlayers[0]!.id],
    }]);
    const html = renderToStaticMarkup(createElement(DebriefPanel, { model: ui, actions }));
    const summary = ui.memories.find((m) => m.kind === 'run_summary')!;
    expect(html).toContain(summary.summary);
    expect(html).not.toContain('No expedition outcome');
    expect(html).toContain('4 memories from this world');
  });

  it('does not borrow another world’s history or claim erased memories still exist', () => {
    const ui = debrief([...sampleEvents, {
      id: 'test-anchor', type: 'anchor_planted', tick: 900, timeMs: 15000,
      worldId: SAMPLE_WORLD_ID, roomIndex: 2, playerIds: [samplePlayers[0]!.id],
    }]);
    ui.world = { ...ui.world!, worldId: 'test-other-world' };
    const html = renderToStaticMarkup(createElement(DebriefPanel, { model: ui, actions }));
    expect(html).toContain('No memories from this world');
    expect(html).not.toContain('Arrival preserved');
    expect(html).not.toContain('planted the Anchor');
    ui.world = null;
    expect(renderToStaticMarkup(createElement(DebriefPanel, { model: ui, actions }))).toContain('No expedition outcome');
    ui.memories = [];
    expect(renderToStaticMarkup(createElement(DebriefPanel, { model: ui, actions }))).toContain('No memories from this world');
  });
});
