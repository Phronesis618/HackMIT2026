import { describe, expect, it } from 'vitest';
import {
  createBrowserChronicle, type ChronicleWorldContext, type KeyValueStorage,
} from '../../src/client/chronicle';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider, type WorldProvider } from '../../src/client/transport/worldProviders';
import {
  GenerationRequestSchema, WorldFixtureSchema, type GameEvent, type PreparedWorld, type RoomSpec,
} from '../../src/shared/contracts';
import { PLAYER_RADIUS, TICK_MS } from '../../src/shared/conventions';
import { buildSolidGrid } from '../../src/sim/collision';
import { chaseWaypoint } from '../../src/sim/combat';
import { trainingRoom } from '../../src/sim/training';
import { createLiveGenerationService } from '../../src/server/generation/liveService';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';

const identity = { id: 'reviewer', displayName: 'Reviewer', classId: 'bastion' as const };

function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

function context(world: PreparedWorld): ChronicleWorldContext {
  return {
    worldId: world.worldId, title: world.recipe.title,
    provenanceSource: world.provenance.source, receipt: world.receipt,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function defeat(session: LocalSession, room: RoomSpec, enemyId: string, events: GameEvent[]): void {
  const grid = buildSolidGrid(room);
  for (let i = 0; i < 3600; i++) {
    if (events.some((event) => event.type === 'enemy_defeated' && event.enemyId === enemyId)) return;
    const snapshot = session.getSnapshot()!;
    const player = snapshot.players[0]!;
    const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId)!;
    const target = chaseWaypoint(grid, player, enemy, PLAYER_RADIUS);
    const length = Math.hypot(target.x - player.x, target.y - player.y) || 1;
    const moving = Math.hypot(enemy.x - player.x, enemy.y - player.y) > 40;
    session.setIntent({
      moveX: moving ? (target.x - player.x) / length : 0,
      moveY: moving ? (target.y - player.y) / length : 0,
      aimX: enemy.x, aimY: enemy.y, attack: true, dash: false,
      ability: player.abilityQCooldownMs === 0 ? 'q' : null,
    });
    session.advance(TICK_MS);
  }
  throw new Error(`No real defeat event for ${enemyId}`);
}

describe('LocalSession Chronicle readiness', () => {
  it('excludes real training kills after an aborted expedition, then records one real expedition victory and reloads it', async () => {
    const disk = storage();
    const chronicle = createBrowserChronicle(disk);
    const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
    const events: GameEvent[] = [];
    session.onEvents((batch) => {
      events.push(...batch);
      const world = session.getWorld();
      chronicle.ingest(batch, { players: [identity], world: world ? context(world) : null });
    });
    session.onWorld((world) => chronicle.refreshReceipt(context(world)));
    try {
      session.submitContribution('A sanctuary above the clouds');
      const world = await session.requestWorld();
      session.enterPortal();
      session.returnToHeadquarters();
      expect(events.filter((event) => event.type === 'enemy_defeated')).toEqual([]);
      const beforeTraining = structuredClone(chronicle.getMemories());
      expect(session.enterTraining()).toBe(true);
      defeat(session, trainingRoom, 'tr-swarmling-0', events);
      expect(session.getPhase()).toBe('training');
      const trainingKills = events.filter((event) => event.type === 'enemy_defeated');
      expect(trainingKills.length).toBeGreaterThan(0);
      expect(trainingKills.every((event) => event.worldId === null)).toBe(true);
      expect(chronicle.getMemories()).toEqual(beforeTraining);
      expect(createBrowserChronicle(disk).getMemories()).toEqual(beforeTraining);

      session.returnToHeadquarters();
      session.enterPortal();
      const enemyId = session.getSnapshot()!.enemies.find((enemy) => enemy.hp > 0)!.id;
      defeat(session, world.rooms[0]!, enemyId, events);
      const victories = chronicle.getMemories().filter((memory) => memory.kind === 'milestone');
      expect(victories).toHaveLength(1);
      const kill = events.find((event) => event.type === 'enemy_defeated' && event.worldId === world.worldId)!;
      expect(victories[0]).toMatchObject({
        worldId: world.worldId, worldTitle: world.recipe.title, provenanceSource: 'fixture',
        sourceEventIds: [kill.id], participants: [{ id: identity.id, displayName: identity.displayName }],
      });
      expect(victories[0]!.sourceEventIds).not.toContain(trainingKills[0]!.id);
      expect(chronicle.ingest(events, { players: [identity], world: context(world) })).toEqual([]);
      const reloaded = createBrowserChronicle(disk);
      expect(reloaded.getMemories()).toEqual(chronicle.getMemories());
      expect(reloaded.ingest(events, { players: [identity], world: context(world) })).toEqual([]);
      expect(reloaded.getMemories().filter((memory) => memory.kind === 'milestone')).toHaveLength(1);
    } finally {
      session.dispose();
    }
  });

  it.each([false, true])('refreshes late-room attribution through validated prefixes and storage reload (mid-stream reload: %s)', async (reload) => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1234);
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    const generation = createLiveGenerationService({
      model: 'mock-model', fixtures: [fixture], log: () => {},
      provider: {
        async generate(request) {
          return { recipe: {
            ...fixture.recipe,
            contributionMappings: [{
              contributionId: request.contributions[0]!.id,
              kind: 'name', featureDescription: 'A sanctuary in the final room', roomIndex: 2,
            }],
          } };
        },
      },
    });
    const next = deferred();
    const final = deferred();
    const secondReady = deferred();
    const complete = deferred();
    const provider: WorldProvider = {
      kind: 'server',
      prepareWorld: (request) => generation.prepareWorld(GenerationRequestSchema.parse(request)),
      async *prepareWorldStream(request) {
        for await (const prefix of generation.prepareWorldStream(GenerationRequestSchema.parse(request))) {
          yield prefix;
          if (prefix.rooms.length === 1) await next.promise;
          if (prefix.rooms.length === 2) await final.promise;
        }
      },
    };
    const session = new LocalSession({ identity, worldProvider: provider });
    const events: GameEvent[] = [];
    const used: boolean[] = [];
    session.onEvents((batch) => {
      events.push(...batch);
      const world = session.getWorld();
      chronicle.ingest(batch, { players: [identity], world: world ? context(world) : null });
    });
    session.onWorld((world) => {
      chronicle.refreshReceipt(context(world));
      used.push(world.receipt.lines[0]!.used);
      if (world.rooms.length === 2) secondReady.resolve();
      if (world.rooms.length === 3) complete.resolve();
    });
    try {
      session.submitContribution('A last-room sanctuary');
      const first = await session.requestWorld();
      expect(first.rooms).toHaveLength(1);
      const original = structuredClone(chronicle.getMemories()[0]!);
      expect(original.summary).toBe('Reviewer contributed 1 idea; 0 shaped observable features of this world.');
      expect(original.provenanceSource).toBe('live');
      if (reload) chronicle = createBrowserChronicle(disk);
      next.resolve();
      await secondReady.promise;
      expect(chronicle.getMemories()).toEqual([original]);
      final.resolve();
      await complete.promise;
      expect(used).toEqual([false, false, true]);
      expect(session.getWorld()!.rooms).toHaveLength(3);
      expect(events.filter((event) => event.type === 'world_prepared')).toHaveLength(1);
      expect(chronicle.getMemories()).toEqual([{
        ...original, summary: 'Reviewer contributed 1 idea; 1 shaped observable features of this world.',
      }]);
      const reloaded = createBrowserChronicle(disk);
      expect(reloaded.getMemories()).toEqual(chronicle.getMemories());
      expect(reloaded.ingest(events, { players: [identity], world: context(session.getWorld()!) })).toEqual([]);
    } finally {
      next.resolve();
      final.resolve();
      session.dispose();
    }
  });
});
