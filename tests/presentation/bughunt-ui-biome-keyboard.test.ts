import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BiomeChoice } from '../../src/client/ui/BiomeChoice';
import type { UiBiomeChoice } from '../../src/shared/ui';

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useRef: (initial: unknown) => {
      const ref = react.useRef(initial);
      hooks.refs.push(ref);
      return ref;
    },
  };
});

class ElementStub {
  parentElement: ElementStub | null = null;
  constructor(readonly tagName: string, readonly attributes: Record<string, string> = {}) {}
  contains(target: ElementStub): boolean {
    return target === this || (target.parentElement !== null && this.contains(target.parentElement));
  }
  closest(selectors: string): ElementStub | null {
    const matches = selectors.split(',').some((raw) => {
      const selector = raw.trim();
      if (selector.startsWith('[contenteditable]')) return this.attributes.contenteditable !== undefined && this.attributes.contenteditable !== 'false';
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(selector);
      if (attr) return this.attributes[attr[1]!] !== undefined && (attr[2] === undefined || this.attributes[attr[1]!] === attr[2]);
      return selector.toLowerCase() === this.tagName.toLowerCase();
    });
    return matches ? this : this.parentElement?.closest(selectors) ?? null;
  }
}

const choice: UiBiomeChoice = {
  options: ['test-east', 'test-west'].map((biomeId) => ({
    biomeId, name: biomeId, tagline: 'Test biome', depth: 2, depthCount: 5,
    roomCount: 15, layout: 'Test layout', enemies: [], motifs: [], hazards: false,
  })),
  confirmOnly: false, votes: [], hostPlayerId: 'test-host', hostName: 'Test Host', canPick: true,
};

let events: EventTarget;
let stage: ElementStub;
let dialog: ElementStub;
const disposers: Array<() => void> = [];

beforeEach(() => {
  events = new EventTarget();
  stage = new ElementStub('DIV', { 'data-game-stage': '' });
  dialog = new ElementStub('DIV');
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', { querySelector: () => stage });
  hooks.effects.length = 0;
  hooks.refs.length = 0;
});

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});

function mount(canPick = true) {
  const onChoose = vi.fn();
  renderToStaticMarkup(createElement(BiomeChoice, {
    choice: { ...choice, canPick }, fromBiomeName: 'Test origin', localPlayerId: 'test-host', onChoose,
  }));
  hooks.refs.forEach((ref) => { ref.current = dialog; });
  for (const effect of hooks.effects) {
    const dispose = effect();
    if (dispose) disposers.push(dispose);
  }
  return onChoose;
}

function key(target: ElementStub, code: string, properties: Record<string, boolean> = {}, consumed = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.assign(event, { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...properties });
  if (consumed) event.preventDefault();
  events.dispatchEvent(event);
  return event;
}

describe('biome choice focus ownership', () => {
  it.each(['Digit1', 'Digit2', 'Enter'])('does not commit a route for %s in the expedition menu', (code) => {
    const onChoose = mount();
    const tab = new ElementStub('BUTTON', { 'data-menu-page': '0' });
    key(tab, code);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('does not hijack Enter on unrelated controls or editable descendants', () => {
    const onChoose = mount();
    key(new ElementStub('BUTTON'), 'Enter');
    const editor = new ElementStub('DIV', { contenteditable: 'true' });
    const text = new ElementStub('SPAN');
    text.parentElement = editor;
    key(text, 'Digit1');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat'])('ignores %s shortcuts on the stage', (modifier) => {
    const onChoose = mount();
    key(stage, 'Digit1', { [modifier]: true });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('ignores an event already consumed by another control', () => {
    const onChoose = mount();
    key(stage, 'Digit1', {}, true);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('chooses from the game stage and consumes the handled shortcut', () => {
    const onChoose = mount();
    expect(key(stage, 'Digit2').defaultPrevented).toBe(true);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('test-west');
  });

  it('consumes Enter on a focused choice to prevent a second native click', () => {
    const onChoose = mount();
    const button = new ElementStub('BUTTON', { 'data-biome': 'test-east' });
    button.parentElement = dialog;
    expect(key(button, 'Enter').defaultPrevented).toBe(true);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('test-east');
  });

  it('never lets a guest choose a route', () => {
    const onChoose = mount(false);
    key(stage, 'Digit1');
    expect(onChoose).not.toHaveBeenCalled();
  });
});
