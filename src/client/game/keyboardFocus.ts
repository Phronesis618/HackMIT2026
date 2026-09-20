const INTERACTIVE_TARGETS = 'button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="combobox"], [role="slider"], [role="tab"]';

export function stageOwnsInput(target: EventTarget | null, stage: HTMLElement | null): boolean {
  return target instanceof HTMLElement && stage !== null
    && stage.contains(target) && !target.closest(INTERACTIVE_TARGETS);
}

export function installMenuKeyboard(options: {
  isOpen: () => boolean;
  menu: () => HTMLElement | null;
  open: () => void;
  close: () => void;
  selectPage: (index: number) => void;
}): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (!options.isOpen()) {
      if (event.code === 'Tab' && !event.shiftKey && stageOwnsInput(event.target, document.querySelector('[data-game-stage]'))) {
        event.preventDefault();
        options.open();
      }
      return;
    }
    const menu = options.menu();
    // A focused control that unmounts (e.g. "Unlock" once bought) drops focus to <body>: Escape must still close.
    if (event.code === 'Escape' && event.target === document.body) {
      event.preventDefault();
      options.close();
      return;
    }
    if (!(event.target instanceof HTMLElement) || !menu?.contains(event.target)) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      options.close();
      return;
    }
    if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    // One digit per menu page; the page list lives in GameMenu.tsx and has grown before.
    const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(event.code);
    if (index >= 0 && !menu.querySelector(`[data-menu-page="${index}"]`)) return;
    if (index >= 0) {
      event.preventDefault();
      options.selectPage(index);
      menu.querySelector<HTMLElement>(`[data-menu-page="${index}"]`)?.focus();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export function focusMenu(menu: HTMLElement): () => void {
  const previous = document.activeElement;
  const background: Array<{ element: HTMLElement; inert: boolean }> = [];
  for (let branch: HTMLElement = menu; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling instanceof HTMLElement && sibling !== branch) {
        background.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    if (branch.parentElement === document.body) break;
  }
  (menu.querySelector<HTMLElement>('[aria-current="page"]') ?? menu).focus();
  return () => {
    for (const { element, inert } of background) element.inert = inert;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    else document.querySelector<HTMLElement>('[data-game-stage]')?.focus();
  };
}
