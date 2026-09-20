/**
 * A test operative that actually plays the Custodian fight: it steps off marked tiles, dashes
 * out of a resolving telegraph, kites at weapon range and holds a relay in phase 3.
 *
 * Only real intents go in (move, aim, attack, ability, dash, interact); no sim internals are
 * touched. It exists so the finale tests can assert the fight is survivable and finishes, which
 * is the acceptance metric docs/design/BOSS_FINALE.md §3.1 asks for.
 */
import type { GameEvent, GameSnapshot, PlayerIntent, PlayerState } from '../../src/shared/contracts';
import { TILE_SIZE, worldToTile } from '../../src/shared/conventions';
import type { Simulation } from '../../src/sim';
import { RELAY_HOLD_RANGE } from '../../src/sim/boss';

export interface BotOptions {
  /** Stand on relays once the shield is up. Off for the tests that measure raw phase timing. */
  holdRelays?: boolean;
  /** Stop the fight early (e.g. "once phase 3 starts"). */
  stopWhen?: (snapshot: GameSnapshot) => boolean;
  /** Pathfinding for rooms with props in the way; straight lines are used without it. */
  steer?: (from: { x: number; y: number }, to: { x: number; y: number }) => { moveX: number; moveY: number };
}

function hazardAt(snapshot: GameSnapshot, x: number, y: number): boolean {
  const field = snapshot.bossField;
  if (!field) return false;
  const { col, row } = worldToTile(x, y);
  const key = `${col},${row}`;
  return field.corrupted.includes(key) || (field.live && field.tiles.includes(key));
}

/** Never walk into a marked or corrupted tile: rotate the intended direction until it is clear. */
function safeMove(snapshot: GameSnapshot, me: PlayerState, move: { moveX: number; moveY: number }): { moveX: number; moveY: number } {
  if (!snapshot.bossField) return move;
  for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
    const angle = Math.atan2(move.moveY, move.moveX) + turn;
    const step = { moveX: Math.cos(angle), moveY: Math.sin(angle) };
    if (!hazardAt(snapshot, me.x + step.moveX * TILE_SIZE, me.y + step.moveY * TILE_SIZE)) return step;
  }
  return move;
}

