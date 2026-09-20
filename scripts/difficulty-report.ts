/**
 * difficulty-report.ts — sim-level difficulty measurement for the floors demo decision.
 *
 *   npx tsx scripts/difficulty-report.ts [--seeds 10] [--preset] [--out /tmp/relay-difficulty]
 *
 * For every fixture x class x seed, laws ON and OFF, it plays BIOME 1 (tier 0) with the
 * repo's own sim bot (tests/sim/floorsBot.ts: hazard stepping, kiting, Q/E/R, rest rooms)
 * and records rooms cleared, HP at each room exit, attributed cause of death and ms/room.
 * Then, from a tier-4 exit room, it fights the Custodian with tests/sim/finaleBot.ts and
 * records win rate, fight time and cause of death.
 *
 * `--preset` re-runs everything with the proposed demo tuning applied. The override is done
 * INSIDE this script: it rewrites src/sim/tuning.ts, runs a child process (the constants are
 * captured at module load, so a fresh process is the only honest way), and restores the file
 * in a `finally` plus an exit hook. Nothing is left modified.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TUNING_PATH = resolve(ROOT, 'src/sim/tuning.ts');

// ---------------------------------------------------------------------------------------
// The proposed demo preset. Keys are DEMO_TUNING keys; every one of these already exists in
// src/sim/tuning.ts, so applying the preset is a pure constants change.
// ---------------------------------------------------------------------------------------
export const DEMO_PRESET: Record<string, number> = {
  // Every value is inside the safe range docs/TUNING.md already publishes for that knob.
  tierScalePerTier: 0.1,      // 0.18 -> tier 4 is x1.40 instead of x1.72 (range 0.10-0.25)
  restHealFraction: 0.6,      // 0.4  -> a rest site is worth crossing the biome for (range 0.25-0.6)
  bossHpBase: 850,            // 1200 -> a solo Custodian is a demo-length fight (range 800-1800)
  bossHitCap: 0.18,           // 0.12 -> an ultimate is allowed to matter (range 0.08-0.18)
  corruptedFloorTickMs: 900,  // 600  -> crossing the boss floor is survivable at 48 max HP (range 450-900)
  corruptedFloorDamage: 6,    // 10   -> (range 6-16)
  hazardIntervalMs: 600,      // 450  -> (range 350-600)
  hazardBase: 2,              // 3    -> ramp is 2,4,6,8 (range 2-4)
  hazardStackMax: 4,          // 5    -> (range 4-6)
};

const FIXTURES = ['vantage-spire', 'crystal-tide', 'root-archive'] as const;
const CLASSES = ['bastion', 'shade', 'beacon', 'weaver'] as const;

export interface RoomRecord {
  roomId: string;
  kind: string | undefined;
  hpOut: number;
  maxHp: number;
  ms: number;
  enemies: string[];
}
export interface RunRecord {
  fixture: string;
  classId: string;
  seed: string;
  laws: boolean;
  roomsCleared: number;
  roomsTotal: number;
  survived: boolean;
  maxHp: number;
  hpEnd: number;
  cause: string | null;
  deathRoom: string | null;
  /** True when the run ended with the operative ALIVE but the bot unable to continue (path/fight stall). */
  stalled: boolean;
  rooms: RoomRecord[];
  error?: string;
}
export interface BossRecord {
  fixture: string;
  classId: string;
  seed: string;
  laws: boolean;
  killed: boolean;
  wiped: boolean;
  seconds: number;
  cause: string | null;
  error?: string;
}

