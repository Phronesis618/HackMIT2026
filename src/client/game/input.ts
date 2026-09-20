/**
 * Keyboard + mouse -> LocalIntent. Owner: Agent A (controllers).
 * Bindings are the shared INPUT_BINDINGS; mouse attacks repeat while held.
 */
import { INPUT_BINDINGS } from '../../shared/conventions';
import type { LocalIntent } from '../../shared/session';
import { stageOwnsInput } from './keyboardFocus';

export interface InputSampler {
  /** Produce the intent for this frame. `aim` is the current pointer in world coords. */
  sample(aim: { x: number; y: number }): LocalIntent;
  getPointer(): { x: number; y: number } | null; // canvas-relative pixels
  dispose(): void;
}

export function createKeyboardMouseInput(stage: HTMLElement): InputSampler {
  const down = new Set<string>();
  let attackPressed = false;
  let attackHeld = false;
  let dashPressed = false;
  let abilityPressed: 'q' | 'e' | 'r' | null = null;
  let pointer: { x: number; y: number } | null = null;

  const matches = (code: string, list: readonly string[]) => list.includes(code);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !stageOwnsInput(e.target, stage)) return;
    const all = Object.values(INPUT_BINDINGS).flat() as readonly string[];
    if (!all.includes(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    if (matches(e.code, INPUT_BINDINGS.attack)) attackPressed = true;
    if (matches(e.code, INPUT_BINDINGS.dash)) dashPressed = true;
    if (matches(e.code, INPUT_BINDINGS.abilityQ)) abilityPressed = 'q';
    if (matches(e.code, INPUT_BINDINGS.abilityE)) abilityPressed = 'e';
    if (matches(e.code, INPUT_BINDINGS.abilityR)) abilityPressed = 'r';
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => {
    down.clear();
    attackPressed = false;
    attackHeld = false;
    dashPressed = false;
    abilityPressed = null;
  };
  const onFocus = (event: FocusEvent): void => {
    if (!stageOwnsInput(event.target, stage)) onBlur();
  };
  const onPointerMove = (e: PointerEvent): void => {
    const rect = (stage.querySelector('canvas') ?? stage).getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (!stageOwnsInput(e.target, stage)) return;
    stage.focus({ preventScroll: true });
    if (e.button === 0) {
      attackPressed = true;
      attackHeld = true;
      onPointerMove(e);
    }
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) attackHeld = false;
  };
  const onPointerCancel = (): void => { attackHeld = false; };
  const onContextMenu = (e: Event): void => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focusin', onFocus);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('contextmenu', onContextMenu);

  const axis = (neg: readonly string[], pos: readonly string[]): number =>
    (pos.some((c) => down.has(c)) ? 1 : 0) - (neg.some((c) => down.has(c)) ? 1 : 0);

  return {
    sample(aim) {
      const intent: LocalIntent = {
        moveX: axis(INPUT_BINDINGS.moveLeft, INPUT_BINDINGS.moveRight),
        moveY: axis(INPUT_BINDINGS.moveUp, INPUT_BINDINGS.moveDown),
        aimX: aim.x,
        aimY: aim.y,
        attack: attackPressed || attackHeld,
        dash: dashPressed,
        ability: abilityPressed,
        interact: INPUT_BINDINGS.interact.some((code) => down.has(code)),
      };
      attackPressed = false;
      dashPressed = false;
      abilityPressed = null;
      return intent;
    },
    getPointer: () => pointer,
    dispose() {
      onBlur();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

/**
 * Hold-to-show keys that are NOT gameplay intents (agent F3: `KeyM` = full floor map).
 * Kept out of INPUT_BINDINGS on purpose: the sim never sees them. Returns a disposer.
 */
export const FULL_MAP_KEYS: readonly string[] = ['KeyM'];

/** Typing into a field must never toggle a hold key. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function createHoldKey(codes: readonly string[], onChange: (held: boolean) => void): () => void {
  let held = false;
  const set = (next: boolean): void => {
    if (next === held) return;
    held = next;
    onChange(held);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
    if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !codes.includes(e.code)) return;
    set(true);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (codes.includes(e.code)) set(false);
  };
  const onBlur = (): void => set(false);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
