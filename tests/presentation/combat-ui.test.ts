import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DebriefPanel } from '../../src/client/ui/DebriefPanel';
import { Hud } from '../../src/client/ui/Hud';
import { createChronicleState, reduceChronicle } from '../../src/chronicle';
import { IDLE_GENERATION_STATUS, type GameEvent } from '../../src/shared/contracts';
import { SAMPLE_WORLD_ID, SAMPLE_WORLD_TITLE, sampleEvents, samplePlayers } from '../../src/shared/samples';
import type { UiActions, UiModel } from '../../src/shared/ui';

const actions: UiActions = {
  setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
  enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), purchaseUnlock: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(),
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
      committedRoomCount: 3, plannedRoomCount: 3,
    },
    room: { index: 0, name: 'Test room', description: 'Test description', isFinal: false },
    hud: {
      hp: 100, maxHp: 100, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 2,
      abilities: [
        { slot: 'q', abilityId: 'bastion.q.bulwark', name: 'Bulwark', key: 'Q', status: 'ready', cooldownMs: 0, cooldownTotalMs: 5000 },
        { slot: 'e', abilityId: 'bastion.e.shockwave', name: 'Magnetic Tether', key: 'E', status: 'locked', cooldownMs: 0, cooldownTotalMs: 8000 },
      ],
      shieldMs: 0, shardsThisRun: 0, objective: 'Clear 2 hostiles to unlock the exit.', roomCleared: false, exitsLocked: true,
      interactProgress: 0, isDown: false,
    },
    profile: { version: 1, playerId: samplePlayers[0]!.id, shards: 100, unlockedAbilityIds: [], startingGrantApplied: true, runsPlayed: 0, updatedAt: 0 },
    unlockOffers: [],
    run: { runId: 'test-run', status: 'active', roomsCleared: 0, shardsEarned: 0, returnCountdownMs: 0 },
    memories: [], classStatus: { bastion: 'implemented', shade: 'planned', beacon: 'planned', weaver: 'planned' },
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

describe('combat HUD', () => {
  it('does not advertise usable attacks or movement when the operative is down', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, state: 'down', hp: -10 };
    const html = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(html).toContain('Operative down');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain('ability--ready');
    expect(html).not.toContain('WASD / arrows');
    expect(html).not.toContain('Integrity critical');
    expect(html).toContain('Return to headquarters');
  });

  it('warns only at low integrity and clamps the accessible health meter', () => {
    const ui = model();
    ui.hud = { ...ui.hud!, hp: 25, attackReady: false };
    const low = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(low).toContain('Integrity critical');
    expect(low).toContain('recovering');
    ui.hud.hp = 125;
    const full = renderToStaticMarkup(createElement(Hud, { model: ui, actions }));
    expect(full).not.toContain('Integrity critical');
    expect(full).toContain('aria-valuenow="100"');
    expect(full).toContain('width:100%');
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
      outcome, playerIds: [samplePlayers[0]!.id], shardsEarned: 40, roomsCleared: 1,
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