// =========================================================================================
// CHILD: the actual measurement. Imports the sim, which reads whatever tuning.ts says now.
// =========================================================================================
async function measure(seeds: number, outFile: string): Promise<void> {
  const { PreparedWorldSchema, WorldFixtureSchema } = await import('../src/shared/contracts');
  const { TILE_SIZE } = await import('../src/shared/conventions');
  const { upgradeToFloors } = await import('../src/shared/floorgen');
  const { DANGEROUS_TILES } = await import('../src/shared/registry');
  const { createSimulation } = await import('../src/sim/index');
  const { FloorsBot, makeProvider, planPath, steerIntent } = await import('../tests/sim/floorsBot');
  const { CLASS_COMBAT, clearPath } = await import('../src/sim/combat');
  const { PLAYER_RADIUS } = await import('../src/shared/conventions');
  const { buildSolidGrid } = await import('../src/sim/index');
  const { DANGEROUS_TILES: DANGER, WALKABLE_TILES, ENEMY_INFO } = await import('../src/shared/registry');
  const { fightCustodian } = await import('../tests/sim/finaleBot');

  const loadFixture = (name: string): unknown =>
    JSON.parse(readFileSync(resolve(ROOT, `fixtures/worlds/${name}.json`), 'utf8'));

  /** A floors world on `name`'s recipe. `laws: false` strips the authored laws (recipe laws always apply). */
  function buildWorld(name: string, seed: string, laws: boolean) {
    const parsed = WorldFixtureSchema.parse(loadFixture(name));
    const { laws: authored, ...bare } = parsed.recipe as Record<string, unknown>;
    const recipe = laws ? parsed.recipe : bare;
    const legacy = PreparedWorldSchema.parse({
      worldId: `diff-${name}-${seed}`, createdAt: 0, recipe, art: parsed.art,
      rooms: parsed.rooms, plannedRoomCount: 3,
      provenance: { source: 'fixture', label: 'DIFFICULTY REPORT', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
      receipt: { worldTitle: (recipe as { title: string }).title, source: 'fixture', headline: 'difficulty', lines: [] },
    });
    return upgradeToFloors(legacy, seed);
  }

  /**
   * A CLASS-AWARE fight policy. tests/sim/floorsBot.ts `fightIntent` retreats whenever the
   * target is nearer than a hard-coded 130 px — but Bastion's reach is CLASS_COMBAT.bastion.range
   * (~50) and Shade's is 42, so under that policy a melee operative can never land a hit and
   * simply absorbs damage until it dies. That is a BOT defect, not a difficulty signal, and it
   * is the single biggest confound in the earlier measurements. This policy kites at the band
   * the class's own weapon wants, and is otherwise the same bot.
   */
  function competentIntent(room: any, snapshot: any, player: any): any {
    if (player.hp <= 0) return {};
    const reach = CLASS_COMBAT[player.classId as 'bastion'].range;
    // Step off damaging floor first — same rule the shipped bot uses.
    const col = Math.floor(player.x / TILE_SIZE);
    const row = Math.floor(player.y / TILE_SIZE);
    if (DANGER.has(room.tiles[row]?.[col] ?? '')) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      room.tiles.forEach((line: string, y: number) => {
        for (let x = 0; x < line.length; x++) {
          if (!WALKABLE_TILES.has(line[x]!) || DANGER.has(line[x]!)) continue;
          const at = { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
          const d = Math.hypot(at.x - player.x, at.y - player.y);
          if (d < bestD) { bestD = d; best = at; }
        }
      });
      if (best) return { ...steerIntent(room, snapshot, player, best, true), aimX: player.x, aimY: player.y };
    }
    const living = snapshot.enemies.filter((e: any) => e.hp > 0);
    const target = [...living].sort((a: any, b: any) =>
      Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
    if (!target) return {};
    const grid = buildSolidGrid(room, snapshot.terrain?.brokenWalls ?? [], true);
    const d = Math.hypot(target.x - player.x, target.y - player.y) || 1;
    const sight = clearPath(grid, player, target) ||
      (d <= TILE_SIZE + ENEMY_INFO[target.enemyId as 'husk'].radius && clearPath(grid, player, target, 1, 'solid'));
    // Kite band keyed to the class's own range: close to 0.75x reach, back off below 0.45x.
    const want = reach * 0.75;
    const floorBand = reach * 0.45;
    let move: { moveX: number; moveY: number };
    if (!sight || d > want * 1.15) move = steerIntent(room, snapshot, player, target, true);
    else if (d < floorBand) move = { moveX: (player.x - target.x) / d, moveY: (player.y - target.y) / d };
    else move = { moveX: -(target.y - player.y) / d, moveY: (target.x - player.x) / d };
    const hurt = player.hp < player.maxHp * 0.6;
    // Dash out of a resolving telegraph aimed at us — the shipped floors bot never dashes at all.
    const tel = target.telegraph;
    const incoming = tel && tel.remainingMs <= 260 && Math.hypot(tel.x - player.x, tel.y - player.y) <= tel.range;
    if (incoming && player.dashCooldownMs <= 0) {
      return { moveX: -(target.y - player.y) / d, moveY: (target.x - player.x) / d, dash: true, aimX: target.x, aimY: target.y, attack: true };
    }
    return {
      ...move, aimX: target.x, aimY: target.y, attack: sight && d <= reach * 1.1,
      ability: hurt && player.abilityEUnlocked && (player.abilityECooldownMs ?? 0) === 0 ? 'e'
        : (player.ultCharge ?? 0) >= 100 && sight ? 'r' : (player.abilityQCooldownMs ?? 0) === 0 && sight ? 'q' : null,
    };
  }

  /** Fight the current room to a finish with `competentIntent`. Returns false on wipe/stall. */
  function competentFight(bot: any, sim: any, maxTicks = 9000): boolean {
    for (let i = 0; i < maxTicks; i++) {
      const snapshot = sim.getSnapshot();
      if (snapshot.phase !== 'expedition') return false;
      if (snapshot.players.every((p: any) => p.hp <= 0)) return false;
      const living = snapshot.enemies.filter((e: any) => e.hp > 0);
      if (living.length === 0 && snapshot.roomCleared) return true;
      const room = bot.room();
      bot.tick((player: any) => competentIntent(room, snapshot, player));
    }
    return false;
  }

  const runs: RunRecord[] = [];
  const bosses: BossRecord[] = [];

  for (const fixture of FIXTURES) {
    for (const classId of CLASSES) {
      for (let s = 0; s < seeds; s++) {
        const seed = `d${s}`;
        for (const laws of [true, false]) {
          runs.push(playBiomeOne(fixture, classId, seed, laws));
          bosses.push(playBoss(fixture, classId, seed, laws));
        }
      }
    }
  }

  function playBiomeOne(fixture: string, classId: string, seed: string, laws: boolean): RunRecord {
    const base: RunRecord = {
      fixture, classId, seed, laws, roomsCleared: 0, roomsTotal: 0, survived: false,
      maxHp: 0, hpEnd: 0, cause: null, deathRoom: null, stalled: false, rooms: [],
    };
    try {
      const world = buildWorld(fixture, seed, laws);
      const sim = createSimulation();
      sim.addPlayer({ id: 'op', displayName: 'op', classId: classId as never });
      sim.unlockAbility('op'); // a competent operative has E; biome 1 of a demo run would too
      sim.setHostPlayerId('op');
      sim.setWorld(world);
      const provider = makeProvider(world);
      const bot = new FloorsBot(sim, provider, ['op']);
      bot.events.push(...sim.enterRoom(0));
      const plan = bot.plan();
      base.roomsTotal = plan.rooms.length;
      base.maxHp = sim.getSnapshot().players[0]!.maxHp;

      // Attribution: remember, every tick, whether the operative stood on a damaging tile and
      // which enemies were within a plausible strike. The last such state before hp hit 0 is
      // what the death is attributed to. It is an attribution, not a sim-reported cause.
      let lastHp = base.maxHp;
      let lastCause = 'unknown';
      const watch = (): boolean => {
        const snap = sim.getSnapshot();
        const p = snap.players[0]!;
        if (p.hp < lastHp) {
          const room = bot.room();
          const col = Math.floor(p.x / TILE_SIZE);
          const row = Math.floor(p.y / TILE_SIZE);
          const onHazard = DANGEROUS_TILES.has(room.tiles[row]?.[col] ?? '');
          const near = snap.enemies.filter((e) => e.hp > 0)
            .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
          lastCause = onHazard ? `terrain:${room.tiles[row]?.[col]}` : near ? `enemy:${near.enemyId}` : 'unknown';
        }
        lastHp = p.hp;
        return p.hp <= 0;
      };

      // Walk the plan door by door, in depth order, clearing each room. Rest rooms are used.
      const order = [...plan.rooms].sort((a, b) => a.depth - b.depth);
      const started = Date.now();
      let roomStart = started;
      for (const node of order) {
        if (node.id !== bot.floor().roomId) {
          // Walk the plan ourselves so every fight on the way uses the class-aware policy;
          // FloorsBot.travel would clear intermediate rooms with the shipped 130 px kite.
          let ok = true;
          try {
            for (const next of planPath(bot.plan(), bot.floor().roomId, node.id)) {
              if (!bot.useDoor(next)) { ok = false; break; }
              if (!sim.getSnapshot().roomCleared && !competentFight(bot, sim)) { ok = false; break; }
            }
          } catch { ok = false; }
          if (!ok) { if (sim.getSnapshot().players[0]!.hp > 0) base.stalled = true; break; }
        }
        if (watch()) break;
        const room = bot.room();
        const enemies = [...new Set(sim.getSnapshot().enemies.map((e) => e.enemyId))];
        if (!sim.getSnapshot().roomCleared) {
          try {
            if (!competentFight(bot, sim) && sim.getSnapshot().players[0]!.hp > 0) base.stalled = true;
          } catch { if (sim.getSnapshot().players[0]!.hp > 0) base.stalled = true; }
        }
        if (watch()) {
          base.deathRoom = room.id;
          base.cause = lastCause;
          break;
        }
        if (room.feature === 'rest') { try { bot.useFocus(); } catch { /* ignore */ } }
        const p = sim.getSnapshot().players[0]!;
        base.rooms.push({ roomId: room.id, kind: room.kind, hpOut: p.hp, maxHp: p.maxHp, ms: Date.now() - roomStart, enemies });
        roomStart = Date.now();
        base.roomsCleared++;
      }
      const p = sim.getSnapshot().players[0]!;
      base.hpEnd = p.hp;
      base.survived = p.hp > 0 && base.roomsCleared >= base.roomsTotal - 1;
      if (p.hp > 0) base.stalled = base.stalled && !base.survived; else base.stalled = false;
      if (p.hp <= 0 && !base.cause) { base.cause = lastCause; base.deathRoom = base.deathRoom ?? bot.floor().roomId; }
      if (laws && base.cause) {
        const lawIds = ((world.recipe as { laws?: { lawId: string }[] }).laws ?? []).map((l) => l.lawId);
        base.cause = `${base.cause} [laws:${lawIds.join('+')}]`;
      }
    } catch (error) {
      base.error = String((error as Error).message ?? error).slice(0, 160);
    }
    return base;
  }

  function playBoss(fixture: string, classId: string, seed: string, laws: boolean): BossRecord {
    const out: BossRecord = { fixture, classId, seed, laws, killed: false, wiped: false, seconds: 0, cause: null };
    try {
      const world = buildWorld(fixture, seed, laws);
      const sim = createSimulation();
      sim.addPlayer({ id: 'op', displayName: 'op', classId: classId as never });
      sim.unlockAbility('op');
      sim.setHostPlayerId('op');
      sim.setWorld(world);
      sim.enterRoom(0);
      sim.devJumpToTier(4, 'exit');
      const before = sim.getSnapshot().players[0]!;
      const result = fightCustodian(sim, ['op'], 14_000);
      out.killed = result.killed;
      out.wiped = result.wiped;
      out.seconds = Math.round((result.ticks / 60) * 10) / 10;
      if (!result.killed) {
        const boss = sim.getSnapshot().enemies.find((e) => (e.bossPhase ?? 0) > 0 && e.maxHp >= 300);
        out.cause = result.wiped
          ? `custodian phase ${boss?.bossPhase ?? '?'} (hp ${boss?.hp ?? 0}/${boss?.maxHp ?? 0}, op maxHp ${before.maxHp})`
          : 'timeout';
      }
    } catch (error) {
      out.error = String((error as Error).message ?? error).slice(0, 160);
    }
    return out;
  }

  writeFileSync(outFile, JSON.stringify({ runs, bosses }, null, 1));
}

// =========================================================================================
// Reporting
// =========================================================================================
const pct = (n: number, d: number): string => (d === 0 ? '  -  ' : `${Math.round((n / d) * 100)}%`.padStart(5));

function table(label: string, data: { runs: RunRecord[]; bosses: BossRecord[] }): string[] {
  const lines = [`\n### ${label}`, '', 'BIOME 1 (tier 0) — cleared without dying, laws ON | laws OFF; avg rooms; avg HP% at exit'];
  lines.push('fixture        class    lawsON  lawsOFF  died  stall  roomsON/tot  hp%ON  top cause of death (laws ON)');
  for (const fixture of FIXTURES) {
    for (const classId of CLASSES) {
      const on = data.runs.filter((r) => r.fixture === fixture && r.classId === classId && r.laws);
      const off = data.runs.filter((r) => r.fixture === fixture && r.classId === classId && !r.laws);
      const okOn = on.filter((r) => r.survived).length;
      const okOff = off.filter((r) => r.survived).length;
      const diedOn = on.filter((r) => !r.survived && !r.stalled).length;
      const stallOn = on.filter((r) => r.stalled).length;
      const avgRooms = on.reduce((a, r) => a + r.roomsCleared, 0) / Math.max(1, on.length);
      const tot = on[0]?.roomsTotal ?? 0;
      const hp = on.flatMap((r) => r.rooms).map((r) => (r.maxHp ? r.hpOut / r.maxHp : 0));
      const avgHp = hp.length ? Math.round((hp.reduce((a, b) => a + b, 0) / hp.length) * 100) : 0;
      const causes = new Map<string, number>();
      for (const r of on) if (r.cause) causes.set(r.cause.split(' [')[0]!, (causes.get(r.cause.split(' [')[0]!) ?? 0) + 1);
      const top = [...causes].sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `${fixture.padEnd(15)}${classId.padEnd(9)}${pct(okOn, on.length)}   ${pct(okOff, off.length)}  ` +
        `${String(diedOn).padStart(4)}  ${String(stallOn).padStart(5)}  ` +
        `${avgRooms.toFixed(1).padStart(4)}/${String(tot).padEnd(3)}  ${String(avgHp).padStart(4)}%  ${top ? `${top[0]} x${top[1]}` : '-'}`,
      );
    }
  }
  lines.push('', 'TIER-4 CUSTODIAN, solo — win rate, avg win time (s)');
  lines.push('fixture        class    winON  winOFF  t(s)ON  cause (laws ON)');
  for (const fixture of FIXTURES) {
    for (const classId of CLASSES) {
      const on = data.bosses.filter((b) => b.fixture === fixture && b.classId === classId && b.laws);
      const off = data.bosses.filter((b) => b.fixture === fixture && b.classId === classId && !b.laws);
      const wOn = on.filter((b) => b.killed);
      const wOff = off.filter((b) => b.killed);
      const t = wOn.length ? (wOn.reduce((a, b) => a + b.seconds, 0) / wOn.length).toFixed(1) : '-';
      const causes = new Map<string, number>();
      for (const b of on) if (b.cause) causes.set(b.cause.replace(/\(.*\)/, '').trim(), (causes.get(b.cause.replace(/\(.*\)/, '').trim()) ?? 0) + 1);
      const top = [...causes].sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `${fixture.padEnd(15)}${classId.padEnd(9)}${pct(wOn.length, on.length)}  ${pct(wOff.length, off.length)}  ` +
        `${t.padStart(6)}  ${top ? `${top[0]} x${top[1]}` : '-'}`,
      );
    }
  }
  return lines;
}

