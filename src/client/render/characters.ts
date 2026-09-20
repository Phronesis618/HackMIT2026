/**
 * Character art (procedural vector, top-down). Figures are drawn facing +x; RoomScene
 * rotates the body to the entity's facing and redraws every frame so details animate.
 *
 * Silhouette rules: each class has ONE unmistakable shape read —
 *  Bastion  = tower shield + heavy arc-blade, broad octagon torso (cyan/amber)
 *  Shade    = twin blades + trailing scarf, narrow diamond torso (violet/magenta)
 *  Beacon   = lantern staff with a glowing head + halo (gold/cream)
 *  Weaver   = orbiting plasma orbs on a loom ring (teal/cyan)
 * Enemies: Husk (jagged spikes, one eye) · Sentinel (hex drone, lens) · Lurker (six legs) ·
 *          Guardian (rings + orbiting plates).
 */
import type { EnemyState, PlayerState } from '../../shared/contracts';
import { CLASS_THEME, ENEMY_INFO } from '../../shared/registry';
import { hexInt, lighten, darken, mix } from './color';
import type { G } from './fx';

const STEEL = '#2b3a5c';
const STEEL_LIGHT = '#4a5f8c';
const INK = '#0b0f1a';
const WHITE = 0xffffff;

type OperativeView = Pick<PlayerState, 'classId' | 'state'> & Partial<Pick<PlayerState, 'shieldMs' | 'shroudMs' | 'rallyMs' | 'invulnerableMs'>>;

export function drawOperative(g: G, player: OperativeView, local: boolean, timeMs = 0): void {
  const theme = CLASS_THEME[player.classId];
  const primary = hexInt(theme.primary);
  const secondary = hexInt(theme.secondary);
  const attacking = player.state === 'attacking';
  const dashing = player.state === 'dashing';
  const moving = player.state === 'moving' || dashing;
  const t = timeMs / 1000;
  const bob = Math.sin(t * (moving ? 14 : 3)) * (moving ? 1.6 : 0.6);
  g.clear();

  if (player.state === 'down') {
    g.fillStyle(hexInt(INK), 0.9).fillEllipse(0, 3, 34, 20);
    g.lineStyle(2, primary, 0.8).strokeEllipse(0, 3, 34, 20);
    g.lineStyle(3, 0xff5c7a, 1).lineBetween(-6, -4, 6, 6).lineBetween(-6, 6, 6, -4);
    return;
  }

  // Ground glow / motion aura
  g.fillStyle(primary, dashing ? 0.22 : 0.08).fillEllipse(-2, 2, dashing ? 52 : 36, dashing ? 26 : 30);
  if ((player.shroudMs ?? 0) > 0) g.fillStyle(0x5a3a8a, 0.35).fillCircle(0, 0, 22);
  if ((player.rallyMs ?? 0) > 0) g.lineStyle(2, 0xffcf8a, 0.6).strokeCircle(0, 0, 20 + Math.sin(t * 8) * 2);

  switch (player.classId) {
    case 'bastion':
      drawBastion(g, primary, secondary, attacking, bob, t);
      break;
    case 'shade':
      drawShade(g, primary, secondary, attacking, moving, bob, t);
      break;
    case 'beacon':
      drawBeacon(g, primary, secondary, attacking, bob, t);
      break;
    case 'weaver':
      drawWeaver(g, primary, secondary, attacking, bob, t);
      break;
  }

  if (local) g.lineStyle(1, WHITE, 0.35).strokeCircle(0, 0, 17);
  if (player.state === 'hit') g.fillStyle(WHITE, 0.55).fillCircle(0, 0, 15);
  if ((player.invulnerableMs ?? 0) > 0 && !dashing) g.lineStyle(1, WHITE, 0.25 + 0.2 * Math.sin(t * 30)).strokeCircle(0, 0, 19);
}

