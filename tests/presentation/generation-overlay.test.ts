/**
 * The forming/reveal overlay state machine (pure), plus a static render of the reveal card.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RevealCard } from '../../src/client/ui/GenerationOverlay';
import {
  dismissOverlay, INITIAL_OVERLAY_STATE, MIN_FORMING_MS, REVEAL_MS, stepOverlay, type OverlayInput, type OverlayState,
} from '../../src/client/ui/generationOverlayState';
import type { UiWorldSummary } from '../../src/shared/ui';

const at = (now: number, patch: Partial<OverlayInput> = {}): OverlayInput => ({ busy: false, worldId: null, inRun: false, now, ...patch });

describe('generation overlay state', () => {
  it('idle → forming on request, holds the minimum beat, then reveals the new world once', () => {
    let s: OverlayState = INITIAL_OVERLAY_STATE;
    s = stepOverlay(s, at(1000, { busy: true }));
    expect(s.kind).toBe('forming');
    // Composer answers instantly: world present, no longer busy, but the beat is not over.
    s = stepOverlay(s, at(1050, { worldId: 'w1' }));
    expect(s.kind).toBe('forming');
    s = stepOverlay(s, at(1000 + MIN_FORMING_MS, { worldId: 'w1' }));
    expect(s).toMatchObject({ kind: 'reveal', revealedWorldId: 'w1' });
    // Stays up for the reveal window, then clears, and does not re-reveal the same world.
    s = stepOverlay(s, at(1000 + MIN_FORMING_MS + 100, { worldId: 'w1' }));
    expect(s.kind).toBe('reveal');
    s = stepOverlay(s, at(1000 + MIN_FORMING_MS + REVEAL_MS, { worldId: 'w1' }));
    expect(s.kind).toBe('idle');
    s = stepOverlay(s, at(99_000, { worldId: 'w1' }));
    expect(s.kind).toBe('idle');
  });

  it('a slow live provider reveals as soon as the world lands', () => {
    let s = stepOverlay(INITIAL_OVERLAY_STATE, at(0, { busy: true }));
    for (let t = 100; t < 20_000; t += 500) s = stepOverlay(s, at(t, { busy: true }));
    expect(s.kind).toBe('forming');
    s = stepOverlay(s, at(20_000, { worldId: 'slow' }));
    expect(s).toMatchObject({ kind: 'reveal', revealedWorldId: 'slow' });
  });

  it('clears when a request fails without a new world, and when the crew enters the portal', () => {
    let s = stepOverlay(INITIAL_OVERLAY_STATE, at(0, { busy: true }));
    s = stepOverlay(s, at(3000, { worldId: null }));
    expect(s.kind).toBe('idle');
    let r = stepOverlay(INITIAL_OVERLAY_STATE, at(0, { busy: true }));
    r = stepOverlay(r, at(MIN_FORMING_MS, { worldId: 'w2' }));
    expect(r.kind).toBe('reveal');
    r = stepOverlay(r, at(MIN_FORMING_MS + 10, { worldId: 'w2', inRun: true }));
    expect(r).toMatchObject({ kind: 'idle', revealedWorldId: 'w2' });
    // Back in HQ afterwards: the same world is not announced again.
    r = stepOverlay(r, at(MIN_FORMING_MS + 5000, { worldId: 'w2' }));
    expect(r.kind).toBe('idle');
  });

  it('a second request replaces the reveal with a new forming stage; dismiss hides immediately', () => {
    let s = stepOverlay(INITIAL_OVERLAY_STATE, at(0, { busy: true }));
    s = stepOverlay(s, at(MIN_FORMING_MS, { worldId: 'w1' }));
    expect(s.kind).toBe('reveal');
    s = stepOverlay(s, at(MIN_FORMING_MS + 500, { busy: true, worldId: 'w1' }));
    expect(s.kind).toBe('forming');
    s = stepOverlay(s, at(MIN_FORMING_MS * 2 + 500, { worldId: 'w2' }));
    expect(s).toMatchObject({ kind: 'reveal', revealedWorldId: 'w2' });
    s = dismissOverlay(s, MIN_FORMING_MS * 2 + 600);
    expect(s.kind).toBe('idle');
    expect(stepOverlay(s, at(MIN_FORMING_MS * 2 + 700, { worldId: 'w2' })).kind).toBe('idle');
  });

  it('a world that appears without a request (co-op crew joining) is revealed once', () => {
    const s = stepOverlay(INITIAL_OVERLAY_STATE, at(0, { worldId: 'host-world' }));
    expect(s).toMatchObject({ kind: 'reveal', revealedWorldId: 'host-world' });
  });
});

describe('RevealCard', () => {
  it('renders the world identity, honest receipt counts and both actions', () => {
    const world: UiWorldSummary = {
      worldId: 'w', title: 'The Mourning Ossuary', tagline: 'Something still says the names every night.', themeSummary: 's',
      provenance: { source: 'procedural', label: 'COMPOSED · relay-composer', model: 'relay-composer', generatedAt: 0, durationMs: 18, attempts: 1, notes: [] },
      receipt: { worldTitle: 'The Mourning Ossuary', source: 'procedural', headline: 'h', lines: [
        { contributionId: 'c1', playerId: 'p', playerName: 'Ada', text: 'ghost pirates', used: true, featureDescription: 'x' },
        { contributionId: 'c2', playerId: 'p', playerName: 'Ada', text: 'nothing', used: false, featureDescription: null },
      ] },
      committedRoomCount: 3, plannedRoomCount: 3, lore: [], attunements: [],
      palette: { background: '#000000', floor: '#111111', floorAlt: '#121212', wall: '#222222', wallEdge: '#333333', accent: '#b8f5c8', accentSoft: '#e7c46a', glow: '#ffffff', hazard: '#ff0000', text: '#ffffff' },
      roomNames: ["Mourners' Path", 'Signal Gallery', 'Rest of the Ghost'],
    };
    const html = renderToStaticMarkup(createElement(RevealCard, { world, onEnter: () => {}, onDismiss: () => {} }));
    expect(html).toContain('The Mourning Ossuary');
    expect(html).toContain('1 of 2 ideas shaped this world');
    expect(html).toContain('18 ms');
    expect(html).toContain('COMPOSED · relay-composer');
    expect(html).toContain('Signal Gallery');
    expect(html).toContain('Enter portal');
    expect(html).not.toContain('relay-composer · relay-composer');
  });
});
