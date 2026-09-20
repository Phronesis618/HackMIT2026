/**
 * What the Custodian and the collapse look like: the pattern-specific telegraph detail, the
 * phase-3 shield whose opacity IS its damage reduction, the floor the boss has marked or
 * corrupted, and — after the Anchor holds — the ring closing in, the way out, and the pedestals.
 *
 * Owner: Agent B1. Spec: docs/design/BOSS_FINALE.md §9. Drawn on the telegraph layer, so
 * RoomScene needs exactly one additive call.
 *
 * Colour: amber for a wind-up, never dark red. The research on telegraphing is explicit that
 * dark red is the wrong danger colour and that bright orange reads at a glance.
 */
import type Phaser from 'phaser';
import type { GameSnapshot, Palette, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { CUSTODIAN_PATTERNS } from '../../shared/custodian';
import { perimeterTiles } from '../../sim/boss';
import { hexInt } from './color';

/** Amber `#f2bb71`: the same warm edge the breakable walls use. */
const AMBER = 0xf2bb71;
const HAZARD = 0xff5c7a;
const SHIELD = 0x7cf5ff;

function tilePoint(key: string): { x: number; y: number } {
  const [col, row] = key.split(',').map(Number);
  return tileToWorld(col ?? 0, row ?? 0);
}

function fillTile(g: Phaser.GameObjects.Graphics, key: string, color: number, alpha: number): void {
  const at = tilePoint(key);
  g.fillStyle(color, alpha).fillRect(at.x - TILE_SIZE / 2, at.y - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
}

export function drawBossFx(
  g: Phaser.GameObjects.Graphics, snapshot: GameSnapshot, room: RoomSpec, palette: Palette, timeMs: number,
): void {
  const pulse = 0.5 + Math.sin(timeMs / 220) * 0.5;
  const field = snapshot.bossField;
  if (field) {
    // Marked tiles are a warning while `live` is false, and a hazard the moment it flips.
    for (const key of field.tiles) fillTile(g, key, field.live ? HAZARD : AMBER, field.live ? 0.3 : 0.1 + pulse * 0.12);
    // Corruption is permanent for the rest of the fight: the speed lane you used turns on you.
    for (const key of field.corrupted) {
      fillTile(g, key, HAZARD, 0.18);
      const at = tilePoint(key);
      g.lineStyle(1, HAZARD, 0.35).strokeRect(at.x - TILE_SIZE / 2, at.y - TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
    }
  }

  for (const enemy of snapshot.enemies) {
    if (enemy.hp <= 0) continue;
    const spec = enemy.patternId ? CUSTODIAN_PATTERNS[enemy.patternId] : null;
    const telegraph = enemy.telegraph;
    if (spec && telegraph) {
      // One extra shape per pattern, on top of RoomScene's generic wind-up, so the tell is the
      // pattern and not just "something is coming".
      if (enemy.patternId === 'sweep_arc') {
        const wedge = 0.5 + (1 - Math.min(1, telegraph.remainingMs / spec.telegraphMs)) * 1.2;
        g.lineStyle(2, AMBER, 0.8).beginPath()
          .arc(telegraph.x, telegraph.y, spec.range, telegraph.facing - wedge / 2, telegraph.facing + wedge / 2, false).strokePath();
        g.lineStyle(1, AMBER, 0.5).strokeCircle(telegraph.x, telegraph.y, 70);
      } else if (enemy.patternId === 'siege_charge') {
        const ex = telegraph.x + Math.cos(telegraph.facing) * spec.range;
        const ey = telegraph.y + Math.sin(telegraph.facing) * spec.range;
        g.lineStyle(30, AMBER, 0.14).lineBetween(telegraph.x, telegraph.y, ex, ey);
        g.lineStyle(2, AMBER, 0.9).lineBetween(telegraph.x, telegraph.y, ex, ey);
      } else if (enemy.patternId === 'shatter_step') {
        // The after-image is a free half-second read: it stands where the boss will arrive.
        g.lineStyle(2, AMBER, 0.6 + pulse * 0.4).strokeCircle(telegraph.x, telegraph.y, 26);
        g.lineStyle(1, AMBER, 0.4).strokeCircle(telegraph.x, telegraph.y, 240);
        g.lineStyle(1, AMBER, 0.35).lineBetween(enemy.x, enemy.y, telegraph.x, telegraph.y);
      } else if (enemy.patternId === 'tether_haul') {
        g.lineStyle(3, AMBER, 0.5 + pulse * 0.4).lineBetween(enemy.x, enemy.y, telegraph.x, telegraph.y);
      } else if (enemy.patternId === 'ring_bloom') {
        for (const radius of [40, 90, 150]) g.lineStyle(1, AMBER, 0.5).strokeCircle(enemy.x, enemy.y, radius);
      }
    }
    // The shield's opacity IS its damage reduction: the player reads the number directly.
    if ((enemy.shieldDr ?? 0) > 0) {
      const dr = enemy.shieldDr!;
      const radius = 44;
      g.lineStyle(2, SHIELD, 0.25 + dr * 0.7);
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + timeMs / 4000;
        const x = enemy.x + Math.cos(angle) * radius;
        const y = enemy.y + Math.sin(angle) * radius;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
      g.fillStyle(SHIELD, 0.06 + dr * 0.18).fillCircle(enemy.x, enemy.y, radius);
    }
  }

  const collapse = snapshot.collapse;
  if (!collapse) return;
  if (collapse.stage === 'collapse' && collapse.ringDepth > 0) {
    // The arena closes in from the walls: one tile every 25 seconds, three at most.
    for (const key of perimeterTiles(room, collapse.ringDepth)) fillTile(g, key, HAZARD, 0.22);
  }
  for (const card of collapse.offer) {
    const chosen = collapse.chosenKey === card.key;
    const held = card.votes.length > 0;
    const accent = hexInt(palette.accent);
    g.fillStyle(accent, chosen ? 0.4 : held ? 0.25 : 0.12).fillCircle(card.x, card.y, 22);
    g.lineStyle(chosen ? 3 : 2, accent, chosen ? 1 : 0.7).strokeCircle(card.x, card.y, 22);
    g.lineStyle(1, accent, 0.3 + pulse * 0.3).strokeCircle(card.x, card.y, 30 + (held ? 6 : 0));
  }
}
