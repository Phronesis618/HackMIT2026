import type { Palette } from '../../shared/contracts';
/** Small colour helpers for procedural art (hex strings <-> Phaser ints, mixing, hue shifts). */

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToInt(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export function hexInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Linear mix between two hex colours, t in [0, 1]. Returns a Phaser int. */
export function mix(a: string, b: string, t: number): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToInt(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}

export function lighten(hex: string, t: number): number {
  return mix(hex, '#ffffff', t);
}

export function darken(hex: string, t: number): number {
  return mix(hex, '#000000', t);
}

/** Rotate hue by `degrees`, optionally boosting saturation/lightness. Returns a Phaser int. */
export function shiftHue(hex: string, degrees: number, satBoost = 0, lightBoost = 0): number {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const hh = (((h + degrees / 360) % 1) + 1) % 1;
  const ss = Math.max(0, Math.min(1, s + satBoost));
  const ll = Math.max(0, Math.min(1, l + lightBoost));
  const [rr, gg, bb] = hslToRgb(hh, ss, ll);
  return rgbToInt(rr, gg, bb);
}

export function intToHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Perceived luminance 0..1 (Rec. 709 on gamma-encoded channels: good enough to compare values). */
export function luminance(color: string | number): number {
  const { r, g, b } = hexToRgb(typeof color === 'number' ? intToHex(color) : color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The colour of everything that is not the room. Also the camera background. */
export const VOID_COLOR = '#04050a';

/**
 * One visual language for "you cannot walk here", derived so it survives every palette and
 * floor material: the top face is always clearly LIGHTER than the floor, the south-facing
 * front face clearly DARKER, and the outline near-black.
 */
export interface SolidColors { cap: number; capDeep: number; capHi: number; face: number; faceLow: number; outline: number; rim: number }
export function solidColors(palette: Pick<Palette, 'floor' | 'floorAlt' | 'wall' | 'wallEdge' | 'text' | 'background'>): SolidColors {
  const floorL = Math.max(luminance(palette.floor), luminance(palette.floorAlt));
  let t = 0.22;
  let cap = mix(palette.wall, palette.text, t);
  while (luminance(cap) < floorL + 0.17 && t < 0.7) {
    t += 0.04;
    cap = mix(palette.wall, palette.text, t);
  }
  const capHex = intToHex(cap);
  return {
    cap,
    capDeep: darken(capHex, 0.22),
    capHi: lighten(capHex, 0.22),
    face: darken(capHex, 0.5),
    faceLow: darken(capHex, 0.72),
    outline: darken(palette.background, 0.55),
    rim: hexInt(palette.wallEdge),
  };
}

// ---------------------------------------------------------------------------
// Palette families + the contrast clamp (agent M1, docs/design/WORLD_MUTATORS.md §5.2)
// ---------------------------------------------------------------------------

export type PaletteFamilyId = 'ink_neon' | 'bleach' | 'rust' | 'bloom' | 'monochrome' | 'sodium';

/** Hue in degrees, saturation and lightness 0..1. */
export function toHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return { h: h * 360, s, l };
}

export function fromHsl(h: number, s: number, l: number): string {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const [r, g, b] = hslToRgb((((h % 360) + 360) % 360) / 360, clamp01(s), clamp01(l));
  return intToHex(rgbToInt(r, g, b));
}

/** Smallest angle between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Moves `hue` a share `t` of the short way round toward `target`. */
function pullHue(hue: number, target: number, t: number): number {
  const delta = ((target - hue + 540) % 360) - 180;
  return hue + delta * t;
}

type PaletteKey = keyof Palette;
const PALETTE_KEYS: PaletteKey[] = ['background', 'floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'accentSoft', 'glow', 'hazard', 'text'];

/**
 * A family is a trusted post-transform of the world's ten colours: the model (or a fixture)
 * still picks the hues, the family decides what kind of light they are seen in. `hazard` is
 * never transformed: danger has one visual language in every world. Always follow with
 * `clampPaletteContrast`.
 */
export function applyPaletteFamily(palette: Palette, family: PaletteFamilyId): Palette {
  if (family === 'ink_neon') return palette;
  const each = (fn: (key: PaletteKey, c: { h: number; s: number; l: number }) => { h: number; s: number; l: number }): Palette => {
    const out = { ...palette };
    for (const key of PALETTE_KEYS) {
      if (key === 'hazard') continue;
      const next = fn(key, toHsl(palette[key]));
      out[key] = fromHsl(next.h, next.s, next.l);
    }
    return out;
  };
  const isFloor = (key: PaletteKey) => key === 'floor' || key === 'floorAlt';
  switch (family) {
    case 'bleach':
      // Sun-bleached daytime: pale, chalky ground, washed structure, colour only in the accents.
      return each((key, c) => key === 'accent' || key === 'glow' ? { ...c, s: c.s * 0.8, l: Math.min(c.l, 0.62) }
        : key === 'text' ? c
        : isFloor(key) ? { h: pullHue(c.h, 45, 0.9), s: c.s * 0.3, l: c.l + 0.24 }
        : key === 'background' ? { ...c, s: c.s * 0.5, l: c.l + 0.06 }
        : { h: pullHue(c.h, 45, 0.3), s: c.s * 0.45, l: c.l + 0.16 });
    case 'rust':
      // Oxidised: everything drifts to iron-orange, blues are crushed.
      return each((key, c) => {
        const blue = c.h >= 180 && c.h <= 260;
        const pull = key === 'text' ? 0.3 : 0.94;
        return { h: pullHue(c.h, key === 'accent' || key === 'glow' ? 38 : 22, pull), s: Math.max(0, (blue ? c.s * 0.75 : c.s) + (isFloor(key) || key === 'wall' ? 0.08 : 0)), l: c.l };
      });
    case 'bloom':
      // Wet and luminous: saturation up everywhere, the glow runs hot.
      return each((key, c) => ({ h: c.h, s: c.s + (key === 'text' ? 0 : 0.25), l: key === 'glow' ? c.l + (1 - c.l) * 0.3 : isFloor(key) ? c.l + 0.03 : c.l }));
    case 'monochrome': {
      // Printed: greys on the accent's hue. Only the hazard keeps its colour.
      const hue = toHsl(palette.accent).h;
      return each((key, c) => ({ h: hue, s: key === 'accent' || key === 'glow' ? 0.1 : 0.05, l: key === 'accent' || key === 'glow' ? Math.max(c.l, 0.8) : key === 'accentSoft' || key === 'wallEdge' ? Math.max(c.l, 0.6) : c.l }));
    }
    case 'sodium':
      // Streetlight at night: low-saturation amber, the soft accent becomes the dominant light.
      return each((key, c) => key === 'accentSoft' || key === 'accent' || key === 'glow' || key === 'wallEdge'
        ? { h: pullHue(c.h, key === 'accent' ? 40 : 32, 0.95), s: Math.max(c.s, 0.75), l: key === 'wallEdge' ? c.l : Math.max(c.l, 0.62) }
        : { h: pullHue(c.h, 26, 0.95), s: c.s * 0.6, l: key === 'text' ? c.l : c.l * 0.92 });
  }
}

/** Brogue's threshold and its luminance-weighted distance, channels in 0..255. */
export const MIN_COLOR_DIFF = 600;
export function colorDiff(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return 0.2126 * (ca.r - cb.r) ** 2 + 0.7152 * (ca.g - cb.g) ** 2 + 0.0722 * (ca.b - cb.b) ** 2;
}

export const MIN_HAZARD_HUE_GAP = 30;
/** [foreground, background]: the foreground member is the one that moves. */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [PaletteKey, PaletteKey]> = [
  ['hazard', 'floor'], ['hazard', 'floorAlt'], ['accent', 'floor'], ['accent', 'floorAlt'],
  ['text', 'background'], ['wallEdge', 'wall'],
];

/**
 * Readability is not a style choice: after ANY family or biome turn, hazards, telegraphs
 * (they draw in `hazard`), accents, text and wall rims must separate from what is behind them.
 * Brogue's `separateColors`: average the foreground 20% toward whichever of black/white is
 * further from the background, at most 10 times. The accent also keeps 30 degrees of hue from
 * the hazard, and it is the accent that moves: danger keeps its colour.
 */
export function clampPaletteContrast(palette: Palette): Palette {
  const out = { ...palette };
  // Accent vs hazard separate by HUE (pushing the accent's value around would only fight the
  // floor pair below): widen the gap until the two read as different colours.
  const hazard = toHsl(out.hazard);
  for (const key of ['accent', 'glow'] as const) {
    const c = toHsl(out[key]);
    if (c.s < 0.12 || hazard.s < 0.12) continue;
    const away = ((c.h - hazard.h + 540) % 360) - 180 >= 0 ? 1 : -1;
    for (let gap = MIN_HAZARD_HUE_GAP + 6, i = 0; i < 10 && (hueDistance(toHsl(out[key]).h, hazard.h) < MIN_HAZARD_HUE_GAP || colorDiff(out[key], out.hazard) < MIN_COLOR_DIFF); i++, gap += 12) {
      out[key] = fromHsl(hazard.h + away * gap, c.s, c.l);
    }
  }
  for (const [fg, bg] of CONTRAST_PAIRS) {
    for (let i = 0; i < 10 && colorDiff(out[fg], out[bg]) < MIN_COLOR_DIFF; i++) {
      out[fg] = intToHex(mix(out[fg], luminance(out[bg]) < 0.5 ? '#ffffff' : '#000000', 0.2));
    }
  }
  // Two muddy colours no hue turn can part: walk the accent further from the floor, which can
  // only help the floor pairs above.
  for (let i = 0; i < 10 && colorDiff(out.accent, out.hazard) < MIN_COLOR_DIFF; i++) {
    out.accent = intToHex(mix(out.accent, luminance(out.floor) < 0.5 ? '#ffffff' : '#000000', 0.2));
  }
  return out;
}

/** The one entry point renderers use: family, then the clamp. */
export function lookPalette(palette: Palette, family: PaletteFamilyId): Palette {
  return clampPaletteContrast(applyPaletteFamily(palette, family));
}
