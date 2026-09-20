/**
 * Template library, room assembler and encounter director tests (Agent F1a).
 */
import { describe, expect, it } from 'vitest';
import { BuiltRoomSchema, ROOM_KINDS, SIZE_CLASSES, type BiomeBrief, type BuiltRoom, type DoorSide, type FloorPlan } from '../../../src/shared/floors';
import { PROP_INFO, TILE_CHARS, WALKABLE_TILES } from '../../../src/shared/registry';
import {
  DEFAULT_BIOME_BRIEFS,
  MAX_ENEMIES_BY_SIZE,
  MAX_RANGED_BY_SIZE,
  RANGED_ENEMIES,
  ROOM_TEMPLATES,
  buildFloor,
  buildRoom,
  createLazyFloor,
  createRng,
  encounterBudget,
  flood,
  generateFloorPlan,
  pickTemplate,
  planWorldRoute,
  rollEncounters,
} from '../../../src/server/generation/floorgen';

const LEGAL = new Set<string>(TILE_CHARS);
const key = (x: number, y: number) => `${x},${y}`;

function tierOf(brief: BiomeBrief): number {
  return planWorldRoute('t').graph.nodes.find((node) => node.biomeId === brief.id)!.tier;
}

function assertRoomInvariants(room: BuiltRoom, plan: FloorPlan): void {
  const where = `${room.address.biomeId}/${room.address.roomId} (${room.templateId})`;
  const fail = (message: string) => {
    throw new Error(`${where}: ${message}\n${room.tiles.join('\n')}`);
  };
  const planRoom = plan.rooms.find((candidate) => candidate.id === room.address.roomId)!;
  if (room.tiles.length !== room.height) fail('height mismatch');
  let spawns = 0;
  let anchors = 0;
  let exits = 0;
  room.tiles.forEach((row, y) => {
    if (row.length !== room.width) fail(`row ${y} is not ${room.width} wide`);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (!LEGAL.has(ch)) fail(`illegal tile '${ch}'`);
      if (ch === 'P') spawns++;
      if (ch === 'A') anchors++;
      if (ch === 'X') exits++;
      const onBorder = x === 0 || y === 0 || x === room.width - 1 || y === room.height - 1;
      if (onBorder && ch !== '#' && ch !== ' ' && ch !== 'X') fail(`border tile '${ch}' at ${x},${y} leaks out of the room`);
    }
  });
  const isFinalExit = room.kind === 'exit' && plan.tier === 4;
  if (spawns !== 1) fail(`${spawns} spawns`);
  if (anchors !== (isFinalExit ? 1 : 0)) fail(`${anchors} anchors`);
  if (room.tiles[room.spawn.y]![room.spawn.x] !== 'P') fail('spawn is not on P');
  if (room.feature === 'anchor' && room.tiles[room.focus.y]![room.focus.x] !== 'A') fail('anchor focus is not on A');

  // Doors: exactly the plan's doors, each an X on the right wall with a walkable entry.
  const wanted = (Object.entries(planRoom.doors) as Array<[DoorSide, string]>).map(([side, to]) => `${{ n: 'north', s: 'south', e: 'east', w: 'west' }[side]}>${to}`);
  if (room.doors.map((door) => `${door.direction}>${door.toRoomId}`).sort().join() !== wanted.sort().join()) fail('doors do not match the plan');
  if (exits !== room.doors.length) fail(`${exits} X tiles for ${room.doors.length} doors`);
  for (const door of room.doors) {
    if (room.tiles[door.y]![door.x] !== 'X') fail('door is not an X tile');
    const wall = { north: door.y === 0, south: door.y === room.height - 1, west: door.x === 0, east: door.x === room.width - 1 }[door.direction];
    if (!wall) fail(`door ${door.direction} is not on its wall`);
    if (!WALKABLE_TILES.has(room.tiles[door.entry.y]![door.entry.x]!)) fail('door entry is not walkable');
    if (Math.abs(door.entry.x - door.x) + Math.abs(door.entry.y - door.y) !== 1) fail('door entry is not next to the door');
  }

  // Reachability with blocking props in place, and again without touching hazards.
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) {
        if (!WALKABLE_TILES.has(room.tiles[prop.y + dy]?.[prop.x + dx] ?? '#')) fail(`prop ${prop.id} is not on walkable tiles`);
        if (info.blocksMovement) blocked.add(key(prop.x + dx, prop.y + dy));
      }
    }
  }
  const reach = flood(room.tiles, room.spawn, () => true, blocked);
  const dry = flood(room.tiles, room.spawn, (ch) => ch !== '~', blocked);
  for (const point of [room.focus, ...room.doors.map((door) => door.entry), ...room.doors]) {
    if (!reach.has(key(point.x, point.y))) fail(`${point.x},${point.y} is unreachable`);
    if (!dry.has(key(point.x, point.y))) fail(`${point.x},${point.y} is only reachable through hazards`);
  }

  // Encounters.
  if (room.encounters.length > 12 || room.props.length > 64) fail('RoomSpec limits exceeded');
  const quiet = ['entrance', 'rest', 'treasure', 'lore', 'shop'].includes(room.kind);
  if (quiet && room.encounters.length > 0) fail(`${room.kind} room has enemies`);
  if (room.kind === 'combat' && room.encounters.length === 0) fail('combat room is empty');
  const spots = new Set<string>();
  let total = 0;
  let ranged = 0;
  for (const encounter of room.encounters) {
    if (!WALKABLE_TILES.has(room.tiles[encounter.y]![encounter.x]!)) fail(`encounter ${encounter.id} is not on a walkable tile`);
    if (!reach.has(key(encounter.x, encounter.y))) fail(`encounter ${encounter.id} is unreachable`);
    if (blocked.has(key(encounter.x, encounter.y))) fail(`encounter ${encounter.id} is inside a prop`);
    if (spots.has(key(encounter.x, encounter.y))) fail('two encounters share a tile');
    spots.add(key(encounter.x, encounter.y));
    for (const door of room.doors) {
      if (Math.abs(door.entry.x - encounter.x) + Math.abs(door.entry.y - encounter.y) < 2) fail(`encounter ${encounter.id} sits in a doorway`);
    }
    if (encounter.role === 'pack') {
      total += encounter.count;
      if (RANGED_ENEMIES.has(encounter.enemyId)) ranged += encounter.count;
      if (encounter.enemyId === 'guardian') fail('guardian bought as a pack');
    }
  }
  if (total > MAX_ENEMIES_BY_SIZE[room.sizeClass]) fail(`${total} pack enemies in a ${room.sizeClass} room`);
  if (ranged > MAX_RANGED_BY_SIZE[room.sizeClass]) fail(`${ranged} ranged enemies in a ${room.sizeClass} room`);
  const roles = room.encounters.map((encounter) => encounter.role);
  if (room.kind === 'elite' && roles.filter((role) => role === 'elite').length !== 1) fail('elite room needs exactly one elite pack');
  if (room.kind === 'exit') {
    const bossRole = isFinalExit ? 'guardian' : 'gatekeeper';
    if (roles.filter((role) => role === bossRole).length !== 1) fail(`exit needs one ${bossRole}`);
    const boss = room.encounters.find((encounter) => encounter.role === bossRole)!;
    if (isFinalExit && boss.enemyId !== 'guardian') fail('final exit boss is not the guardian');
    if (isFinalExit && !room.props.some((prop) => prop.propId === 'anchor_pedestal' && prop.x === room.focus.x && prop.y === room.focus.y)) fail('no anchor pedestal on the A tile');
  } else if (roles.includes('guardian') || roles.includes('gatekeeper')) fail('boss outside an exit room');
  if (!isFinalExit && room.props.some((prop) => prop.propId === 'anchor_pedestal')) fail('anchor pedestal outside the final exit');
}

