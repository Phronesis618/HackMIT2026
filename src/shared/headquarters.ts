import type { GameSnapshot, MemoryRecord } from './contracts';
import { tileToWorld } from './conventions';
import type { ClassId } from './registry';

export const HEADQUARTERS_ID = 'headquarters';
export const HEADQUARTERS_INTERACT_RANGE = 58;

export type HeadquartersStationId = ClassId | 'archive' | 'observatory' | 'training' | 'portal';

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
  { id: 'bastion', classId: 'bastion', name: 'Bastion forge', wing: 'Armory', description: 'A shield suspended in a field of quiet force. Hold the line for those behind you.', action: 'Attune Bastion', x: 4, y: 3 },
  { id: 'shade', classId: 'shade', name: 'Shade prism', wing: 'Armory', description: 'Twin edges flicker between moments. Find the opening before it exists.', action: 'Attune Shade', x: 8, y: 3 },
  { id: 'beacon', classId: 'beacon', name: 'Beacon lens', wing: 'Armory', description: 'A small captive sun. Mark a path and bring the crew home.', action: 'Attune Beacon', x: 4, y: 7 },
  { id: 'weaver', classId: 'weaver', name: 'Weaver loom', wing: 'Armory', description: 'Threads of light bend around an absent center. Pull the battlefield into shape.', action: 'Attune Weaver', x: 8, y: 7 },
  { id: 'archive', name: 'Echo archive', wing: 'Records wing', description: 'What survives a world is what you carried back. Read the records held on this device.', action: 'Read records', x: 24, y: 4 },
  { id: 'observatory', name: 'World observatory', wing: 'Navigation wing', description: 'Every expedition begins as a signal. Add your idea to the next world.', action: 'Plan expedition', x: 24, y: 16 },
  { id: 'training', name: 'Proving chamber', wing: 'Training wing', description: 'A safe place to learn a dangerous craft. Practice against the real enemy patterns.', action: 'Inspect range', x: 5, y: 16 },
  { id: 'portal', name: 'Departure gate', wing: 'Transit hall', description: 'The way out, and the promise of a way back.', action: 'Inspect destination', x: 15, y: 18 },
];

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
