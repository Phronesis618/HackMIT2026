import type { EnemyState, PlayerState } from '../../shared/contracts';
import { ENEMY_INFO } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import type { G } from './drawing';

export function drawOperative(g: G, player: Pick<PlayerState, 'classId' | 'state'>, local: boolean): void {
  const accent = hexToInt(local ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent);
  const ink = hexToInt(tokens.color.ink700);
  const outline = hexToInt(tokens.canvas.playerOutline);
  const dashing = player.state === 'dashing';
  g.clear();
  g.fillStyle(accent, dashing ? 0.15 : 0.06).fillEllipse(-4, 0, dashing ? 46 : 32, 30);
  g.fillStyle(ink, 1).fillTriangle(-18, -12, 7, 0, -18, 12);
  g.lineStyle(1, accent, 0.65).lineBetween(-18, -12, -7, -9).lineBetween(-18, 12, -7, 9);
  g.fillStyle(hexToInt(tokens.color.ink500), 1).fillRoundedRect(-7, -10, 16, 20, 5);
  g.fillStyle(outline, 1).fillRoundedRect(-3, -7, 13, 14, 5);
  g.fillStyle(ink, 1).fillRoundedRect(4, -6, 7, 12, 2);
  g.fillStyle(accent, 1).fillRect(8, -4, 3, 8);
  g.fillStyle(ink, 1).fillRoundedRect(-7, -14, 12, 6, 2).fillRoundedRect(-7, 8, 12, 6, 2);
  switch (player.classId) {
    case 'bastion':
      g.fillStyle(outline, 1).fillRoundedRect(0, -19, 10, 9, 2);
      g.fillStyle(accent, 1).fillRect(7, -18, 3, 7);
      g.fillStyle(outline, 0.85).fillRect(4, 13, player.state === 'attacking' ? 25 : 16, 3);
      break;
    case 'shade':
      g.fillStyle(accent, 0.8).fillTriangle(-22, -10, -11, 0, -22, 10);
      g.lineStyle(2, outline, 1).lineBetween(4, -13, 20, -15).lineBetween(4, 13, 20, 15);
      break;
    case 'beacon':
      g.lineStyle(2, accent, 0.85).strokeCircle(-5, 0, 16);
      g.fillStyle(outline, 1).fillRect(4, 12, 22, 5);
      break;
    case 'weaver':
      g.lineStyle(1, accent, 0.7).strokeEllipse(-5, 0, 20, 38);
      g.fillStyle(accent, 1).fillCircle(-5, -19, 3).fillCircle(-5, 19, 3);
      break;
  }
  if (player.state === 'hit') g.fillStyle(0xffffff, 0.75).fillRoundedRect(-7, -10, 18, 20, 5);
  if (player.state === 'down') {
    g.lineStyle(3, hexToInt(tokens.color.danger), 1).lineBetween(-5, -5, 5, 5).lineBetween(-5, 5, 5, -5);
  }
}

export function drawHostile(g: G, enemy: Pick<EnemyState, 'enemyId' | 'state'>): void {
  const r = ENEMY_INFO[enemy.enemyId].radius;
  const danger = hexToInt(tokens.canvas.enemyAccent);
  const ink = hexToInt(tokens.color.ink700);
  g.clear();
  g.fillStyle(ink, 1).lineStyle(2, danger, 0.9);
  switch (enemy.enemyId) {
    case 'husk':
      g.fillTriangle(-r, -r * 0.8, r, 0, -r, r * 0.8);
      g.strokeTriangle(-r, -r * 0.8, r, 0, -r, r * 0.8);
      g.lineBetween(-r, -r, -r - 4, -4).lineBetween(-r, r, -r - 4, 4);
      break;
    case 'sentinel':
      g.fillRoundedRect(-r, -r, r * 2, r * 2, 4).strokeRoundedRect(-r, -r, r * 2, r * 2, 4);
      g.fillStyle(danger, 0.5).fillRect(r - 3, -r - 5, 6, r * 2 + 10);
      g.lineBetween(-r + 5, -r + 4, -r + 5, r - 4);
      break;
    case 'lurker':
      g.fillTriangle(-r - 8, -r, r + 6, 0, -r - 8, r);
      g.strokeTriangle(-r - 8, -r, r + 6, 0, -r - 8, r);
      g.lineBetween(-4, -6, -8, -18).lineBetween(-4, 6, -8, 18);
      g.lineBetween(-10, -4, -22, -12).lineBetween(-10, 4, -22, 12);
      break;
    case 'guardian':
      g.fillCircle(0, 0, r).strokeCircle(0, 0, r);
      g.lineStyle(3, danger, 0.55).strokeCircle(0, 0, r - 8);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const x = Math.cos(a) * (r + 1);
        const y = Math.sin(a) * (r + 1);
        g.fillStyle(ink, 1).fillRect(x - 5, y - 5, 10, 10);
        g.lineStyle(1, danger, 1).strokeRect(x - 5, y - 5, 10, 10);
      }
      break;
  }
  g.fillStyle(enemy.state === 'hit' ? 0xffffff : danger, 1).fillTriangle(0, -5, 9, 0, 0, 5);
  if (enemy.state === 'attacking') {
    g.lineStyle(2, hexToInt(tokens.canvas.telegraph), 0.9);
    g.beginPath().arc(0, 0, r + 10, -Math.PI / 3, Math.PI / 3).strokePath();
  }
}
