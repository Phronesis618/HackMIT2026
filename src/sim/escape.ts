/**
 * The collapse and the extraction: the run's last two minutes.
 *
 * Spec: docs/design/BOSS_FINALE.md §7, §8. Owner: Agent B1.
 *
 * The Anchor discharges, the world starts coming apart, and the crew walks back through the
 * rooms they cleared to the way they came in. Reaching the portal room stops the clock — no
 * edge cases, stated as geometry rather than as a timer. Running out of time is `stranded`,
 * not death: the world is saved, the memory wall still gets its anchor, and the crew loses the
 * souvenir rather than the run. Then they choose one thing to carry out, and that choice is a
 * real chronicle event.
 *
 * Everything here is pure over an `EscapeContext` the simulation supplies, so `simulation.ts`
 * keeps only small call-site hooks.
 */
import type { GameEventInput, LoreFragment, RoomSpec } from '../shared/contracts';
import { TICK_MS, worldToTile } from '../shared/conventions';
import { perimeterTiles } from './boss';

// --- timer (§7.3) ----------------------------------------------------------
export const COLLAPSE_BASE_MS = 45_000;
export const COLLAPSE_MS_PER_HOP = 15_000;
export const COLLAPSE_MIN_MS = 60_000;
export const COLLAPSE_MAX_MS = 180_000;
export const COLLAPSE_SOLO_MULTIPLIER = 1.2;

// --- what the collapse does to the rooms behind the crew (§7.4) ------------
export const ROOM_LOST_DELAY_MS = 3000;
export const COLLAPSE_RING_MS = 25_000;
export const COLLAPSE_RING_MAX = 3;
export const COLLAPSE_HAZARD_DAMAGE = 10;
export const COLLAPSE_HAZARD_TICK_MS = 600;
/** Revives are twice as fast while the world is coming down: failure costs tempo, not the run. */
export const COLLAPSE_REVIVE_MS = 1000;
/** A solo operative gets back up once, at 25 health, six seconds after going down. */
export const LAST_STAND_MS = 6000;
export const LAST_STAND_HP = 25;
/** A downed crew bleeds out; nobody is left to lift them. */
export const BLEED_OUT_MS = 8000;
export const COLLAPSE_CHASE_SPEED = 1.2;

// --- extraction (§8) -------------------------------------------------------
export const EXTRACTION_REVIVE_HP = 40;
export const PEDESTAL_RANGE = 42;
export const PEDESTAL_HOLD_MS = 1200;
export const EXTRACTION_DECIDE_MS = 20_000;

export type CollapseStage = 'collapse' | 'extraction' | 'complete' | 'stranded';

export interface OfferCard {
  /** `relic:3` | `remains:1` | `custodian_log`. */
  key: string;
  title: string;
  /** One line for the chronicle; never shown as a claim about anything that did not happen. */
  detail: string;
  votes: string[];
  x: number;
  y: number;
}

export interface CollapseRun {
  stage: CollapseStage;
  remainingMs: number;
  totalMs: number;
  hops: number;
  /** Room keys from the Anchor room to the portal, the Anchor room first. */
  route: string[];
  portalKey: string;
  portalRoomId: string;
  lostRoomIds: string[];
  /** Rooms the crew has left, waiting out ROOM_LOST_DELAY_MS before they are gone. */
  leaving: Array<{ key: string; roomId: string; ms: number }>;
  ringDepth: number;
  ringMs: number;
  hazardCooldown: Map<string, number>;
  downMs: Map<string, number>;
  lastStandUsed: Set<string>;
  wipeMs: number;
  offer: OfferCard[];
  chosenKey: string | null;
  holdMs: Map<string, number>;
  decideMs: number;
}

export interface EscapePlayer {
  id: string;
  x: number;
  y: number;
  hp: number;
}

export interface EscapeContext {
  worldId: string;
  room: RoomSpec;
  /** Key of the room the crew is standing in, in the same space as `route`. */
  roomKey: string;
  players(): EscapePlayer[];
  crewSize(): number;
  damagePlayer(playerId: string, source: string, damage: number): boolean;
  revive(playerId: string, hp: number): void;
  emit(event: GameEventInput): void;
}

/** Shortest path over the room graph, the start room first. Null when there is nowhere to go. */
export function planEscape(start: string, portal: string, neighbours: (key: string) => string[]): string[] | null {
  if (start === portal) return [start];
  const parents = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]!;
    if (key === portal) break;
    for (const next of neighbours(key)) {
      if (parents.has(next)) continue;
      parents.set(next, key);
      queue.push(next);
    }
  }
  if (!parents.has(portal)) return null;
  const path: string[] = [];
  for (let at: string | null = portal; at !== null; at = parents.get(at) ?? null) path.unshift(at);
  return path;
}

export function collapseMs(hops: number, solo: boolean): number {
  const base = Math.min(COLLAPSE_MAX_MS, Math.max(COLLAPSE_MIN_MS, COLLAPSE_BASE_MS + COLLAPSE_MS_PER_HOP * hops));
  return Math.round(solo ? base * COLLAPSE_SOLO_MULTIPLIER : base);
}

