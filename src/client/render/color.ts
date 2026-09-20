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
