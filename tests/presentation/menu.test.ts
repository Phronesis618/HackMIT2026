import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BestiaryPage, CodexPage, ControlsPage, GameMenu, MENU_PAGES, OperativePage, SkillsPage } from '../../src/client/ui/GameMenu';
import { IDLE_GENERATION_STATUS, WorldFixtureSchema } from '../../src/shared/contracts';
import { samplePlayers } from '../../src/shared/samples';
import type { UiActions, UiModel } from '../../src/shared/ui';
import fixtureData from '../../fixtures/worlds/vantage-spire.json';

const fixture = WorldFixtureSchema.parse(fixtureData);
const actions: UiActions = {
  setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
  enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(), unlockAbility: vi.fn(),
};

function model(discoveredLore: number[] = []): UiModel {
  return {
    phase: 'expedition',
    connection: { mode: 'local', status: 'connected', isHost: true },
    localPlayer: { ...samplePlayers[0]!, isLocal: true },
    players: samplePlayers.map((p, i) => ({ ...p, isLocal: i === 0 })),
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: {
      worldId: 'w', title: fixture.recipe.title, tagline: fixture.recipe.tagline, themeSummary: fixture.recipe.themeSummary,
      provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
      receipt: { source: 'fixture', worldTitle: fixture.recipe.title, headline: 'Test receipt', lines: [] },
      committedRoomCount: 3, plannedRoomCount: 3, lore: fixture.recipe.lore, attunements: fixture.recipe.attunements,
    },
    room: { index: 0, name: 'Test room', description: '', isFinal: false },
    hud: { hp: 100, maxHp: 100, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 2, resources: 3 },
    discoveredLore,
    memories: [], classStatus: { bastion: 'implemented', shade: 'implemented', beacon: 'implemented', weaver: 'implemented' },
    preview: { fixtureWorld: true, startRoom: null }, notice: null,
  };
}

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe('Tab menu', () => {
  it('owns the controls and the memory wall so the HUD does not have to', () => {
    expect(MENU_PAGES).toContain('controls');
    expect(MENU_PAGES).toContain('memories');
    const html = render(createElement(ControlsPage));
    for (const key of ['W', 'Shift', 'LMB', 'Q', 'E', 'R', 'F', 'Tab']) expect(html).toContain(`>${key}</kbd>`);
  });

  it('is closed by default and only shows the key hint', () => {
    const html = render(createElement(GameMenu, { model: model(), actions }));
    expect(html).toContain('Tab · menu');
    expect(html).not.toContain('menu__frame');
  });

  it('codex page keeps undiscovered lore hidden and reveals found fragments in full', () => {
    const hidden = render(createElement(CodexPage, { model: model() }));
    expect(hidden).toContain('???');
    expect(hidden).not.toContain(fixture.recipe.lore[0]!.text);
    const found = render(createElement(CodexPage, { model: model([0]) }));
    expect(found).toContain(fixture.recipe.lore[0]!.title);
    expect(found).toContain(fixture.recipe.lore[0]!.text);
  });

  it('bestiary lists how every hostile fights but earns their story from remains', () => {
    const huskRemains = fixture.recipe.lore.findIndex((f) => f.kind === 'remains' && f.enemyId === 'husk');
    const before = render(createElement(BestiaryPage, { model: model() }));
    expect(before).toContain('Husk');
    expect(before).toContain('Melee swing');
    expect(before).not.toContain(fixture.recipe.lore[huskRemains]!.text);
    expect(before).toContain('Not encountered in this world');
    const after = render(createElement(BestiaryPage, { model: model([huskRemains]) }));
    expect(after).toContain(fixture.recipe.lore[huskRemains]!.text);
  });

  it('operative page carries the loadout, unlock, crew and the return action', () => {
    const html = render(createElement(OperativePage, { model: model(), actions }));
    expect(html).toContain('Bulwark');
    expect(html).toContain('Unlock · 3 resources');
    expect(html).toContain('Test Ally');
    expect(html).toContain('Return to headquarters');
  });

  it('skills page grows the class tree plus the branch this world wrote', () => {
    const html = render(createElement(SkillsPage, { model: model() }));
    expect(html).toContain('Reinforced Plating');
    expect(html).toContain('Bastion of Last Light');
    for (const a of fixture.recipe.attunements) expect(html).toContain(a.name.replace(/'/g, '&#x27;'));
    expect(html).toContain(`Attuned to ${fixture.recipe.title}`);
    expect(html).not.toContain('not wired');
    expect(html).not.toContain('Never Seen');
  });

  it('skills page says Active only for a node that is implemented AND bought', () => {
    const attunement = fixture.recipe.attunements[0]!;
    const nodeId = `attune.0.${attunement.effectId}`;
    const withHud = (hud: Partial<NonNullable<UiModel['hud']>>): UiModel => {
      const m = model();
      return { ...m, hud: { ...m.hud!, ...hud } };
    };
    // Unbought, implemented, affordable: offered for sale, not Active.
    const unbought = render(createElement(SkillsPage, { model: withHud({ resources: 10, skillNodeIds: ['core.salvage'] }), actions, selectedId: nodeId }));
    expect(unbought).toContain(`Buy · 3 resources`);
    expect(unbought).not.toContain('<dd>Active</dd>');
    // Unbought and broke: the button says why.
    const broke = render(createElement(SkillsPage, { model: withHud({ resources: 1, skillNodeIds: ['core.salvage'] }), actions, selectedId: nodeId }));
    expect(broke).toContain('Not enough resources');
    // Bought: Active, and nothing left to buy on this node.
    const bought = render(createElement(SkillsPage, { model: withHud({ skillNodeIds: ['core.salvage', nodeId] }), actions, selectedId: nodeId }));
    expect(bought).toContain('<dd>Active</dd>');
    expect(bought).not.toContain('Buy ·');
    // Planned nodes are never Active, even if a stale client claims to own them.
    const planned = render(createElement(SkillsPage, { model: withHud({ skillNodeIds: ['core.plating'] }), actions, selectedId: 'core.plating' }));
    expect(planned).toContain('Planned · not in the game yet');
    expect(planned).not.toContain('<dd>Active</dd>');
    expect(planned).not.toContain('Buy ·');
  });
});