describe('room templates', () => {
  it('has at least 14 distinct templates across all three size classes', () => {
    expect(ROOM_TEMPLATES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(ROOM_TEMPLATES.map((template) => template.id)).size).toBe(ROOM_TEMPLATES.length);
    expect(new Set(ROOM_TEMPLATES.map((template) => template.tiles.join('\n'))).size).toBe(ROOM_TEMPLATES.length);
    for (const size of SIZE_CLASSES) expect(ROOM_TEMPLATES.filter((template) => template.sizeClass === size).length).toBeGreaterThanOrEqual(4);
  });

  it.each(ROOM_TEMPLATES.map((template) => [template.id, template] as const))('%s is well formed', (_id, template) => {
    const height = template.tiles.length;
    const width = template.tiles[0]!.length;
    expect(width).toBeGreaterThanOrEqual(8);
    expect(width).toBeLessThanOrEqual(48);
    expect(height).toBeGreaterThanOrEqual(6);
    expect(height).toBeLessThanOrEqual(32);
    const text = template.tiles.join('');
    expect(template.tiles.every((row) => row.length === width)).toBe(true);
    expect([...text].every((ch) => '#. PA'.includes(ch))).toBe(true);
    expect(text.split('P').length - 1).toBe(1);
    expect(text.split('A').length - 1).toBeLessThanOrEqual(1);
    template.tiles.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) expect('# ').toContain(ch);
      });
    });
    // Sockets sit on border walls and open onto floor.
    const sockets = Object.entries(template.sockets) as Array<[DoorSide, number]>;
    expect(sockets.length).toBeGreaterThan(0);
    for (const [side, pos] of sockets) {
      const x = side === 'n' || side === 's' ? pos : side === 'w' ? 0 : width - 1;
      const y = side === 'n' ? 0 : side === 's' ? height - 1 : pos;
      const inner = { x: x + (side === 'w' ? 1 : side === 'e' ? -1 : 0), y: y + (side === 'n' ? 1 : side === 's' ? -1 : 0) };
      expect(template.tiles[y]![x]).toBe('#');
      expect('.PA').toContain(template.tiles[inner.y]![inner.x]);
    }
    // One connected walkable region.
    const spawnY = template.tiles.findIndex((row) => row.includes('P'));
    const reach = flood(template.tiles, { x: template.tiles[spawnY]!.indexOf('P'), y: spawnY });
    expect(reach.size).toBe([...text].filter((ch) => '.PA'.includes(ch)).length);
  });

  it('covers every room kind with a four-socket template, and picks by kind', () => {
    const rng = createRng('pick');
    for (const kind of ROOM_KINDS) {
      expect(ROOM_TEMPLATES.some((template) => template.kinds.includes(kind) && Object.keys(template.sockets).length === 4)).toBe(true);
      for (let i = 0; i < 40; i++) expect(pickTemplate(kind, ['n', 's', 'e', 'w'], ['roots'], i % 5, rng).kinds).toContain(kind);
    }
  });

  it('leans toward templates that share a motif with the biome', () => {
    const count = (motif: 'crystals' | 'ruined_machinery') => {
      const rng = createRng('affinity');
      let hits = 0;
      for (let i = 0; i < 400; i++) if (pickTemplate('combat', ['n'], [motif], 2, rng).motifAffinity.includes('crystals')) hits++;
      return hits;
    };
    expect(count('crystals')).toBeGreaterThan(count('ruined_machinery') * 1.5);
  });
});

