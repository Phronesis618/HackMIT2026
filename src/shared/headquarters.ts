import type { GameSnapshot, MemoryRecord } from './contracts';
import { tileToWorld } from './conventions';
import type { ClassId } from './registry';

export const HEADQUARTERS_ID = 'headquarters';
export const HEADQUARTERS_INTERACT_RANGE = 58;

export type HeadquartersStationId =
  | ClassId
  | 'archive'
  | 'records'
  | 'observatory'
  | 'training'
  | 'portal'
  | 'quartermaster'
  | 'relics';

export interface HeadquartersStation {
  id: HeadquartersStationId;
  name: string;
  wing: string;
  description: string;
  action: string;
  x: number;
  y: number;
  classId?: ClassId;
}

export const HEADQUARTERS_STATIONS: readonly HeadquartersStation[] = [
  { id: 'bastion', classId: 'bastion', name: 'Arc-blade stand', wing: 'Armory', description: 'Arc-blade and tower shield on a rack. Wide sweeps, and a shield that cuts melee hits to 20%.', action: 'Take the arc-blade', x: 4, y: 3 },
  { id: 'shade', classId: 'shade', name: 'Phase blade stand', wing: 'Armory', description: 'Twin phase blades on a rack. Short reach, fast cadence, no shield.', action: 'Take the phase blades', x: 8, y: 3 },
  { id: 'beacon', classId: 'beacon', name: 'Lantern staff stand', wing: 'Armory', description: 'Lantern staff on a rack. Repairs the crew and quickens their weapons.', action: 'Take the lantern staff', x: 4, y: 7 },
  { id: 'weaver', classId: 'weaver', name: 'Plasma loom stand', wing: 'Armory', description: 'Plasma loom on a rack. Pulls enemies into shape at range.', action: 'Take the plasma loom', x: 8, y: 7 },
  { id: 'archive', name: 'Records archive', wing: 'Records wing', description: 'Creation receipts, arrival keepsakes and run records. All of it is stored on this device only.', action: 'Read records', x: 24, y: 4 },
  { id: 'records', name: 'Class plinths', wing: 'Records wing', description: 'Four plinths, one per weapon. Counts come from runs recorded on this device.', action: 'Read service record', x: 24, y: 8 },
  { id: 'quartermaster', name: 'Quartermaster', wing: 'Returns hall', description: 'Keeps the returns bench. Counts what came back and what did not.', action: 'Speak to the quartermaster', x: 15, y: 6 },
  { id: 'relics', name: 'Relic shelf', wing: 'Returns hall', description: 'Five brackets. A relic is shelved only if it came back from an anchored run.', action: 'Read the shelf', x: 15, y: 1 },
  { id: 'observatory', name: 'World observatory', wing: 'Navigation wing', description: 'Console for the next world. Each operative adds ideas; the host prepares the world from them.', action: 'Plan expedition', x: 24, y: 16 },
  { id: 'training', name: 'Proving chamber', wing: 'Training wing', description: 'Practice range with every enemy attack pattern. E and R are unlocked and no records are kept.', action: 'Inspect range', x: 5, y: 16 },
  { id: 'portal', name: 'Departure gate', wing: 'Transit hall', description: 'Gate to the prepared world. A crew of 1 to 4 goes through together.', action: 'Inspect destination', x: 15, y: 18 },
];

/**
 * Stations without a blocking terminal prop: the portal tile, the shelf's reading tile, and the
 * quartermaster, who stands in the north-south walkway. All registry props block movement, so
 * the NPC, the returns bench and the record plinths are renderer-only dressing.
 */
export const HEADQUARTERS_PROPLESS_STATIONS: ReadonlySet<HeadquartersStationId> = new Set(['portal', 'relics', 'quartermaster']);

export const HEADQUARTERS_RELIC_BRACKETS: readonly { x: number; y: number }[] = [
  { x: 12, y: 1 }, { x: 13, y: 1 }, { x: 14, y: 1 }, { x: 16, y: 1 }, { x: 17, y: 1 },
];

/** Renderer-only dressing (no props, so HQ collision is unchanged). */
export const HEADQUARTERS_RECORD_PLINTHS: readonly { classId: ClassId; x: number; y: number }[] = [
  { classId: 'bastion', x: 23, y: 7 }, { classId: 'shade', x: 25, y: 7 }, { classId: 'beacon', x: 23, y: 8 }, { classId: 'weaver', x: 25, y: 8 },
];

export const HEADQUARTERS_RETURNS_BENCH: readonly { x: number; y: number }[] = [{ x: 14, y: 6 }, { x: 16, y: 6 }];