function drawBastion(g: G, primary: number, secondary: number, attacking: boolean, bob: number, t: number): void {
  const steel = hexInt(STEEL);
  const steelLight = hexInt(STEEL_LIGHT);
  // back plate / cape
  g.fillStyle(darken(STEEL, 0.4), 1).fillTriangle(-16, -9, -22, 0, -16, 9);
  // torso: octagon
  g.fillStyle(steel, 1);
  g.fillPoints(octagon(0, bob * 0.3, 12, 10), true);
  g.lineStyle(1.5, steelLight, 1).strokePoints(octagon(0, bob * 0.3, 12, 10), true);
  // plate highlight + rivets
  g.fillStyle(steelLight, 0.55).fillRect(-6, -7 + bob * 0.3, 8, 5);
  g.fillStyle(secondary, 1).fillCircle(-7, -8, 1.2).fillCircle(-7, 8, 1.2).fillCircle(6, -8, 1.2).fillCircle(6, 8, 1.2);
  // pauldrons (shoulders are along ±y in top-down)
  g.fillStyle(steel, 1).fillRoundedRect(-9, -17, 14, 8, 3).fillRoundedRect(-9, 9, 14, 8, 3);
  g.lineStyle(1, secondary, 0.9).strokeRoundedRect(-9, -17, 14, 8, 3).strokeRoundedRect(-9, 9, 14, 8, 3);
  // helmet with visor
  g.fillStyle(darken(STEEL, 0.15), 1).fillCircle(3, bob * 0.3, 6.5);
  g.fillStyle(primary, 1).fillRect(4, -3 + bob * 0.3, 5, 6);
  g.fillStyle(WHITE, 0.9).fillRect(6, -1.5 + bob * 0.3, 3, 3);
  // tower shield on the left arm (−y side), angled forward
  g.fillStyle(steel, 1).fillRoundedRect(-4, -26, 24, 9, 3);
  g.fillStyle(steelLight, 0.5).fillRoundedRect(-2, -25, 20, 3, 2);
  g.lineStyle(2, primary, 0.95).strokeRoundedRect(-4, -26, 24, 9, 3);
  g.fillStyle(secondary, 1).fillTriangle(8, -24, 12, -21.5, 8, -19);
  g.fillStyle(primary, 0.25 + 0.1 * Math.sin(t * 6)).fillRoundedRect(-6, -28, 28, 13, 5);
  // arc-blade on the right arm (+y side), pointing forward
  const reach = attacking ? 34 : 24;
  g.fillStyle(darken(STEEL, 0.2), 1).fillRect(2, 12, 8, 5);
  g.fillStyle(0xdbe4f7, 1).fillTriangle(8, 11, 8 + reach, 14.5, 8, 18);
  g.lineStyle(1.5, primary, 1).lineBetween(8, 11, 8 + reach, 14.5);
  if (attacking) g.lineStyle(3, primary, 0.5).lineBetween(8, 11, 8 + reach + 4, 14.5);
}

