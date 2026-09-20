import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardMouseInput } from '../../src/client/game/input';
import { focusMenu, installMenuKeyboard } from '../../src/client/game/keyboardFocus';

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parentElement: ElementStub | null = null;
  inert = false;
  isConnected = true;
  attributes = new Map<string, string>();

  constructor(readonly tagName: string) { super(); }
  append(child: ElementStub): ElementStub {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  contains(target: ElementStub): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }
  matches(selector: string): boolean {
    if (!selector.startsWith('[')) return this.tagName.toLowerCase() === selector;
    const match = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(selector)!;
    if (selector.includes(':not') && this.attributes.get(match[1]!) === 'false') return false;
    return this.attributes.has(match[1]!) && (match[2] === undefined || this.attributes.get(match[1]!) === match[2]);
  }
  closest(selectors: string): ElementStub | null {
    return selectors.split(', ').some((selector) => this.matches(selector)) ? this : this.parentElement?.closest(selectors) ?? null;
  }
  querySelector(selector: string): ElementStub | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  focus(): void {
    dom.activeElement = this;
    dispatch('focusin', this);
  }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

let dom: { body: ElementStub; activeElement: ElementStub; querySelector: (selector: string) => ElementStub | null };
let events: EventTarget;
const disposers: Array<() => void> = [];
const element = (stub: ElementStub) => stub as unknown as HTMLElement;
function dispatch(type: string, target: ElementStub, properties: Record<string, string | number | boolean> = {}): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.assign(event, { repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...properties });
  events.dispatchEvent(event);
  return event;
}
function keyboard(target: ElementStub, code: string, shiftKey = false): Event {
  return dispatch('keydown', target, { code, shiftKey });
}
function stage(): ElementStub {
  const result = dom.body.append(new ElementStub('DIV'));
  result.attributes.set('data-game-stage', '');
  return result;
}

beforeEach(() => {
  events = new EventTarget();
  const body = new ElementStub('BODY');
  dom = { body, activeElement: body, querySelector: (selector) => body.querySelector(selector) };
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('window', events);
  vi.stubGlobal('document', dom);
});
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  vi.unstubAllGlobals();
});