describe('buildRoom / buildFloor', () => {
  it('builds every room of every default biome, over many seeds, with all invariants', () => {
    const templatesSeen = new Set<string>();
    let hazardRooms = 0;
    let rooms = 0;
    for (const item of DEFAULT_BIOME_BRIEFS) {
      for (let i = 0; i < 12; i++) {
        const seed = `build-${i}`;
        const plan = generateFloorPlan(item, tierOf(item), seed);
        const floor = buildFloor(plan, item, seed);
        expect(floor.rooms).toHaveLength(plan.rooms.length);
        for (const room of floor.rooms) {
          assertRoomInvariants(room, plan);
          templatesSeen.add(room.templateId);
          if (room.tiles.some((row) => row.includes('~'))) {
            hazardRooms++;
            expect(item.hazards).toBe(true);
          }
          rooms++;
        }
        expect(BuiltRoomSchema.safeParse(floor.rooms[0]).success).toBe(true);
        expect(BuiltRoomSchema.safeParse(floor.rooms[floor.rooms.length - 1]).success).toBe(true);
      }
    }
    expect(rooms).toBe(12 * (10 + 15 * 2 + 20 * 2 + 25 * 2 + 30));
    expect(templatesSeen.size).toBe(ROOM_TEMPLATES.length);
    expect(hazardRooms).toBeGreaterThan(100);
  });

  it('is deterministic, order-independent and lazy', () => {
    const item = DEFAULT_BIOME_BRIEFS[3]!;
    const plan = generateFloorPlan(item, 2, 'lazy');
    const all = buildFloor(plan, item, 'lazy');
    expect(JSON.stringify(buildFloor(generateFloorPlan(item, 2, 'lazy'), item, 'lazy'))).toBe(JSON.stringify(all));

    const lazy = createLazyFloor(plan, item, 'lazy');
    expect(lazy.builtRoomIds()).toEqual([]);
    for (const room of [...plan.rooms].reverse()) {
      expect(JSON.stringify(lazy.room(room.id))).toBe(JSON.stringify(all.rooms.find((built) => built.address.roomId === room.id)));
    }
    expect(lazy.room(plan.exitId)).toBe(lazy.room(plan.exitId));
    expect(lazy.builtRoomIds()).toHaveLength(plan.rooms.length);

    const other = buildFloor(plan, item, 'lazy-2');
    expect(JSON.stringify(other.rooms)).not.toBe(JSON.stringify(all.rooms));
    expect(() => buildRoom(plan, 'nope', item, 'lazy')).toThrow();
  });

  it('mirrors and flips templates (same template, different tiles across rooms)', () => {
    const item = DEFAULT_BIOME_BRIEFS[6]!;
    const variants = new Map<string, Set<string>>();
    for (let i = 0; i < 6; i++) {
      const plan = generateFloorPlan(item, 3, `flip-${i}`);
      for (const room of buildFloor(plan, item, `flip-${i}`).rooms) {
        const walls = room.tiles.map((row) => row.replace(/[^# ]/g, '.')).join('\n');
        variants.set(room.templateId, (variants.get(room.templateId) ?? new Set()).add(walls));
      }
    }
    expect(Math.max(...[...variants.values()].map((set) => set.size))).toBeGreaterThan(2);
  });

  it('repairs a plan whose room uses a template without the needed socket', () => {
    const item = DEFAULT_BIOME_BRIEFS[0]!;
    const plan = generateFloorPlan(item, 0, 'repair');
    // Force every room onto the divided template: doors land wherever its off-centre sockets say.
    const forced: FloorPlan = { ...plan, rooms: plan.rooms.map((room) => ({ ...room, templateId: 's_split', sizeClass: 'small' as const })) };
    for (const room of forced.rooms) assertRoomInvariants(buildRoom(forced, room.id, item, 'repair'), forced);
    // Unknown template ids fall back to the plain cell instead of throwing.
    const unknown: FloorPlan = { ...plan, rooms: plan.rooms.map((room) => ({ ...room, templateId: 'missing', sizeClass: 'small' as const })) };
    for (const room of unknown.rooms) assertRoomInvariants(buildRoom(unknown, room.id, item, 'repair'), unknown);
  });
});

describe('encounter director', () => {
  it('scales the budget with tier, depth and kind', () => {
    expect(encounterBudget(0, 'entrance', 0, 5)).toBe(0);
    expect(encounterBudget(2, 'rest', 3, 5)).toBe(0);
    expect(encounterBudget(4, 'combat', 5, 10)).toBeGreaterThan(encounterBudget(0, 'combat', 5, 10));
    expect(encounterBudget(2, 'combat', 10, 10)).toBeGreaterThan(encounterBudget(2, 'combat', 1, 10));
    expect(encounterBudget(2, 'elite', 5, 10)).toBeLessThan(encounterBudget(2, 'combat', 5, 10));
  });

  it('gets harder with the biome tier, caps ranged enemies in small rooms, and never packs the guardian', () => {
    const item: BiomeBrief = { ...DEFAULT_BIOME_BRIEFS[7]!, enemyPool: ['guardian', 'sentinel', 'spewer', 'husk'] };
    const mean = (tier: number) => {
      const rng = createRng(`tier-${tier}`);
      let sum = 0;
      for (let i = 0; i < 200; i++) {
        const groups = rollEncounters({ brief: item, tier, kind: 'combat', depth: 4, maxDepth: 8, sizeClass: 'large', isFinalExit: false }, rng);
        expect(groups.length).toBeLessThanOrEqual(12);
        expect(groups.every((group) => group.enemyId !== 'guardian' && group.count >= 1 && group.count <= 6)).toBe(true);
        sum += groups.reduce((total, group) => total + group.count, 0);
      }
      return sum / 200;
    };
    expect(mean(4)).toBeGreaterThan(mean(0) * 1.5);

    const rng = createRng('small');
    for (let i = 0; i < 200; i++) {
      const groups = rollEncounters({ brief: item, tier: 4, kind: 'combat', depth: 8, maxDepth: 8, sizeClass: 'small', isFinalExit: false }, rng);
      const ranged = groups.filter((group) => RANGED_ENEMIES.has(group.enemyId)).reduce((total, group) => total + group.count, 0);
      expect(ranged).toBeLessThanOrEqual(1);
    }
  });

  it('puts a gatekeeper in every exit and the guardian only in the final one', () => {
    const rng = createRng('exit');
    const item = DEFAULT_BIOME_BRIEFS[2]!;
    const gate = rollEncounters({ brief: item, tier: 1, kind: 'exit', depth: 9, maxDepth: 9, sizeClass: 'large', isFinalExit: false }, rng);
    expect(gate[0]).toEqual({ enemyId: 'warden', count: 1, role: 'gatekeeper' });
    const last = rollEncounters({ brief: item, tier: 4, kind: 'exit', depth: 9, maxDepth: 9, sizeClass: 'large', isFinalExit: true }, rng);
    expect(last[0]).toEqual({ enemyId: 'guardian', count: 1, role: 'guardian' });
  });
});