function summary(label: string, d: { runs: RunRecord[]; bosses: BossRecord[] }): string {
  const on = d.runs.filter((r) => r.laws);
  const worstClear = Math.min(...FIXTURES.flatMap((f) => CLASSES.map((c) => {
    const set = on.filter((r) => r.fixture === f && r.classId === c);
    return set.length ? set.filter((r) => r.survived).length / set.length : 1;
  })));
  const bon = d.bosses.filter((b) => b.laws);
  const worstBoss = Math.min(...FIXTURES.flatMap((f) => CLASSES.map((c) => {
    const set = bon.filter((b) => b.fixture === f && b.classId === c);
    return set.length ? set.filter((b) => b.killed).length / set.length : 1;
  })));
  const bastionWins = bon.filter((b) => b.classId === 'bastion' && b.killed);
  const bastionT = bastionWins.length ? bastionWins.reduce((a, b) => a + b.seconds, 0) / bastionWins.length : 0;
  return `${label}: biome-1 clear ${Math.round(on.filter((r) => r.survived).length / on.length * 100)}% overall, ` +
    `worst class/fixture ${Math.round(worstClear * 100)}%; Custodian solo ${Math.round(bon.filter((b) => b.killed).length / bon.length * 100)}% overall, ` +
    `worst ${Math.round(worstBoss * 100)}%; Bastion avg win ${bastionT.toFixed(1)}s`;
}

