/**
 * Every line the finale shows a player goes through the house style linter (docs/WRITING.md):
 * the pattern names and tells, the Anchor prompts, the collapse clock and the pedestals.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EscapeTimer } from '../../src/client/ui/EscapeTimer';
import { RelicChoice } from '../../src/client/ui/RelicChoice';
import { IDLE_GENERATION_STATUS, type AnchorState, type GameSnapshot } from '../../src/shared/contracts';
import { anchorInstruction } from '../../src/shared/finale';
import { lintProse } from '../../src/shared/prose';
import { samplePlayers } from '../../src/shared/samples';
import type { UiModel } from '../../src/shared/ui';

type Collapse = NonNullable<GameSnapshot['collapse']>;

function model(collapse: Collapse | null): UiModel {
  return {
    phase: 'expedition',
    connection: { mode: 'local', status: 'connected' },
    localPlayer: { ...samplePlayers[0]!, isLocal: true },
    players: samplePlayers.map((player, index) => ({ ...player, isLocal: index === 0 })),
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: null,
    room: { index: 2, name: 'The last circuit', description: '', isFinal: true },
    hud: {
      hp: 80, maxHp: 100, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true,
      enemiesRemaining: 0, roomCleared: true, anchor: null, collapse,
    },
    discoveredLore: [], memories: [],
    classStatus: { bastion: 'implemented', shade: 'implemented', beacon: 'implemented', weaver: 'implemented' },
    preview: { fixtureWorld: false, startRoom: null },
    notice: null,
  };
}

const collapse = (stage: Collapse['stage'], remainingMs: number): Collapse => ({
  stage, remainingMs, totalMs: 75_000, ringDepth: 1, portalRoomId: 'room-0', lostRoomIds: ['room-2'],
  offer: [
    { key: 'relic:1', title: 'Tide gauge note', x: 0, y: 0, votes: [samplePlayers[0]!.id] },
    { key: 'custodian_log', title: 'Custodian log', x: 40, y: 0, votes: [] },
  ],
  chosenKey: null,
});

/** The visible text of a rendered panel, with markup and entities out of the way. */
function textOf(markup: string): string[] {
  return markup
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe('the finale reads like the rest of the game', () => {
  it('keeps the Anchor prompts plain at every stage', () => {
    const relays = [
      { x: 0, y: 0, activated: true }, { x: 0, y: 0, activated: false }, { x: 0, y: 0, activated: false },
    ];
    const stages: Array<NonNullable<AnchorState['ritual']>['stage']> =
      ['locked', 'relays', 'core', 'discharging', 'collapse', 'extraction', 'complete', 'stranded'];
    for (const stage of stages) {
      const anchor: AnchorState = {
        x: 0, y: 0, state: 'dormant', progress: 0,
        ritual: { stage, relays, activeRelay: 1, pulseRadius: 0, pulseWarningMs: 0, dischargeMs: 0 },
      };
      const line = anchorInstruction(anchor, true);
      expect(line.length).toBeGreaterThan(0);
      expect(lintProse(line, { kind: 'uiLabel' }).hardFail, `${stage}: ${line}`).toBe(false);
    }
  });

  it('shows the clock, then the choice, in lines that pass the linter', () => {
    const running = textOf(renderToStaticMarkup(createElement(EscapeTimer, { model: model(collapse('collapse', 41_300)) })));
    expect(running).toContain('41.3');
    expect(running).toContain('1 room gone behind you');
    const urgent = renderToStaticMarkup(createElement(EscapeTimer, { model: model(collapse('collapse', 9200)) }));
    expect(urgent).toContain('escape--urgent');
    expect(urgent).toContain('9.2');
    const stranded = textOf(renderToStaticMarkup(createElement(EscapeTimer, { model: model(collapse('stranded', 0)) })));
    expect(stranded.join(' ')).toContain('The crew did not get out');

    const choice = textOf(renderToStaticMarkup(createElement(RelicChoice, { model: model(collapse('extraction', 20_000)) })));
    expect(choice).toContain('Tide gauge note');
    expect(choice).toContain('Custodian log');
    expect(choice.some((line) => line.includes('Stand on a pedestal'))).toBe(true);
    // Whoever is standing on a pedestal is named, so the crew can see the vote.
    expect(choice).toContain(samplePlayers[0]!.displayName);

    for (const line of [...running, ...stranded, ...choice]) {
      if (/^[\d.]+$/.test(line)) continue;
      expect(lintProse(line, { kind: 'uiLabel' }).hardFail, line).toBe(false);
    }
  });

  it('draws nothing at all before the Anchor holds', () => {
    expect(renderToStaticMarkup(createElement(EscapeTimer, { model: model(null) }))).toBe('');
    expect(renderToStaticMarkup(createElement(RelicChoice, { model: model(null) }))).toBe('');
  });
});
