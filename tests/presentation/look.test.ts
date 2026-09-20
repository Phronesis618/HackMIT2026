import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Palette } from '../../src/shared/contracts';
import { LIGHTING_IDS, PALETTE_FAMILY_IDS } from '../../src/shared/laws';
import {
  CONTRAST_PAIRS, MIN_COLOR_DIFF, MIN_HAZARD_HUE_GAP, applyPaletteFamily, clampPaletteContrast, colorDiff, hueDistance, intToHex,
  lookPalette, luminance, shiftHue, toHsl,
} from '../../src/client/render/color';
import { litSolidColors } from '../../src/client/render/environment';
import { DARKNESS_ALPHA, LIGHTING, fixedLights, isLit } from '../../src/client/render/lighting';
import { withLookOverrides } from '../../src/client/render/lookOverrides';

const fixturePalette = (name: string): Palette => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../fixtures/worlds/${name}.json`), 'utf8')).art.palette;
const base = fixturePalette('vantage-spire');
/** The three fixtures, F3's stress palettes (floors-doors.test.ts), and two hostile model outputs. */
const PALETTES: Palette[] = [
  base, fixturePalette('crystal-tide'), fixturePalette('root-archive'),
  { ...base, floor: '#d8d2c0', floorAlt: '#cfc8b4', wall: '#3a3a44', text: '#ffffff' },
  { ...base, floor: '#101018', floorAlt: '#14141e', wall: '#0c0c12', text: '#e8e8f0' },
  { ...base, floor: '#3d5a3a', floorAlt: '#46643f', wall: '#2b3a2a', text: '#f0fff0' },
  { ...base, floor: '#2a5f5c', floorAlt: '#2c6360', hazard: '#2f6a66', accent: '#336e6a', wallEdge: '#2c4266' }, // muddy teal everything
  { ...base, accent: '#ff5c70', glow: '#ff5c70' }, // accent sitting on the hazard's hue
];
/** F3's per-biome turn: up to +-36 degrees on everything but hazard/glow/text/background. */
const turn = (p: Palette, degrees: number): Palette => ({
  ...p, ...Object.fromEntries((['floor', 'floorAlt', 'wall', 'wallEdge', 'accent', 'accentSoft'] as const).map((key) => [key, intToHex(shiftHue(p[key], degrees))])),
});

describe('palette families and the contrast clamp', () => {
  it('ink_neon is the identity and no family touches the hazard colour', () => {
    expect(applyPaletteFamily(base, 'ink_neon')).toBe(base);
    for (const family of PALETTE_FAMILY_IDS) for (const palette of PALETTES) expect(applyPaletteFamily(palette, family).hazard).toBe(palette.hazard);
  });

  it('every family x palette x biome turn keeps hazards, telegraphs, accents, text and rims apart from what is behind them', () => {
    for (const family of PALETTE_FAMILY_IDS) for (const palette of PALETTES) for (const degrees of [0, -36, 24, 36]) {
      // Same order as RoomScene: family on the world palette, biome turn, then the clamp.
      const out = lookPalette(turn(lookPalette(palette, family), degrees), 'ink_neon');
      expect(colorDiff(out.accent, out.hazard), `${family} accent/hazard @${degrees}`).toBeGreaterThanOrEqual(MIN_COLOR_DIFF);
      for (const [fg, bg] of CONTRAST_PAIRS) expect(colorDiff(out[fg], out[bg]), `${family} ${fg}/${bg} @${degrees}`).toBeGreaterThanOrEqual(MIN_COLOR_DIFF);
      const accent = toHsl(out.accent);
      const hazard = toHsl(out.hazard);
      if (accent.s >= 0.12 && hazard.s >= 0.12) expect(hueDistance(accent.h, hazard.h), `${family} hue gap @${degrees}`).toBeGreaterThanOrEqual(MIN_HAZARD_HUE_GAP - 1);
    }
  });

  it("keeps F3's solid language under every family and every lighting mode", () => {
    for (const family of PALETTE_FAMILY_IDS) for (const palette of PALETTES) for (const lighting of LIGHTING_IDS) {
      const out = lookPalette(palette, family);
      const solid = litSolidColors(out, LIGHTING[lighting]);
      const floor = Math.max(luminance(out.floor), luminance(out.floorAlt));
      if (floor < 0.7) expect(luminance(solid.cap), `${family}/${lighting} cap`).toBeGreaterThan(floor + 0.1);
      expect(luminance(solid.face), `${family}/${lighting} face`).toBeLessThan(luminance(solid.cap) - 0.1);
      expect(luminance(solid.outline)).toBeLessThan(0.08);
    }
  });

  it('the clamp terminates, is idempotent, and leaves an already readable palette alone', () => {
    for (const name of ['vantage-spire', 'crystal-tide', 'root-archive']) expect(clampPaletteContrast(fixturePalette(name)), name).toEqual(fixturePalette(name));
    for (const palette of PALETTES) {
      const once = clampPaletteContrast(palette);
      expect(clampPaletteContrast(once)).toEqual(once);
    }
  });

  it('families are distinguishable from each other on the same world (expressive range, coarse)', () => {
    const signature = (p: Palette) => `${Math.round(toHsl(p.floor).h / 20)}:${Math.round(toHsl(p.floor).s * 5)}:${Math.round(luminance(p.floor) * 8)}:${Math.round(toHsl(p.accent).h / 30)}:${Math.round(toHsl(p.accent).s * 3)}`;
    for (const palette of PALETTES.slice(0, 3)) expect(new Set(PALETTE_FAMILY_IDS.map((family) => signature(lookPalette(palette, family)))).size).toBe(PALETTE_FAMILY_IDS.length);
  });
});

describe('long_dark light', () => {
  it('lights lanterns and conduit tiles, and leaves a quarter of the room showing', () => {
    const room = { tiles: ['#####', '#.+.#', '#####'], props: [{ id: 'l', propId: 'lantern', x: 1, y: 1 }] } as never;
    const lights = fixedLights(room);
    expect(lights).toHaveLength(2);
    expect(isLit({ x: lights[0]!.x + 59, y: lights[0]!.y }, lights)).toBe(true);
    expect(isLit({ x: 2000, y: 2000 }, lights)).toBe(false);
    expect(DARKNESS_ALPHA).toBe(0.75);
  });
});

describe('look URL overrides', () => {
  it('accept only registry ids', () => {
    const empty = { laws: [], look: null, lawsDerived: false, lookDerived: false };
    expect(withLookOverrides(empty, '?palette=nope&lighting=<script>')).toBe(empty);
    expect(withLookOverrides(empty, '?palette=rust&lighting=rim').look).toMatchObject({ paletteFamily: 'rust', lighting: 'rim' });
    expect(withLookOverrides(empty, '?dark=215').laws[0]).toMatchObject({ lawId: 'long_dark', intensity: 0.5 });
  });
});