export function createCollapse(options: {
  route: string[];
  portalRoomId: string;
  solo: boolean;
}): CollapseRun {
  const hops = Math.max(0, options.route.length - 1);
  const totalMs = collapseMs(hops, options.solo);
  return {
    stage: 'collapse',
    remainingMs: totalMs,
    totalMs,
    hops,
    route: [...options.route],
    portalKey: options.route[options.route.length - 1] ?? '',
    portalRoomId: options.portalRoomId,
    lostRoomIds: [],
    leaving: [],
    ringDepth: 0,
    ringMs: COLLAPSE_RING_MS,
    hazardCooldown: new Map(),
    downMs: new Map(),
    lastStandUsed: new Set(),
    wipeMs: 0,
    offer: [],
    chosenKey: null,
    holdMs: new Map(),
    decideMs: EXTRACTION_DECIDE_MS,
  };
}

/** The door the crew should take next, so the renderer can draw a chevron at it. */
export function nextRoomKey(run: CollapseRun, roomKey: string): string | null {
  const at = run.route.indexOf(roomKey);
  if (at < 0 || at + 1 >= run.route.length) return null;
  return run.route[at + 1]!;
}

/** Rooms behind the crew fail three seconds after they leave, and cannot be re-entered. */
export function leaveRoom(run: CollapseRun, key: string, roomId: string): void {
  if (run.stage !== 'collapse' || key === run.portalKey) return;
  if (run.lostRoomIds.includes(roomId) || run.leaving.some((room) => room.key === key)) return;
  run.leaving.push({ key, roomId, ms: ROOM_LOST_DELAY_MS });
}

export function roomIsLost(run: CollapseRun | null, roomId: string): boolean {
  return run !== null && run.lostRoomIds.includes(roomId);
}

/**
 * One tick of the collapse: the clock, the ring closing in from the walls, the rooms failing
 * behind the crew, and the two ways the crew can run out of operatives.
 * Returns the outcome when the run ends here.
 */
export function stepCollapse(run: CollapseRun, ctx: EscapeContext): 'stranded' | null {
  if (run.stage !== 'collapse') return null;
  for (const room of run.leaving) room.ms -= TICK_MS;
  for (const room of run.leaving.filter((candidate) => candidate.ms <= 0)) {
    run.lostRoomIds.push(room.roomId);
    ctx.emit({ type: 'room_lost', worldId: ctx.worldId, roomId: room.roomId });
  }
  run.leaving = run.leaving.filter((room) => room.ms > 0);

  run.ringMs -= TICK_MS;
  if (run.ringMs <= 0 && run.ringDepth < COLLAPSE_RING_MAX) {
    run.ringDepth++;
    run.ringMs = COLLAPSE_RING_MS;
  }
  if (run.ringDepth > 0) {
    const ring = new Set(perimeterTiles(ctx.room, run.ringDepth));
    for (const player of ctx.players()) {
      if (player.hp <= 0) continue;
      const cooldown = (run.hazardCooldown.get(player.id) ?? 0) - TICK_MS;
      const { col, row } = worldToTile(player.x, player.y);
      if (!ring.has(`${col},${row}`)) {
        run.hazardCooldown.set(player.id, 0);
        continue;
      }
      if (cooldown > 0) {
        run.hazardCooldown.set(player.id, cooldown);
        continue;
      }
      ctx.damagePlayer(player.id, 'collapse', COLLAPSE_HAZARD_DAMAGE);
      run.hazardCooldown.set(player.id, COLLAPSE_HAZARD_TICK_MS);
    }
  }

  const living = ctx.players().filter((player) => player.hp > 0);
  if (living.length === 0) {
    // Solo: one last stand, six seconds on the floor. A second time, or a downed crew, is the end.
    const solo = ctx.crewSize() === 1;
    const alone = ctx.players()[0];
    if (solo && alone && !run.lastStandUsed.has(alone.id)) {
      const ms = (run.downMs.get(alone.id) ?? 0) + TICK_MS;
      run.downMs.set(alone.id, ms);
      if (ms >= LAST_STAND_MS) {
        run.lastStandUsed.add(alone.id);
        run.downMs.set(alone.id, 0);
        ctx.revive(alone.id, LAST_STAND_HP);
      }
    } else {
      run.wipeMs += TICK_MS;
      if (run.wipeMs >= BLEED_OUT_MS) {
        run.stage = 'stranded';
        return 'stranded';
      }
    }
  } else {
    run.wipeMs = 0;
    for (const player of living) run.downMs.set(player.id, 0);
  }

  run.remainingMs = Math.max(0, run.remainingMs - TICK_MS);
  if (run.remainingMs === 0) {
    run.stage = 'stranded';
    return 'stranded';
  }
  return null;
}

/**
 * Three pedestals, every card derived from something that actually happened this run, filled in
 * the design's priority order: relics read (most recent first), then remains recovered, then the
 * Custodian's own log. A crew that read nothing gets exactly one choice, which is a statement.
 */
