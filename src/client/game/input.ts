/**
 * Keyboard + mouse -> LocalIntent. Owner: Agent A (controllers).
 * Bindings are the shared INPUT_BINDINGS; buttons are edge-triggered per sample.
 */
import { INPUT_BINDINGS } from '../../shared/conventions';
import type { LocalIntent } from '../../shared/session';

export interface InputSampler {
  /** Produce the intent for this frame. `aim` is the current pointer in world coords. */
  sample(aim: { x: number; y: number }): LocalIntent;
  getPointer(): { x: number; y: number } | null; // canvas-relative pixels
  dispose(): void;
}

const isTextTarget = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function createKeyboardMouseInput(stage: HTMLElement): InputSampler {
  const down = new Set<string>();
  let attackPressed = false;
  let dashPressed = false;
  let abilityPressed: 'q' | 'e' | null = null;
  let pointer: { x: number; y: number } | null = null;

  const matches = (code: string, list: readonly string[]) => list.includes(code);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTextTarget(e.target)) return;
    const all = Object.values(INPUT_BINDINGS).flat() as readonly string[];
    if (!all.includes(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    if (matches(e.code, INPUT_BINDINGS.attack)) attackPressed = true;
    if (matches(e.code, INPUT_BINDINGS.dash)) dashPressed = true;
    if (matches(e.code, INPUT_BINDINGS.abilityQ)) abilityPressed = 'q';
    if (matches(e.code, INPUT_BINDINGS.abilityE)) abilityPressed = 'e';
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => {
    down.clear();
    attackPressed = false;
    dashPressed = false;
    abilityPressed = null;
  };
  const onFocus = (event: FocusEvent): void => {
    if (isTextTarget(event.target)) onBlur();
  };
  const onPointerMove = (e: PointerEvent): void => {
    const rect = stage.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) {
      attackPressed = true;
      onPointerMove(e);
    }
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focusin', onFocus);
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
        attack: attackPressed,
        dash: dashPressed,
        ability: abilityPressed,
      };
      attackPressed = false;
      dashPressed = false;
      abilityPressed = null;
      return intent;
    },
    getPointer: () => pointer,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focusin', onFocus);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
