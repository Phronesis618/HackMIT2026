/**
 * Dev/demo URL switches for the world look (agent M1), so any look can be seen without a model:
 *   ?palette=rust&lighting=rim&floor=ice&wall=hewn&atmo=snow&dark=215
 * `dark` is `long_dark`'s light radius in px (renderer-only; the sim is untouched). Every value
 * is checked against the closed registries; anything else is ignored.
 */
import {
  ATMOSPHERE_IDS, FLOOR_MATERIAL_IDS, LIGHTING_IDS, PALETTE_FAMILY_IDS, WALL_STYLE_IDS, type WorldLaw, type WorldLook,
} from '../../shared/laws';
import type { WorldLawsView } from '../../sim/laws';

const BASE_LOOK: WorldLook = {
  paletteFamily: 'ink_neon', floorMaterial: 'plates', wallStyle: 'blockwork', lighting: 'overhead',
  atmosphere: 'sparks', atmosphereDensity: 0.4, skylineDepth: 0.5, grain: 0,
};

function pick<T extends string>(ids: readonly T[], value: string | null): T | undefined {
  return ids.find((id) => id === value);
}

export function withLookOverrides(view: WorldLawsView, search: string = typeof location === 'undefined' ? '' : location.search): WorldLawsView {
  const params = new URLSearchParams(search);
  const overrides: Partial<WorldLook> = {};
  const paletteFamily = pick(PALETTE_FAMILY_IDS, params.get('palette'));
  const lighting = pick(LIGHTING_IDS, params.get('lighting'));
  const floorMaterial = pick(FLOOR_MATERIAL_IDS, params.get('floor'));
  const wallStyle = pick(WALL_STYLE_IDS, params.get('wall'));
  const atmosphere = pick(ATMOSPHERE_IDS, params.get('atmo'));
  if (paletteFamily) overrides.paletteFamily = paletteFamily;
  if (lighting) overrides.lighting = lighting;
  if (floorMaterial) overrides.floorMaterial = floorMaterial;
  if (wallStyle) overrides.wallStyle = wallStyle;
  if (atmosphere) overrides.atmosphere = atmosphere;
  const dark = Number(params.get('dark'));
  const laws: WorldLaw[] = [...view.laws];
  if (params.has('dark') && Number.isFinite(dark) && !laws.some((law) => law.lawId === 'long_dark')) {
    // intensity from the radius, inverted from the law's 260..170 band
    const intensity = Math.max(0, Math.min(1, (260 - Math.max(170, Math.min(260, dark || 215))) / 90));
    laws.push({ lawId: 'long_dark', name: 'Dark (debug override)', description: 'Forced by the ?dark= URL parameter. Not part of this world.', intensity });
  }
  if (Object.keys(overrides).length === 0 && laws.length === view.laws.length) return view;
  return { ...view, laws, look: Object.keys(overrides).length > 0 || view.look ? { ...(view.look ?? BASE_LOOK), ...overrides } : null };
}
