/**
 * Visual tokens shared by the Phaser renderer and the React UI.
 *
 * Ownership split:
 *  - design/tokens.json  VALUES  -> Agent C may tune freely (colours, glows, fonts).
 *  - this file           KEYS    -> Agent A approves changes (adding/removing a key is
 *                                   an interface change; tests/shared validates the JSON).
 */
import { z } from 'zod';
import rawTokens from '../../design/tokens.json';
import { HexColor } from './contracts';

const px = z.number().int().nonnegative();

export const VisualTokensSchema = z.object({
  $schema: z.string().optional(),
  color: z.object({
    ink900: HexColor,
    ink800: HexColor,
    ink700: HexColor,
    ink600: HexColor,
    ink500: HexColor,
    mist300: HexColor,
    mist100: HexColor,
    neonCyan: HexColor,
    neonCyanSoft: HexColor,
    neonCoral: HexColor,
    neonViolet: HexColor,
    neonLime: HexColor,
    warmLamp: HexColor,
    danger: HexColor,
    success: HexColor,
  }),
  font: z.object({ display: z.string(), body: z.string(), mono: z.string() }),
  space: z.object({ xs: px, sm: px, md: px, lg: px, xl: px }),
  radius: z.object({ sm: px, md: px, lg: px, pill: px }),
  glow: z.object({ portal: z.string(), panel: z.string(), accent: z.string() }),
  motion: z.object({ fastMs: px, baseMs: px, slowMs: px }),
  canvas: z.object({
    defaultWidth: px,
    defaultHeight: px,
    playerOutline: HexColor,
    localPlayerAccent: HexColor,
    remotePlayerAccent: HexColor,
    enemyAccent: HexColor,
    telegraph: HexColor,
  }),
});
export type VisualTokens = z.infer<typeof VisualTokensSchema>;

/** Validated at import time so a broken tokens.json fails loudly in dev and tests. */
export const tokens: VisualTokens = VisualTokensSchema.parse(rawTokens);

/** "#7cf5ff" -> 0x7cf5ff for Phaser fill/stroke APIs. */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Flatten tokens to CSS custom properties, e.g. --color-ink900, --space-md (px),
 * --font-body. Applied to :root by the client at startup (src/client/styles).
 */
export function tokensToCssVariables(t: VisualTokens = tokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.color)) out[`--color-${k}`] = v;
  for (const [k, v] of Object.entries(t.font)) out[`--font-${k}`] = v;
  for (const [k, v] of Object.entries(t.space)) out[`--space-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(t.radius)) out[`--radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(t.glow)) out[`--glow-${k}`] = v;
  for (const [k, v] of Object.entries(t.motion)) out[`--motion-${k}`] = `${v}ms`;
  return out;
}