function drawShade(g: G, primary: number, secondary: number, attacking: boolean, moving: boolean, bob: number, t: number): void {
  const cloth = hexInt('#1a1330');
  // trailing scarf ribbons (behind = −x), waving
  for (const [side, phase] of [[-1, 0], [1, 1.7]] as const) {
    g.lineStyle(3, side < 0 ? secondary : primary, 0.85);
    let px = -8;
    let py = side * 5;
    for (let i = 1; i <= 5; i++) {
      const x = -8 - i * 7;
      const y = side * (5 + i * 2) + Math.sin(t * (moving ? 18 : 6) + phase + i * 0.9) * (moving ? 5 : 2.5);
      g.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
  }
  // narrow diamond torso
  g.fillStyle(cloth, 1).fillTriangle(-12, 0, 2, -8 + bob * 0.3, 8, 0).fillTriangle(-12, 0, 8, 0, 2, 8 + bob * 0.3);
  g.lineStyle(1, primary, 0.9).strokeTriangle(-12, 0, 2, -8 + bob * 0.3, 8, 0).strokeTriangle(-12, 0, 8, 0, 2, 8 + bob * 0.3);
  // hood: pointed forward with an eye slit
  g.fillStyle(darken('#1a1330', 0.3), 1).fillTriangle(-2, -7, 12, 0, -2, 7);
  g.fillStyle(cloth, 1).fillCircle(1, 0, 6);
  g.fillStyle(secondary, 1).fillRect(3, -1.5, 6, 3);
  g.fillStyle(WHITE, 0.9).fillCircle(6.5, 0, 1.2);
  // twin blades (±y), long, thin, glowing edges — crossed forward when attacking
  const len = attacking ? 30 : 22;
  const spread = attacking ? 6 : 11;
  const back = moving && !attacking ? -6 : 0;
  for (const side of [-1, 1] as const) {
    const y0 = side * spread;
    g.fillStyle(0xe8def7, 1).fillTriangle(2 + back, y0 - 1.5, 2 + back + len, y0 + side * 2, 2 + back, y0 + 1.5);
    g.lineStyle(1.5, side < 0 ? primary : secondary, 1).lineBetween(2 + back, y0 - side * 1.5, 2 + back + len, y0 + side * 2);
    g.fillStyle(cloth, 1).fillRect(-4 + back, y0 - 2, 6, 4);
  }
  if (attacking) g.lineStyle(4, primary, 0.35).lineBetween(4, -spread, 4 + len + 6, 0).lineBetween(4, spread, 4 + len + 6, 0);
}

function drawBeacon(g: G, primary: number, secondary: number, attacking: boolean, bob: number, t: number): void {
  const robe = hexInt('#3a2a12');
  const trim = secondary;
  // halo behind the head
  g.lineStyle(2, primary, 0.55).strokeCircle(-4, 0, 15 + Math.sin(t * 3) * 0.8);
  // robe: round body with trim rings
  g.fillStyle(robe, 1).fillCircle(-1, bob * 0.3, 11);
  g.lineStyle(1.5, trim, 0.9).strokeCircle(-1, bob * 0.3, 11);
  g.lineStyle(1, primary, 0.7).strokeCircle(-1, bob * 0.3, 7);
  g.fillStyle(mix('#3a2a12', '#ffcf8a', 0.35), 1).fillTriangle(-12, -6, -1, 0, -12, 6);
  // hood + visor
  g.fillStyle(darken('#3a2a12', 0.2), 1).fillCircle(3, bob * 0.3, 6);
  g.fillStyle(primary, 1).fillRect(4, -2 + bob * 0.3, 5, 4);
  // lantern staff forward (+x): shaft, hex lantern head, glow, three orbiting motes
  const headX = attacking ? 34 : 28;
  g.lineStyle(3, hexInt('#6b4a1e'), 1).lineBetween(2, 6, headX - 6, 6);
  g.lineStyle(1, trim, 0.9).lineBetween(2, 5, headX - 6, 5);
  g.fillStyle(primary, 0.18 + (attacking ? 0.2 : 0) + 0.06 * Math.sin(t * 7)).fillCircle(headX, 6, attacking ? 20 : 14);
  g.fillStyle(darken('#3a2a12', 0.3), 1).fillPoints(hexagon(headX, 6, 6.5), true);
  g.fillStyle(primary, 1).fillPoints(hexagon(headX, 6, 4), true);
  g.fillStyle(WHITE, 0.95).fillCircle(headX, 6, 1.8);
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i * Math.PI * 2) / 3;
    g.fillStyle(i === 0 ? WHITE : trim, 0.9).fillCircle(headX + Math.cos(a) * 10, 6 + Math.sin(a) * 6, 1.6);
  }
}

