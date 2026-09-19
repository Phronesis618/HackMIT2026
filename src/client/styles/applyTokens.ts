import { tokensToCssVariables } from '../../shared/tokens';

/** Push design/tokens.json onto :root as CSS custom properties (single source of truth). */
export function applyTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(tokensToCssVariables())) root.style.setProperty(name, value);
}