export function buildOffer(options: {
  lore: LoreFragment[];
  /** Fragment indices in the order they were discovered. */
  discovered: number[];
  custodianLog: { title: string; detail: string } | null;
  at: Array<{ x: number; y: number }>;
}): OfferCard[] {
  const cards: Array<{ key: string; title: string; detail: string }> = [];
  const read = [...options.discovered].reverse();
  for (const index of read) {
    const fragment = options.lore[index];
    if (fragment?.kind !== 'relic' || cards.length >= 3) continue;
    cards.push({ key: `relic:${index}`, title: fragment.title, detail: `${fragment.source}. Read on the way in.` });
  }
  for (const index of read) {
    const fragment = options.lore[index];
    if (fragment?.kind !== 'remains' || cards.length >= 3) continue;
    cards.push({ key: `remains:${index}`, title: fragment.title, detail: `${fragment.source}. Recovered in the field.` });
  }
  if (cards.length < 3 && options.custodianLog) {
    cards.push({ key: 'custodian_log', title: options.custodianLog.title, detail: options.custodianLog.detail });
  }
  return cards.slice(0, 3).map((card, index) => ({
    ...card, votes: [], x: options.at[index]?.x ?? 0, y: options.at[index]?.y ?? 0,
  }));
}

/** The timer stops the moment the crew reaches the portal room. No edge cases. */
export function enterExtraction(run: CollapseRun, offer: OfferCard[], ctx: EscapeContext): void {
  if (run.stage !== 'collapse') return;
  run.stage = 'extraction';
  run.offer = offer;
  // Whatever the crew had just walked out of goes with the rest of the world.
  for (const room of run.leaving) {
    run.lostRoomIds.push(room.roomId);
    ctx.emit({ type: 'room_lost', worldId: ctx.worldId, roomId: room.roomId });
  }
  run.leaving = [];
  run.ringDepth = 0;
  ctx.emit({
    type: 'extraction_reached', worldId: ctx.worldId,
    playerIds: ctx.players().map((player) => player.id), remainingMs: Math.round(run.remainingMs),
  });
  // Nobody watches the ending from the floor.
  for (const player of ctx.players()) if (player.hp <= 0) ctx.revive(player.id, EXTRACTION_REVIVE_HP);
}

/**
 * Standing on a pedestal highlights it for everyone. Solo locks it with a 1.2 s hold; a crew
 * locks it when a majority of the living stand on the same one, and after 20 s the plurality
 * leader locks by itself. Ties break by lowest player id, the ordering the sim already uses.
 */
export function stepExtraction(run: CollapseRun, ctx: EscapeContext): OfferCard | null {
  if (run.stage !== 'extraction' || run.offer.length === 0) return null;
  const living = ctx.players().filter((player) => player.hp > 0);
  for (const card of run.offer) {
    card.votes = living.filter((player) => Math.hypot(player.x - card.x, player.y - card.y) <= PEDESTAL_RANGE)
      .map((player) => player.id).sort();
  }
  const majority = Math.floor(living.length / 2) + 1;
  for (const card of run.offer) {
    const held = (run.holdMs.get(card.key) ?? 0) + (card.votes.length > 0 ? TICK_MS : -TICK_MS);
    run.holdMs.set(card.key, Math.max(0, Math.min(PEDESTAL_HOLD_MS, held)));
    const solo = living.length <= 1;
    const locked = solo
      ? card.votes.length === 1 && (run.holdMs.get(card.key) ?? 0) >= PEDESTAL_HOLD_MS
      : card.votes.length >= majority;
    if (locked) return lock(run, card);
  }
  run.decideMs = Math.max(0, run.decideMs - TICK_MS);
  if (run.decideMs > 0) return null;
  // Time is up: the plurality leader, ties to the first pedestal (lowest id order).
  const leader = [...run.offer].sort((a, b) => b.votes.length - a.votes.length ||
    (a.votes[0] ?? '').localeCompare(b.votes[0] ?? '') || a.key.localeCompare(b.key))[0];
  return leader ? lock(run, leader) : null;
}

function lock(run: CollapseRun, card: OfferCard): OfferCard {
  run.chosenKey = card.key;
  run.stage = 'complete';
  return card;
}

/** What the snapshot carries; the HUD reads `remainingMs` and the panel reads `offer`. */
export function collapseSnapshot(run: CollapseRun, roomKey: string) {
  return {
    stage: run.stage,
    remainingMs: Math.round(run.remainingMs),
    totalMs: run.totalMs,
    ringDepth: run.ringDepth,
    portalRoomId: run.portalRoomId,
    lostRoomIds: run.lostRoomIds.slice(0, 40),
    offer: run.offer.map((card) => ({ key: card.key, title: card.title, x: card.x, y: card.y, votes: [...card.votes] })),
    chosenKey: run.chosenKey,
    ...(nextRoomKey(run, roomKey) !== null ? { nextRoomId: nextRoomKey(run, roomKey)! } : {}),
  };
}