function drawWeaver(g: G, primary: number, secondary: number, attacking: boolean, bob: number, t: number): void {
  const shell = hexInt('#0f2a2a');
  const shellLight = lighten('#0f2a2a', 0.25);
  // loom ring with three orbiting plasma orbs + threads to the core
  g.lineStyle(1, primary, 0.45).strokeCircle(-1, 0, 21);
  for (let i = 0; i < 3; i++) {
    const a = t * (attacking ? 9 : 2.6) + (i * Math.PI * 2) / 3;
    const ox = -1 + Math.cos(a) * 21;
    const oy = Math.sin(a) * 21;
    g.lineStyle(1, i === 0 ? secondary : primary, 0.6).lineBetween(-1, 0, ox, oy);
    g.fillStyle(primary, 0.25).fillCircle(ox, oy, 6);
    g.fillStyle(i === 0 ? secondary : primary, 1).fillCircle(ox, oy, 3.2);
    g.fillStyle(WHITE, 0.9).fillCircle(ox, oy, 1.2);
  }
  // angular hexagon body
  g.fillStyle(shell, 1).fillPoints(hexagon(-1, bob * 0.3, 11), true);
  g.lineStyle(1.5, shellLight, 1).strokePoints(hexagon(-1, bob * 0.3, 11), true);
  g.lineStyle(1, primary, 0.8).strokePoints(hexagon(-1, bob * 0.3, 6), true);
  // visor
  g.fillStyle(primary, 1).fillRect(3, -2 + bob * 0.3, 6, 4);
  g.fillStyle(WHITE, 0.9).fillRect(6, -1 + bob * 0.3, 2, 2);
  // spindle pointing forward with an orb at the tip
  const tip = attacking ? 30 : 22;
  g.lineStyle(2, shellLight, 1).lineBetween(6, 0, tip, 0);
  g.fillStyle(secondary, 0.3 + (attacking ? 0.3 : 0)).fillCircle(tip + 2, 0, attacking ? 9 : 6);
  g.fillStyle(secondary, 1).fillCircle(tip + 2, 0, 3);
  g.fillStyle(WHITE, 1).fillCircle(tip + 2, 0, 1.2);
}

// ---------------------------------------------------------------------------

type HostileView = Pick<EnemyState, 'enemyId' | 'state'> & Partial<Pick<EnemyState, 'stunMs' | 'markMs' | 'hp' | 'maxHp'>>;

export function drawHostile(g: G, enemy: HostileView, timeMs = 0): void {
  const r = ENEMY_INFO[enemy.enemyId].radius;
  const t = timeMs / 1000;
  const attacking = enemy.state === 'attacking';
  const hit = enemy.state === 'hit';
  const dead = enemy.state === 'dead';
  g.clear();
  if (dead) {
    g.fillStyle(hexInt('#1a0e14'), 0.6).fillEllipse(0, 4, r * 2.2, r * 1.1);
    g.lineStyle(1, 0xff5c7a, 0.35).strokeEllipse(0, 4, r * 2.2, r * 1.1);
    return;
  }
  switch (enemy.enemyId) {
    case 'husk':
      drawHusk(g, r, attacking, t);
      break;
    case 'sentinel':
      drawSentinel(g, r, attacking, t);
      break;
    case 'lurker':
      drawLurker(g, r, attacking, enemy.state === 'chasing', t);
      break;
    case 'guardian':
      drawGuardian(g, r, attacking, t);
      break;
  }
  if ((enemy.markMs ?? 0) > 0) {
    g.lineStyle(2, 0xffcf8a, 0.9).strokeCircle(0, 0, r + 8);
    g.fillStyle(0xffcf8a, 1).fillTriangle(0, -r - 16, -4, -r - 10, 4, -r - 10);
  }
  if ((enemy.stunMs ?? 0) > 0) {
    for (let i = 0; i < 3; i++) {
      const a = t * 6 + (i * Math.PI * 2) / 3;
      g.fillStyle(0xffcf8a, 0.9).fillCircle(Math.cos(a) * (r * 0.7), -r - 6 + Math.sin(a) * 3, 2);
    }
  }
  if (hit) g.fillStyle(WHITE, 0.6).fillCircle(0, 0, r);
}

