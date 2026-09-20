/**
 * Departure ritual (HUB.md §8) and lamp tiers (§6c): pure timing helpers, the device-local
 * departure bus, the overlay markup, and the player-facing lines passing the prose linter.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDepartureBus, HeadquartersDeparture, isDeparting } from '../../src/client/ui/HeadquartersDeparture';
import { HeadquartersPanel } from '../../src/client/ui/HeadquartersPanel';
import { HeadquartersPrompt, HeadquartersStationPanel } from '../../src/client/ui/HeadquartersStations';
import { IDLE_GENERATION_STATUS } from '../../src/shared/contracts';
import {
  DEPARTURE_COUNTDOWN_MS, HEADQUARTERS_LAMP_MAX_TIER, departureStage, headquartersLampGlow, headquartersLampTier,
} from '../../src/shared/headquarters';
import { lintProse } from '../../src/shared/prose';
import { samplePlayers } from '../../src/shared/samples';
import type { UiActions, UiModel } from '../../src/shared/ui';

const actions: UiActions = {
  setDisplayName: vi.fn(), selectClass: vi.fn(), submitContribution: vi.fn(), requestWorld: vi.fn(),
  enterPortal: vi.fn(), returnToHeadquarters: vi.fn(), clearMemories: vi.fn(), dismissNotice: vi.fn(),
  activateHeadquartersStation: vi.fn(), closeHeadquartersStation: vi.fn(), enterTraining: vi.fn(),
};

function model(overrides: Partial<UiModel> = {}): UiModel {
  return {
    phase: 'headquarters', connection: { mode: 'local', status: 'connected', isHost: true },
    localPlayer: { ...samplePlayers[0]!, isLocal: true }, players: [],
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: { id: 'w' } as unknown as UiModel['world'], room: null, hud: null, discoveredLore: [], memories: [],
    classStatus: { bastion: 'implemented', shade: 'implemented', beacon: 'implemented', weaver: 'implemented' },
    preview: { fixtureWorld: false, startRoom: null }, notice: null,
    headquarters: { nearbyStationId: 'portal', activeStationId: 'portal' },
    ...overrides,
  };
}

function fakeClock() {
  let now = 100_000;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let id = 0;
  const bus = createDepartureBus(
    () => now,
    (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    (handle) => { timers.delete(handle as number); },
  );
  const advance = (ms: number): void => {
    now += ms;
    for (const [key, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(key); timer.fn(); }
    }
  };
  return { bus, advance, timers, now: () => now };
}

describe('departure ritual timing (HUB.md §8)', () => {
  it('follows the beat sheet: ring 1.6× by 0.4 s, lamps 0.4 by 0.8 s, tethers, quartermaster at 1 s, collapse + flash to 2.4 s', () => {
    expect(DEPARTURE_COUNTDOWN_MS).toBe(2400);
    const start = departureStage(0);
    expect(start.ringScale).toBe(1);
    expect(start.lampLevel).toBe(1);
    expect(start.tethers).toBe(false);
    expect(start.quartermasterFacesGate).toBe(false);
    expect(start.flash).toBe(0);
    expect(departureStage(400).ringScale).toBeCloseTo(1.6);
    expect(departureStage(400).tethers).toBe(true);
    expect(departureStage(800).lampLevel).toBeCloseTo(0.4);
    expect(departureStage(999).quartermasterFacesGate).toBe(false);
    expect(departureStage(1000).quartermasterFacesGate).toBe(true);
    expect(departureStage(1600).flash).toBe(0);
    expect(departureStage(1600).ringScale).toBeCloseTo(1.6);
    expect(departureStage(2000).ringScale).toBeCloseTo(0.8);
    expect(departureStage(2000).flash).toBeCloseTo(0.5);
    const end = departureStage(2400);
    expect(end).toMatchObject({ done: true, flash: 1, ringScale: 0, tethers: false, progress: 1 });
    expect(departureStage(-50).progress).toBe(0);
    expect(departureStage(9_000).done).toBe(true);
  });

  it('lamp tiers are min(3, anchors): +0.15 glow and +8 % radius per tier', () => {
    expect(headquartersLampTier(0)).toBe(0);
    expect(headquartersLampTier(1)).toBe(1);
    expect(headquartersLampTier(2.9)).toBe(2);
    expect(headquartersLampTier(12)).toBe(HEADQUARTERS_LAMP_MAX_TIER);
    expect(headquartersLampTier(Number.NaN)).toBe(0);
    expect(headquartersLampGlow(0.8, 0)).toEqual({ glowIntensity: 0.8, radiusScale: 1 });
    const two = headquartersLampGlow(0.8, 2);
    expect(two.glowIntensity).toBeCloseTo(1.1);
    expect(two.radiusScale).toBeCloseTo(1.16);
    expect(headquartersLampGlow(0.8, 40).glowIntensity).toBeCloseTo(1.25);
  });
});

describe('departure bus', () => {
  it('sends the portal request once at 2.4 s, refuses a second ritual while one runs, and clears', () => {
    const { bus, advance, timers } = fakeClock();
    const commit = vi.fn();
    const seen: Array<boolean> = [];
    bus.subscribe(() => seen.push(isDeparting(bus.get())));
    expect(bus.stage()).toBeNull();
    expect(bus.begin(commit)).toBe(true);
    expect(bus.begin(commit)).toBe(false);
    expect(isDeparting(bus.get())).toBe(true);
    advance(1200);
    expect(bus.stage()!.progress).toBeCloseTo(0.5);
    expect(commit).not.toHaveBeenCalled();
    advance(1200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(isDeparting(bus.get())).toBe(false);
    expect(bus.get()!.committedAt).not.toBeNull();
    expect(bus.stage()!.done).toBe(true);
    bus.skip();
    expect(commit).toHaveBeenCalledTimes(1);
    bus.clear();
    expect(bus.get()).toBeNull();
    expect(timers.size).toBe(0);
    expect(seen).toEqual([true, false, false]);
  });

  it('skip commits immediately and cancels the pending timer', () => {
    const { bus, advance, timers } = fakeClock();
    const commit = vi.fn();
    bus.begin(commit);
    advance(300);
    bus.skip();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
    advance(5000);
    expect(commit).toHaveBeenCalledTimes(1);
    // A new ritual may start once the previous one committed.
    expect(bus.begin(commit)).toBe(true);
  });

  it('skip and clear are no-ops when nothing is running', () => {
    const { bus } = fakeClock();
    expect(() => bus.skip()).not.toThrow();
    expect(() => bus.clear()).not.toThrow();
    expect(bus.get()).toBeNull();
  });
});

describe('departure overlay and gate buttons', () => {
  it('renders nothing until a ritual starts, then the skip hint over the stage and a flash that follows the beat', () => {
    const { bus, advance } = fakeClock();
    expect(renderToStaticMarkup(createElement(HeadquartersDeparture, { bus }))).toBe('');
    bus.begin(() => {});
    const html = renderToStaticMarkup(createElement(HeadquartersDeparture, { bus, now: () => 100_000 }));
    expect(html).toContain('data-testid="hq-departure"');
    expect(html).toContain('leaves now');
    expect(html).toContain('opacity:0');
    advance(2000);
    const later = renderToStaticMarkup(createElement(HeadquartersDeparture, { bus, now: () => 102_000 }));
    expect(later).toContain('opacity:0.5');
    advance(400);
    const committed = renderToStaticMarkup(createElement(HeadquartersDeparture, { bus, now: () => 102_400 }));
    expect(committed).toContain('hq-departure--committed');
    expect(committed).not.toContain('leaves now');
    expect(committed).toContain('opacity:1');
  });

  it('the gate buttons start the ritual instead of entering the portal, and read as busy while it runs', () => {
    const { bus } = fakeClock();
    const station = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: model(), actions, departure: bus }));
    expect(station).toContain('>Enter portal</button>');
    bus.begin(() => {});
    const running = renderToStaticMarkup(createElement(HeadquartersStationPanel, { model: model(), actions, departure: bus }));
    expect(running).toContain('Departing…');
    expect(running).toContain('The gate is opening. F or Esc leaves now.');
    expect(running).toMatch(/<button[^>]*disabled[^>]*>Departing…<\/button>/);
    const panel = renderToStaticMarkup(createElement(HeadquartersPanel, { model: model(), actions, departure: bus }));
    expect(panel).toMatch(/<button[^>]*disabled[^>]*>Departing…<\/button>/);
    const prompt = renderToStaticMarkup(createElement(HeadquartersPrompt, { model: model(), actions, departure: bus }));
    expect(prompt).toContain('The gate is opening');
    expect(prompt).toContain('data-testid="hq-departure"');
    expect(actions.enterPortal).not.toHaveBeenCalled();
  });

  it('the operative disclosure names what it holds: name and weapon, and points at the menu for controls', () => {
    const html = renderToStaticMarkup(createElement(HeadquartersPanel, { model: model(), actions }));
    expect(html).not.toContain('quick controls');
    expect(html).toContain('· name and weapon</summary>');
    expect(html).toContain('the same choice as the armory stands');
    // U2a: the closing key-bindings paragraph was already hidden by CSS and duplicated the
    // Controls menu page, so the markup went too. The rail no longer explains the controls.
    expect(html).not.toContain('Key bindings are in the menu under Controls.');
    expect(html).not.toContain('Shift/Space to dash');
  });

  it('player-facing departure lines pass lintProse', () => {
    for (const line of [
      'The gate is opening. F or Esc leaves now.',
      'F or Esc leaves now',
      'The gate is opening',
      'Walk onto the glowing gate at the bottom of the room to leave once a world is ready. Key bindings are in the menu under Controls.',
    ]) {
      const result = lintProse(line, { kind: 'generic' });
      expect(!result.hardFail && result.score < 30, `"${line}" → ${result.score} ${result.issues.map((i) => `${i.rule}:${i.excerpt}`).join(', ')}`).toBe(true);
    }
  });
});
