/**
 * `scripts/coop-e2e.mjs` cannot import the TypeScript sim — it is a standalone harness run with
 * bare `node` — so it carries a hand-written replica of the headquarters room and paths through it
 * with BFS. A replica silently drifts: when the relic brackets and the class plinths were added to
 * the hub, the harness kept walking through them, and nobody noticed because nothing failed.
 *
 * This test is the tripwire. It reads the harness as text and checks that the tiles it blocks are
 * exactly the ones the real room blocks. It deliberately does not import the harness: importing it
 * would run it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { headquartersRoom } from '../../src/sim/headquarters';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'scripts/coop-e2e.mjs'), 'utf8');

/** The harness's own blocking-prop footprints, read out of its source. */
function harnessFootprints(): Record<string, [number, number]> {
  const match = /const BLOCKING_PROPS = \{([^}]*)\}/.exec(SOURCE);
  expect(match, 'BLOCKING_PROPS not found in scripts/coop-e2e.mjs').not.toBeNull();
  const out: Record<string, [number, number]> = {};
  for (const [, id, w, h] of match![1]!.matchAll(/(\w+):\s*\[(\d+),\s*(\d+)\]/g)) {
    out[id!] = [Number(w), Number(h)];
  }
  return out;
}

/** Every tile a prop list makes solid, as "x,y". */
function blockedTiles(props: ReadonlyArray<{ propId: string; x: number; y: number }>, footprints: Record<string, [number, number]>): Set<string> {
  const tiles = new Set<string>();
  for (const prop of props) {
    const size = footprints[prop.propId];
    if (!size) continue;
    for (let dy = 0; dy < size[1]; dy++) for (let dx = 0; dx < size[0]; dx++) tiles.add(`${prop.x + dx},${prop.y + dy}`);
  }
  return tiles;
}

/** The replica's prop list, evaluated out of the harness source without running the harness. */
function replicaProps(): Array<{ propId: string; x: number; y: number }> {
  const stations = /const stations = (\[[^;]*?\]);/.exec(SOURCE);
  const brackets = /const relicBrackets = (\[[^;]*?\]);/.exec(SOURCE);
  const extras = [...SOURCE.matchAll(/\{ propId: '(\w+)', x: (\d+), y: (\d+) \}/g)];
  expect(stations, 'stations list not found in headquartersRoom()').not.toBeNull();
  expect(brackets, 'relicBrackets list not found in headquartersRoom()').not.toBeNull();
  const pairs = (src: string): Array<[number, number]> => JSON.parse(src.replace(/\s+/g, ''));
  return [
    ...pairs(stations![1]!).map(([x, y]) => ({ propId: 'terminal', x, y })),
    ...pairs(brackets![1]!).map(([x, y]) => ({ propId: 'monolith_shard', x, y })),
    ...extras.map(([, propId, x, y]) => ({ propId: propId!, x: Number(x), y: Number(y) })),
  ];
}

describe("coop-e2e.mjs's headquarters replica", () => {
  it('blocks exactly the tiles the real headquarters room blocks', () => {
    const footprints = harnessFootprints();
    const real = blockedTiles(headquartersRoom.props ?? [], footprints);
    const replica = blockedTiles(replicaProps(), footprints);
    const missing = [...real].filter((tile) => !replica.has(tile)).sort();
    const extra = [...replica].filter((tile) => !real.has(tile)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('includes the relic brackets and the class plinths the hub grew after the replica was written', () => {
    const footprints = harnessFootprints();
    const replica = blockedTiles(replicaProps(), footprints);
    // Five 1x2 brackets on the north wall of the returns hall.
    for (const x of [12, 13, 14, 16, 17]) expect(replica.has(`${x},1`)).toBe(true);
    // The class plinths station ("service record") at (24, 8).
    expect(replica.has('24,8')).toBe(true);
  });
});
