/**
 * Per-biome art (agent F3, FLOORS.md §11.2). A floors world still ships ONE ArtRecipe, but
 * each biome has its own motifs. `artForRoom` swaps in the biome's motifs (floor material,
 * wall dressing, motes, overhead) and rotates the palette a few degrees per biome, so
 * walking through a biome exit visibly changes the place while the world keeps its identity.
 *
 * The renderer contract only hands RoomScene a room and the world's art, so the briefs are
 * registered here by the floors UI bridge (`connectFloorsUi`) when a world arrives.
 */
import type { ArtRecipe, Palette } from '../../shared/contracts';
import type { BiomeBrief } from '../../shared/floors';
import { hashString } from '../../shared/ids';
import { intToHex, shiftHue } from './color';

const briefs = new Map<string, Pick<BiomeBrief, 'id' | 'motifIds'>>();

export function registerBiomes(list: ReadonlyArray<Pick<BiomeBrief, 'id' | 'motifIds'>>): void {
  briefs.clear();
  for (const brief of list) briefs.set(brief.id, brief);
}

/** Hue offset in degrees for a biome: deterministic, within ±36°, 0 for the opener. */
export function biomeHueShift(biomeId: string, index: number): number {
  if (index === 0) return 0;
  return ((hashString(biomeId) % 7) - 3) * 12;
}

function tint(palette: Palette, degrees: number): Palette {
  if (degrees === 0) return palette;
  const turn = (hex: string): string => intToHex(shiftHue(hex, degrees));
  return {
    ...palette,
    floor: turn(palette.floor),
    floorAlt: turn(palette.floorAlt),
    wall: turn(palette.wall),
    wallEdge: turn(palette.wallEdge),
    accent: turn(palette.accent),
    accentSoft: turn(palette.accentSoft),
  };
}

export function artForRoom(room: { biomeId?: string | undefined }, art: ArtRecipe): ArtRecipe {
  const brief = room.biomeId ? briefs.get(room.biomeId) : undefined;
  if (!brief) return art;
  const index = [...briefs.keys()].indexOf(brief.id);
  return { ...art, motifIds: [...brief.motifIds], skyline: brief.motifIds[0] ?? art.skyline, palette: tint(art.palette, biomeHueShift(brief.id, index)) };
}