/** Warm lamps that light the sanctuary; lamp tiers grow their glow (HUB.md §6c). */
export const HEADQUARTERS_LANTERNS: ReadonlyArray<{ id: string; x: number; y: number }> = [
  { id: 'hq-lantern-a', x: 12, y: 8 },
  { id: 'hq-lantern-b', x: 18, y: 8 },
  { id: 'hq-lantern-c', x: 12, y: 16 },
  { id: 'hq-lantern-d', x: 18, y: 16 },
  { id: 'hq-archive-light', x: 21, y: 7 },
];

export const HEADQUARTERS_LAMP_MAX_TIER = 3;
export const HEADQUARTERS_LAMP_GLOW_STEP = 0.15;
export const HEADQUARTERS_LAMP_RADIUS_STEP = 0.08;

/** Cosmetic, device-local, derived: one tier per anchored run recorded on this browser, capped. */
export function headquartersLampTier(anchors: number): number {
  if (!Number.isFinite(anchors) || anchors <= 0) return 0;
  return Math.min(HEADQUARTERS_LAMP_MAX_TIER, Math.floor(anchors));
}

export function headquartersLampGlow(baseGlowIntensity: number, tier: number): { glowIntensity: number; radiusScale: number } {
  const t = headquartersLampTier(tier);
  return { glowIntensity: baseGlowIntensity + HEADQUARTERS_LAMP_GLOW_STEP * t, radiusScale: 1 + HEADQUARTERS_LAMP_RADIUS_STEP * t };
}

/** Departure ritual (HUB.md §8): the skippable 2.4 s sequence when the crew leaves through the gate. */
export const DEPARTURE_COUNTDOWN_MS = 2400;
export const DEPARTURE_FLASH_HOLD_MS = 120;
export const DEPARTURE_RETURN_FADE_MS = 600;

export interface DepartureStage {
  /** 0..1 across the whole ritual. */
  progress: number;
  /** Portal ring scale: 1 → 1.6 over the first 400 ms, then collapses toward 0 from 1.6 s. */
  ringScale: number;
  /** Lamp level: 1 → 0.4 over the first 800 ms. */
  lampLevel: number;
  /** Tether lines from each operative to the portal, from 0.4 s. */
  tethers: boolean;
  /** The quartermaster turns to face the gate at 1.0 s. */
  quartermasterFacesGate: boolean;
  /** White flash 0..1, rising from 1.6 s to full at 2.4 s. */
  flash: number;
  done: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function departureStage(elapsedMs: number): DepartureStage {
  const ms = Math.max(0, elapsedMs);
  const done = ms >= DEPARTURE_COUNTDOWN_MS;
  const brighten = clamp01(ms / 400);
  const collapse = clamp01((ms - 1600) / 800);
  return {
    progress: clamp01(ms / DEPARTURE_COUNTDOWN_MS),
    ringScale: (1 + 0.6 * brighten) * (1 - collapse),
    lampLevel: 1 - 0.6 * clamp01(ms / 800),
    tethers: ms >= 400 && !done,
    quartermasterFacesGate: ms >= 1000,
    flash: collapse,
    done,
  };
}

export function headquartersStation(id: HeadquartersStationId | null | undefined): HeadquartersStation | null {
  return HEADQUARTERS_STATIONS.find((station) => station.id === id) ?? null;
}

export function nearbyHeadquartersStation(snapshot: GameSnapshot, localPlayerId: string): HeadquartersStation | null {
  if (snapshot.phase !== 'headquarters' || snapshot.roomId !== HEADQUARTERS_ID) return null;
  const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
  if (!player || player.hp <= 0) return null;
  let nearest: HeadquartersStation | null = null;
  let nearestDistance = HEADQUARTERS_INTERACT_RANGE;
  for (const station of HEADQUARTERS_STATIONS) {
    const position = tileToWorld(station.x, station.y);
    const distance = Math.hypot(player.x - position.x, player.y - position.y);
    if (distance <= nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function headquartersRecords(memories: readonly MemoryRecord[]) {
  const unique = [...new Map(memories.map((memory) => [memory.id, memory])).values()];
  return {
    memories: unique.length,
    worldsVisited: new Set(unique.filter((memory) => memory.kind === 'arrival_keepsake').map((memory) => memory.worldId)).size,
    anchors: unique.filter((memory) => memory.kind === 'anchor').length,
    expeditionsEnded: unique.filter((memory) => memory.kind === 'run_summary').length,
    lore: unique.filter((memory) => memory.kind === 'lore').length,
    receipts: unique.filter((memory) => memory.kind === 'creation_receipt').length,
  };
}