/** One operative's intent for this tick. Deterministic: same snapshot in, same intent out. */
export function custodianFightIntent(snapshot: GameSnapshot, me: PlayerState, options: BotOptions = {}): Partial<PlayerIntent> {
  const living = snapshot.enemies.filter((e) => e.hp > 0);
  const nearest = [...living].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  // The Custodian first (it is the one with the health bar); everything else it left behind after.
  const boss = living.find((e) => (e.bossPhase ?? 0) > 0 && e.maxHp >= 300) ?? nearest[0];
  if (!boss) return {};
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const d = Math.hypot(dx, dy) || 1;
  const toward = (target: { x: number; y: number }): { moveX: number; moveY: number } => {
    if (options.steer) return options.steer(me, target);
    const distance = Math.hypot(target.x - me.x, target.y - me.y) || 1;
    return { moveX: (target.x - me.x) / distance, moveY: (target.y - me.y) / distance };
  };
  const aim = { aimX: boss.x, aimY: boss.y };
  const ability = (me.ultCharge ?? 0) >= 100 ? 'r' as const
    : me.abilityEUnlocked === true && (me.abilityECooldownMs ?? 0) === 0 ? 'e' as const
      : (me.abilityQCooldownMs ?? 0) === 0 ? 'q' as const : null;
  // A telegraph about to land, with us inside its cone: dash across it.
  const telegraph = boss.telegraph;
  const incoming = telegraph !== null && telegraph !== undefined && telegraph.remainingMs <= 260 &&
    Math.hypot(telegraph.x - me.x, telegraph.y - me.y) <= telegraph.range;
  const sideways = { moveX: -dy / d, moveY: dx / d };
  if (incoming && me.dashCooldownMs <= 0) return { ...aim, ...sideways, dash: true, attack: true };
  // A bolt about to arrive: dash across its line. Bullet-hell bolts are meant to be dodged.
  const bolt = (snapshot.projectiles ?? []).find((p) => {
    const toward = (me.x - p.x) * p.vx + (me.y - p.y) * p.vy;
    return toward > 0 && Math.hypot(p.x - me.x, p.y - me.y) < 60;
  });
  if (bolt && me.dashCooldownMs <= 0) {
    const speed = Math.hypot(bolt.vx, bolt.vy) || 1;
    return { ...aim, moveX: -bolt.vy / speed, moveY: bolt.vx / speed, dash: true, attack: true };
  }
  // Standing in a live pattern or on corrupted floor: step off, that is the whole counterplay.
  if (hazardAt(snapshot, me.x, me.y)) {
    const options8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
    const escape = options8.find(([ex, ey]) => !hazardAt(snapshot, me.x + ex * TILE_SIZE, me.y + ey * TILE_SIZE));
    if (escape) return { ...aim, moveX: escape[0], moveY: escape[1], attack: true, ability };
  }
  const reach = me.classId === 'beacon' ? 190 : me.classId === 'weaver' ? 110 : 40;
  const relays = snapshot.anchor?.ritual?.relays ?? [];
  if (options.holdRelays !== false && (boss.shieldDr ?? 0) > 0 && relays.length > 0) {
    // The shield only opens while relays are held: that is what phase 3 is for. Solo, the latch
    // makes it a route problem — arm a relay, then go back and burn the window it leaves open.
    const usable = relays.filter((relay) => relay.inert !== true);
    const held = usable.filter((relay) => (relay.latchedMs ?? 0) > 0 ||
      snapshot.players.some((p) => p.hp > 0 && Math.hypot(p.x - relay.x, p.y - relay.y) <= RELAY_HOLD_RANGE));
    // Two held is 30% reduction, which is the window the design asks the crew to make.
    const target = usable.filter((relay) => (relay.latchedMs ?? 0) === 0)
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    const crew = snapshot.players.filter((p) => p.hp > 0).length;
    // A relay on the far side of the room costs more uptime than the shield it opens; fight instead.
    const worthIt = target !== undefined && Math.hypot(target.x - me.x, target.y - me.y) < d + 200;
    if (target && worthIt && held.length < (crew >= 2 ? 2 : 1)) {
      const rd = Math.hypot(target.x - me.x, target.y - me.y);
      if (rd > RELAY_HOLD_RANGE * 0.5) {
        const step = toward(target);
        // Props can pin a straight approach against a corner; a slow sideways wobble frees it.
        const wobble = rd < 140 ? (Math.floor(snapshot.tick / 40) % 2 === 0 ? 0.6 : -0.6) : 0;
        const angle = Math.atan2(step.moveY, step.moveX) + wobble;
        return { ...aim, moveX: Math.cos(angle), moveY: Math.sin(angle), attack: true, ability };
      }
      return { ...aim, attack: true, ability };
    }
  }
  const move = d > reach * 1.15 ? toward(boss)
    : d < reach * 0.7 ? { moveX: -dx / d, moveY: -dy / d }
      : sideways;
  return { ...aim, ...safeMove(snapshot, me, move), attack: true, ability };
}

export interface FightResult {
  ticks: number;
  events: GameEvent[];
  /** Simulation ms spent in each phase. */
  phaseMs: Record<1 | 2 | 3, number>;
  killed: boolean;
  wiped: boolean;
}

/** Fights until the Custodian dies, the crew wipes, or `maxTicks` runs out. */
export function fightCustodian(sim: Simulation, playerIds: string[], maxTicks = 12_000, options: BotOptions = {}): FightResult {
  const events: GameEvent[] = [];
  const phaseMs: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  let seq = 0;
  for (let i = 0; i < maxTicks; i++) {
    const snapshot = sim.getSnapshot();
    const boss = snapshot.enemies.find((e) => (e.bossPhase ?? 0) > 0 && e.maxHp >= 300);
    // The room is only clear when the Custodian's summons are down too, and the ritual waits on that.
    if ((!boss || boss.hp <= 0) && (snapshot.roomCleared === true || snapshot.enemies.every((e) => e.hp <= 0))) {
      return { ticks: i, events, phaseMs, killed: true, wiped: false };
    }
    if (options.stopWhen?.(snapshot)) return { ticks: i, events, phaseMs, killed: false, wiped: false };
    if (snapshot.players.every((p) => p.hp <= 0)) return { ticks: i, events, phaseMs, killed: false, wiped: true };
    if (boss && boss.hp > 0) phaseMs[(boss.bossPhase ?? 1) as 1 | 2 | 3] += 1000 / 60;
    for (const player of snapshot.players) {
      if (!playerIds.includes(player.id) || player.hp <= 0) continue;
      sim.applyIntent({
        playerId: player.id, seq: seq++, moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
        attack: false, dash: false, ability: null, interact: false,
        ...custodianFightIntent(snapshot, player, options),
      });
    }
    events.push(...sim.step());
  }
  return { ticks: maxTicks, events, phaseMs, killed: false, wiped: false };
}
