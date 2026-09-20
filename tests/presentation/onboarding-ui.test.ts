/**
 * The band and the Field Notes page as HTML: what they say, what they hide, and that the
 * menu actually carries the page.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachPrompt } from '../../src/client/ui/CoachPrompt';
import { FieldNotesPage } from '../../src/client/ui/FieldNotes';
import { MENU_PAGES } from '../../src/client/ui/GameMenu';
import type { OnboardingBus } from '../../src/client/onboarding';
import type { FieldNote, OnboardingView } from '../../src/client/onboarding';

function fakeBus(view: OnboardingView): OnboardingBus {
  const calls: string[] = [];
  return Object.assign({
    get: () => view,
    subscribe: () => () => {},
    publish: () => {},
    attach: () => {},
    setHintsOff: (off: boolean) => calls.push(`off:${off}`),
    reset: () => calls.push('reset'),
  }, { calls }) as OnboardingBus & { calls: string[] };
}

const note = (over: Partial<FieldNote>): FieldNote =>
  ({ id: 'x', group: 'controls', keys: [], text: 'text', atMs: 1, ...over });

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe('coach band', () => {
  it('renders nothing but an empty live region when there is no prompt', () => {
    const html = render(createElement(CoachPrompt, { bus: fakeBus({ prompt: null, notes: [], hintsOff: false }) }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-coach="none"');
    expect(html).not.toContain('coach__line');
  });

  it('renders the key caps beside the words, and cannot be clicked', () => {
    const view: OnboardingView = {
      prompt: { id: 'run.dash', group: 'controls', keys: ['Shift'], text: 'Dash. It passes through danger.', shownAtMs: 0, expiresAtMs: 1000 },
      notes: [], hintsOff: false,
    };
    const html = render(createElement(CoachPrompt, { bus: fakeBus(view) }));
    expect(html).toContain('<kbd class="keycap coach__key">Shift</kbd>');
    expect(html).toContain('Dash. It passes through danger.');
    expect(html).toContain('coach__line--controls');
    expect(html).toContain('data-coach="run.dash"');
  });

  it('shows nothing at all when hints are off', () => {
    // The engine is the one that nulls the prompt; the band only has to not invent one.
    const html = render(createElement(CoachPrompt, { bus: fakeBus({ prompt: null, notes: [], hintsOff: true }) }));
    expect(html).not.toContain('coach__line');
  });
});

describe('Field Notes page', () => {
  it('is registered as a menu page', () => {
    expect(MENU_PAGES).toContain('fieldnotes');
    expect(MENU_PAGES.length).toBeLessThanOrEqual(9); // installMenuKeyboard binds Digit1..Digit9
  });

  it('says so plainly when nothing has been shown yet, and spoils nothing', () => {
    const html = render(createElement(FieldNotesPage, { bus: fakeBus({ prompt: null, notes: [], hintsOff: false }) }));
    expect(html).toContain('Nothing yet.');
    expect(html).not.toContain('???');
    expect(html).not.toContain('fieldnotes__row');
  });

  it('groups the notes it has, and lists no note it has not', () => {
    const view: OnboardingView = {
      prompt: null,
      hintsOff: false,
      notes: [
        note({ id: 'run.dash', group: 'controls', keys: ['Shift'], text: 'Dash. It passes through danger.' }),
        note({ id: 'note.terrain.pits', group: 'terrain', text: 'Open pit: dash across, or knock something in' }),
        note({ id: 'note.room.rest', group: 'rooms', text: 'Rest room. One heal waits here.' }),
      ],
    };
    const html = render(createElement(FieldNotesPage, { bus: fakeBus(view) }));
    expect(html).toContain('Controls');
    expect(html).toContain('Terrain');
    expect(html).toContain('Rooms');
    expect(html).not.toContain('World laws'); // no law has been met
    expect(html).not.toContain('Headquarters');
    expect(html).toContain('Open pit: dash across, or knock something in');
    expect(html).toContain('3 notes');
  });

  it('carries the off switch and the reset', () => {
    const on = render(createElement(FieldNotesPage, { bus: fakeBus({ prompt: null, notes: [], hintsOff: false }) }));
    expect(on).toContain('Hints on');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('Show every hint again');
    const off = render(createElement(FieldNotesPage, { bus: fakeBus({ prompt: null, notes: [], hintsOff: true }) }));
    expect(off).toContain('Hints off');
    expect(off).toContain('aria-pressed="false"');
  });
});