// =========================================================================================
// PARENT
// =========================================================================================
function applyPreset(): string {
  const original = readFileSync(TUNING_PATH, 'utf8');
  let patched = original;
  for (const [key, value] of Object.entries(DEMO_PRESET)) {
    const re = new RegExp(`(\\n  ${key}: )[-0-9.]+(,)`);
    if (!re.test(patched)) throw new Error(`tuning.ts has no key ${key}`);
    patched = patched.replace(re, `$1${value}$2`);
  }
  writeFileSync(TUNING_PATH, patched);
  return original;
}

function child(seeds: number, out: string): { runs: RunRecord[]; bosses: BossRecord[] } {
  execFileSync('npx', ['tsx', resolve(ROOT, 'scripts/difficulty-report.ts')], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, RELAY_DIFF_CHILD: out, RELAY_DIFF_SEEDS: String(seeds) },
    timeout: 20 * 60_000,
  });
  return JSON.parse(readFileSync(out, 'utf8'));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };

  if (process.env.RELAY_DIFF_CHILD) {
    await measure(Number(process.env.RELAY_DIFF_SEEDS ?? 10), process.env.RELAY_DIFF_CHILD);
    return;
  }

  const seeds = Number(arg('seeds', '10'));
  const out = arg('out', '/tmp/relay-difficulty');
  mkdirSync(out, { recursive: true });
  const wantPreset = argv.includes('--preset');
  // --render re-prints the tables from JSON already on disk, without replaying anything.
  const render = argv.includes('--render');

  console.log(`# RELAY difficulty report — ${seeds} seeds x 4 classes x 3 fixtures, laws ON and OFF`);
  const baseline = render
    ? JSON.parse(readFileSync(`${out}/baseline.json`, 'utf8'))
    : child(seeds, `${out}/baseline.json`);
  const lines = table('BASELINE (main as shipped)', baseline);

  let preset: { runs: RunRecord[]; bosses: BossRecord[] } | null = null;
  if (render && wantPreset) {
    preset = JSON.parse(readFileSync(`${out}/preset.json`, 'utf8'));
    lines.push(...table('DEMO PRESET', preset!));
  } else if (wantPreset) {
    const original = applyPreset();
    const restore = (): void => { try { writeFileSync(TUNING_PATH, original); } catch { /* best effort */ } };
    process.on('exit', restore);
    try {
      preset = child(seeds, `${out}/preset.json`);
    } finally {
      restore();
    }
    lines.push(...table('DEMO PRESET', preset));
  }

  lines.push('', summary('BEFORE', baseline));
  if (preset) lines.push(summary('AFTER ', preset));
  lines.push('', `preset values: ${JSON.stringify(DEMO_PRESET)}`);
  const text = lines.join('\n');
  console.log(text);
  writeFileSync(`${out}/report.txt`, text);
  console.log(`\nJSON + table in ${out}/`);
}

void main();