function drawHusk(g: G, r: number, attacking: boolean, t: number): void {
  const flesh = hexInt('#3a1420');
  const edge = 0xff5c7a;
  const twitch = Math.sin(t * 11) * 1.5;
  // hunched spiky mass: overlapping jagged triangles
  g.fillStyle(darken('#3a1420', 0.3), 1).fillTriangle(-r - 6, -r * 0.5, -r + 2, -r - 4 + twitch, -r + 4, 0);
  g.fillStyle(darken('#3a1420', 0.3), 1).fillTriangle(-r - 6, r * 0.5, -r + 2, r + 4 - twitch, -r + 4, 0);
  g.fillStyle(flesh, 1).fillTriangle(-r, -r * 0.9, r + (attacking ? 6 : 0), 0, -r, r * 0.9);
  g.lineStyle(2, edge, 0.9).strokeTriangle(-r, -r * 0.9, r + (attacking ? 6 : 0), 0, -r, r * 0.9);
  g.fillStyle(lighten('#3a1420', 0.15), 1).fillTriangle(-r * 0.6, -r * 0.4, r * 0.3, 0, -r * 0.6, r * 0.4);
  // spikes along the back
  for (let i = 0; i < 4; i++) {
    const x = -r + i * (r * 0.45);
    const h = 5 + (i % 2) * 3 + twitch * 0.5;
    g.fillStyle(edge, 0.85).fillTriangle(x - 3, -r * 0.9 + i * 2, x, -r * 0.9 - h + i * 2, x + 3, -r * 0.9 + i * 2);
    g.fillStyle(edge, 0.85).fillTriangle(x - 3, r * 0.9 - i * 2, x, r * 0.9 + h - i * 2, x + 3, r * 0.9 - i * 2);
  }
  // single glowing eye + drips
  g.fillStyle(edge, 0.35).fillCircle(r * 0.35, 0, 6);
  g.fillStyle(edge, 1).fillCircle(r * 0.35, 0, 3.2);
  g.fillStyle(WHITE, 0.95).fillCircle(r * 0.35 + 1, -0.5, 1.2);
  g.lineStyle(1.5, edge, 0.6).lineBetween(-r * 0.2, r * 0.6, -r * 0.2 - 3, r * 0.6 + 8 + Math.sin(t * 5) * 2);
  // claws forward
  g.lineStyle(2, 0xdbe4f7, 0.9).lineBetween(r * 0.6, -r * 0.5, r + 8, -r * 0.7).lineBetween(r * 0.6, r * 0.5, r + 8, r * 0.7);
}

function drawSentinel(g: G, r: number, attacking: boolean, t: number): void {
  const hull = hexInt('#2a2f4a');
  const lens = 0xff8f3f;
  // rotating bracket segments around the hull
  for (let i = 0; i < 4; i++) {
    const a = t * 1.4 + (i * Math.PI) / 2;
    g.lineStyle(3, lighten('#2a2f4a', 0.4), 0.9);
    g.beginPath();
    g.arc(0, 0, r + 6, a, a + 0.7, false);
    g.strokePath();
  }
  // hex hull with plating
  g.fillStyle(hull, 1).fillPoints(hexagon(0, 0, r), true);
  g.lineStyle(2, lighten('#2a2f4a', 0.55), 1).strokePoints(hexagon(0, 0, r), true);
  g.lineStyle(1, lens, 0.5).strokePoints(hexagon(0, 0, r * 0.62), true);
  g.fillStyle(lighten('#2a2f4a', 0.2), 1).fillRect(-r * 0.6, -r * 0.15, r * 0.5, r * 0.3);
  // antenna
  g.lineStyle(1.5, lighten('#2a2f4a', 0.5), 1).lineBetween(-r * 0.4, -r * 0.8, -r * 0.9, -r - 8);
  g.fillStyle(lens, 1).fillCircle(-r * 0.9, -r - 8, 2);
  // central lens: charges bright when attacking
  const charge = attacking ? 0.9 + 0.1 * Math.sin(t * 40) : 0.6;
  g.fillStyle(lens, charge * 0.35).fillCircle(r * 0.3, 0, 10);
  g.fillStyle(hexInt('#120b08'), 1).fillCircle(r * 0.3, 0, 6);
  g.fillStyle(lens, charge).fillCircle(r * 0.3, 0, 4.2);
  g.fillStyle(WHITE, 0.9).fillCircle(r * 0.3 + 1.2, -1.2, 1.3);
  if (attacking) g.lineStyle(2, lens, 0.6).lineBetween(r * 0.3, 0, r + 14, 0);
}

