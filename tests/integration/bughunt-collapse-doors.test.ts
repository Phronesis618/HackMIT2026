import { describe, expect, it } from 'vitest';
import { selectDoorViews } from '../../src/client/render/doors';
import { GameSnapshotSchema } from '../../src/shared/contracts';
import { TICK_MS } from '../../src/shared/conventions';
import { createSimulation } from '../../src/sim';
import { collapseMs, ROOM_LOST_DELAY_MS } from '../../src/sim/escape';
import { FloorsBot, floorsWorld, makeProvider, planPath } from '../sim/floorsBot';

const crew = ['op-a', 'op-b', 'op-c'];

function finale() {
  const world = floorsWorld('a8-escape');
  const sim = createSimulation();
  for (const id of crew) {
    sim.addPlayer({ id, displayName: id, classId: 'beacon' });
    sim.unlockAbility(id);
  }
  sim.setHostPlayerId(crew[0]!);
  sim.setWorld(world);
  sim.enterRoom(0);
  sim.devJumpToTier(4, 'exit');
  const bot = new FloorsBot(sim, makeProvider(world), crew);
  bot.fight();
  for (let relay = 0; relay < 3; relay++) {
    const ritual = bot.snapshot().anchor!.ritual!;
    expect(ritual.activeRelay).toBe(relay);
    expect(bot.walkTo(ritual.relays[relay]!, { reach: 10 })).toBe(true);
    bot.tick(() => ({ interact: true }));
    bot.tick();
  }
  expect(bot.walkTo(bot.snapshot().anchor!, { reach: 30 })).toBe(true);
  return { sim, bot };
}

function discharge(bot: FloorsBot) {
  bot.tick(() => ({ interact: true }));
  for (let i = 0; i < 200 && bot.snapshot().anchor!.ritual!.stage === 'discharging'; i++) bot.tick();
  expect(bot.snapshot().collapse?.stage).toBe('collapse');
}

describe('floors collapse integration', () => {
  it('shows a lost destination sealed while the escape route remains open', () => {
    const { sim, bot } = finale();
    discharge(bot);
    const lost = bot.room();
    const retreat = planPath(bot.plan(), bot.floor().roomId, 'r00')[0]!;
    expect(bot.useDoor(retreat)).toBe(true);
    const before = GameSnapshotSchema.parse(bot.snapshot());
    expect(before.collapse!.lostRoomIds).not.toContain(lost.id);
    expect(selectDoorViews(bot.room(), before.floor).find((door) => door.toRoomId === lost.roomId)?.state).toBe('open');
    for (let i = 0; i <= Math.ceil(ROOM_LOST_DELAY_MS / TICK_MS); i++) bot.tick();
    const snapshot = GameSnapshotSchema.parse(bot.snapshot());
    expect(snapshot.collapse!.lostRoomIds).toContain(lost.id);
    expect(lost.id).not.toBe(lost.roomId);
    const views = selectDoorViews(bot.room(), snapshot.floor);
    expect(views.find((door) => door.toRoomId === snapshot.collapse!.nextRoomId)?.state).toBe('open');
    expect(bot.useDoor(lost.roomId!, 90)).toBe(false);
    expect(sim.getSnapshot().roomId).toBe(snapshot.roomId);
    expect(views.find((door) => door.toRoomId === lost.roomId)?.state).toBe('sealed');
  });

  it('gives the last connected operative the solo escape allowance', () => {
    const { sim, bot } = finale();
    const living = bot.snapshot().players.filter((player) => player.hp > 0);
    expect(living.length).toBeGreaterThan(1);
    const anchor = bot.snapshot().anchor!;
    const present = [...living].sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))[0]!;
    for (const player of bot.snapshot().players) {
      if (player.id !== present.id) sim.setPlayerConnected(player.id, false);
    }
    discharge(bot);
    const collapse = bot.snapshot().collapse!;
    const hops = planPath(bot.plan(), bot.floor().roomId, 'r00').length;
    expect(collapse.totalMs).toBe(collapseMs(hops, true));
  });
});