describe('production keyboard listeners', () => {
  function pointerDown(game: ElementStub, button = 0): void {
    const event = new Event('pointerdown');
    Object.defineProperty(event, 'target', { value: game });
    Object.assign(event, { button, clientX: 10, clientY: 20 });
    game.dispatchEvent(event);
  }

  it('repeats held mouse attacks until release outside the stage without repeating dash or abilities', () => {
    const game = stage();
    const sampler = createKeyboardMouseInput(element(game));
    disposers.push(sampler.dispose);
    pointerDown(game);
    keyboard(game, 'Space');
    keyboard(game, 'KeyQ');
    expect(sampler.sample({ x: 0, y: 0 })).toMatchObject({ attack: true, dash: true, ability: 'q' });
    expect(sampler.sample({ x: 0, y: 0 })).toMatchObject({ attack: true, dash: false, ability: null });
    dispatch('pointerup', dom.body, { button: 2 });
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(true);
    dispatch('pointerup', dom.body, { button: 0 });
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(false);
  });

  it('retains a fast click between samples without treating right click as attack', () => {
    const game = stage();
    const sampler = createKeyboardMouseInput(element(game));
    disposers.push(sampler.dispose);
    pointerDown(game, 2);
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(false);
    pointerDown(game);
    dispatch('pointerup', dom.body, { button: 0 });
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(true);
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(false);
  });

  it.each(['blur', 'pointercancel', 'focus', 'dispose'])('stops held attacks on %s', (action) => {
    const game = stage();
    const sampler = createKeyboardMouseInput(element(game));
    disposers.push(sampler.dispose);
    pointerDown(game);
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(true);
    if (action === 'focus') dom.body.append(new ElementStub('BUTTON')).focus();
    else if (action === 'dispose') sampler.dispose();
    else dispatch(action, game);
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(false);
  });

  it('preserves initial body focus and native button Tab/Shift+Tab, opening only from the stage', () => {
    const game = stage();
    const button = dom.body.append(new ElementStub('BUTTON'));
    const open = vi.fn();
    disposers.push(installMenuKeyboard({ isOpen: () => false, menu: () => null, open, close: vi.fn(), selectPage: vi.fn() }));
    expect(keyboard(dom.body, 'Tab').defaultPrevented).toBe(false);
    expect(keyboard(button, 'Tab').defaultPrevented).toBe(false);
    expect(keyboard(button, 'Tab', true).defaultPrevented).toBe(false);
    expect(keyboard(game, 'Tab', true).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    game.focus();
    expect(keyboard(game, 'Tab').defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith();
  });

  it('moves focus into the modal and leaves native Tab/Shift+Tab/Space intact while it is open', () => {
    const game = stage();
    const menu = dom.body.append(new ElementStub('DIV'));
    const page = menu.append(new ElementStub('BUTTON'));
    page.attributes.set('aria-current', 'page');
    const closeButton = menu.append(new ElementStub('BUTTON'));
    const close = vi.fn();
    disposers.push(installMenuKeyboard({ isOpen: () => true, menu: () => element(menu), open: vi.fn(), close, selectPage: vi.fn() }));
    game.focus();
    const restoreFocus = focusMenu(element(menu));
    expect(dom.activeElement).toBe(page);
    expect(game.inert).toBe(true);
    expect(menu.inert).toBe(false);
    expect(keyboard(page, 'Tab').defaultPrevented).toBe(false);
    expect(keyboard(closeButton, 'Tab', true).defaultPrevented).toBe(false);
    expect(keyboard(closeButton, 'Space').defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(keyboard(closeButton, 'Escape').defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    restoreFocus();
    expect(game.inert).toBe(false);
    expect(dom.activeElement).toBe(game);
  });

  it('restores a clicked menu trigger and the prior inert state of other content', () => {
    const root = dom.body.append(new ElementStub('DIV'));
    const trigger = root.append(new ElementStub('BUTTON'));
    const inertSibling = dom.body.append(new ElementStub('DIV'));
    inertSibling.inert = true;
    const menu = dom.body.append(new ElementStub('DIV'));
    trigger.focus();
    const restoreFocus = focusMenu(element(menu));
    expect(root.inert).toBe(true);
    expect(dom.activeElement).toBe(menu);
    restoreFocus();
    expect(root.inert).toBe(false);
    expect(inertSibling.inert).toBe(true);
    expect(dom.activeElement).toBe(trigger);
  });

  it('keeps page shortcuts inside the menu and does not steal numbers from editable fields', () => {
    const game = stage();
    const menu = dom.body.append(new ElementStub('DIV'));
    const input = menu.append(new ElementStub('INPUT'));
    const page = menu.append(new ElementStub('BUTTON'));
    page.attributes.set('data-menu-page', '2');
    const selectPage = vi.fn();
    disposers.push(installMenuKeyboard({ isOpen: () => true, menu: () => element(menu), open: vi.fn(), close: vi.fn(), selectPage }));
    expect(keyboard(game, 'Digit3').defaultPrevented).toBe(false);
    expect(keyboard(input, 'Digit3').defaultPrevented).toBe(false);
    expect(selectPage).not.toHaveBeenCalled();
    expect(keyboard(menu, 'Digit3').defaultPrevented).toBe(true);
    expect(selectPage).toHaveBeenCalledExactlyOnceWith(2);
    expect(dom.activeElement).toBe(page);
  });

  it('never prevents UI button Space or queues a dash, retaining Space dash on the game stage', () => {
    const game = stage();
    const button = dom.body.append(new ElementStub('BUTTON'));
    const nestedButton = game.append(new ElementStub('BUTTON'));
    const label = nestedButton.append(new ElementStub('SPAN'));
    const sampler = createKeyboardMouseInput(element(game));
    disposers.push(sampler.dispose);
    for (const target of [dom.body, button, nestedButton, label]) {
      target.focus();
      expect(keyboard(target, 'Space').defaultPrevented).toBe(false);
      expect(sampler.sample({ x: 0, y: 0 }).dash).toBe(false);
    }
    game.focus();
    expect(keyboard(game, 'Space').defaultPrevented).toBe(true);
    expect(sampler.sample({ x: 0, y: 0 }).dash).toBe(true);
    expect(sampler.sample({ x: 0, y: 0 }).dash).toBe(false);
  });

  it('clears held movement and queued abilities as focus moves from the stage to UI', () => {
    const game = stage();
    const button = dom.body.append(new ElementStub('BUTTON'));
    const sampler = createKeyboardMouseInput(element(game));
    disposers.push(sampler.dispose);
    game.focus();
    keyboard(game, 'KeyW');
    keyboard(game, 'KeyQ');
    keyboard(game, 'Space');
    button.focus();
    expect(sampler.sample({ x: 0, y: 0 })).toMatchObject({ moveX: 0, moveY: 0, dash: false, attack: false, ability: null });
    expect(keyboard(button, 'KeyW').defaultPrevented).toBe(false);
    expect(keyboard(button, 'KeyQ').defaultPrevented).toBe(false);
  });

  it('focuses the stage on pointer play and removes the listeners on disposal', () => {
    const game = stage();
    const canvas = game.append(new ElementStub('CANVAS'));
    const sampler = createKeyboardMouseInput(element(game));
    const event = new Event('pointerdown');
    Object.defineProperty(event, 'target', { value: canvas });
    Object.assign(event, { button: 0, clientX: 10, clientY: 20 });
    game.dispatchEvent(event);
    expect(dom.activeElement).toBe(game);
    expect(sampler.sample({ x: 0, y: 0 }).attack).toBe(true);
    expect(sampler.getPointer()).toEqual({ x: 10, y: 20 });
    sampler.dispose();
    expect(keyboard(game, 'Space').defaultPrevented).toBe(false);
    expect(sampler.sample({ x: 0, y: 0 }).dash).toBe(false);
  });
});