function drawLurker(g: G, r: number, attacking: boolean, chasing: boolean, t: number): void {
  const chitin = hexInt('#1c1230');
  const glow = 0xc43cff;
  const scuttle = chasing ? t * 22 : t * 4;
  // six spindly legs with joints
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1] as const) {
      const phase = scuttle + i * 1.1 + (side > 0 ? Math.PI : 0);
      const baseX = -r * 0.6 + i * (r * 0.6);
      const kneeX = baseX + Math.cos(phase) * 4;
      const kneeY = side * (r + 6 + Math.sin(phase) * 2);
      const footX = kneeX + 4 + Math.cos(phase + 1) * 5;
      const footY = side * (r + 15);
      g.lineStyle(2, glow, 0.8).lineBetween(baseX, side * r * 0.5, kneeX, kneeY);
      g.lineStyle(1.5, lighten('#1c1230', 0.5), 1).lineBetween(kneeX, kneeY, footX, footY);
    }
  }
  // elongated body, coiled (shorter) while winding up a charge
  const len = attacking ? r * 2.2 : r * 2.9;
  g.fillStyle(chitin, 1).fillEllipse(-r * 0.3, 0, len, r * 1.4);
  g.lineStyle(1.5, glow, 0.9).strokeEllipse(-r * 0.3, 0, len, r * 1.4);
  for (let i = 0; i < 3; i++) g.lineStyle(1, glow, 0.4).lineBetween(-r + i * 8, -r * 0.55, -r + i * 8, r * 0.55);
  // head with two eye slits + mandibles
  g.fillStyle(darken('#1c1230', 0.2), 1).fillCircle(r * 0.9, 0, r * 0.55);
  g.fillStyle(glow, 1).fillRect(r * 0.9, -5, 5, 2.5).fillRect(r * 0.9, 2.5, 5, 2.5);
  g.lineStyle(1.5, 0xdbe4f7, 0.9).lineBetween(r * 1.2, -4, r * 1.2 + 8, -7).lineBetween(r * 1.2, 4, r * 1.2 + 8, 7);
  if (attacking) g.fillStyle(glow, 0.3).fillEllipse(-r * 0.3, 0, len + 14, r * 1.9);
}

function drawGuardian(g: G, r: number, attacking: boolean, t: number): void {
  const stone = hexInt('#2a1f3a');
  const core = 0xff5c7a;
  // outer ring + orbiting plates
  g.lineStyle(3, lighten('#2a1f3a', 0.35), 0.9).strokeCircle(0, 0, r + 10);
  for (let i = 0; i < 6; i++) {
    const a = t * (attacking ? 2.4 : 0.9) + (i * Math.PI) / 3;
    const x = Math.cos(a) * (r + 10);
    const y = Math.sin(a) * (r + 10);
    g.fillStyle(stone, 1).fillPoints(rotatedRect(x, y, 14, 8, a), true);
    g.lineStyle(1.5, core, 0.9).strokePoints(rotatedRect(x, y, 14, 8, a), true);
  }
  // body rings
  g.fillStyle(stone, 1).fillCircle(0, 0, r);
  g.lineStyle(2, lighten('#2a1f3a', 0.5), 1).strokeCircle(0, 0, r);
  g.lineStyle(4, core, 0.35).strokeCircle(0, 0, r - 9);
  g.lineStyle(1, core, 0.6).strokeCircle(0, 0, r - 16);
  // cracks radiating from the core
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    g.lineStyle(1.5, core, 0.5).lineBetween(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a + 0.2) * (r - 4), Math.sin(a + 0.2) * (r - 4));
  }
  // core
  const pulse = attacking ? 0.85 + 0.15 * Math.sin(t * 30) : 0.6 + 0.15 * Math.sin(t * 3);
  g.fillStyle(core, pulse * 0.4).fillCircle(0, 0, 16);
  g.fillStyle(core, pulse).fillCircle(0, 0, 8);
  g.fillStyle(WHITE, 0.9).fillCircle(0, 0, 3);
  // facing crest
  g.fillStyle(lighten('#2a1f3a', 0.4), 1).fillTriangle(r - 4, -8, r + 12, 0, r - 4, 8);
  g.fillStyle(core, 0.9).fillTriangle(r, -3, r + 8, 0, r, 3);
}

// ---------------------------------------------------------------------------

function octagon(cx: number, cy: number, rx: number, ry: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

function hexagon(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function rotatedRect(cx: number, cy: number, w: number, h: number, angle: number): Array<{ x: number; y: number }> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([x, y]) => ({ x: cx + x! * c - y! * s, y: cy + x! * s + y! * c }));
}
