import type Phaser from 'phaser';
import type { GameSnapshot, RoomSpec } from '../../shared/contracts';
import { DEPTH, tileToWorld } from '../../shared/conventions';
import { HEADQUARTERS_ID, HEADQUARTERS_STATIONS, nearbyHeadquartersStation, type HeadquartersStation } from '../../shared/headquarters';
import { CLASS_THEME } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';

export interface HeadquartersStationView {
  update(snapshot: GameSnapshot, localPlayerId: string): void;
}

/** All objects belong to `layer`; discard this view when the room layer is destroyed. */
export function drawHeadquartersStations(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Layer,
  room: RoomSpec,
  textResolution = 1,
): HeadquartersStationView {
  if (room.id !== HEADQUARTERS_ID) return { update: () => {} };
  const floor = scene.add.graphics().setDepth(DEPTH.floorDecal + 2);
  const fixtures = scene.add.graphics().setDepth(DEPTH.propsBehind + 2);
  const highlights = scene.add.graphics().setDepth(DEPTH.floorDecal + 5);
  layer.add([floor, fixtures, highlights]);
  const label = (x: number, y: number, content: string, color = '#dfc28b', size = 10) => {
    const text = scene.add.text(x, y, content, {
      fontFamily: tokens.font.mono, fontSize: `${size}px`, color,
      resolution: textResolution, letterSpacing: 1,
      backgroundColor: '#101923', padding: { x: 5, y: 3 },
    }).setOrigin(0.5).setDepth(DEPTH.overlay);
    layer.add(text);
    return text;
  };
  const wing = (x: number, y: number, w: number, h: number, color: number) => {
    floor.fillStyle(color, 0.045).fillRoundedRect(x, y, w, h, 8);
    floor.lineStyle(1, color, 0.2).strokeRoundedRect(x, y, w, h, 8);
    for (const corner of [x + 9, x + w - 9]) {
      floor.lineStyle(2, color, 0.4).lineBetween(corner, y + 9, corner, y + 22);
    }
  };
  wing(48, 48, 288, 240, 0x829ad2);
  wing(656, 48, 256, 240, 0xdfc28b);
  wing(48, 456, 288, 136, 0xedaa82);
  wing(656, 456, 256, 136, 0x7cf5ff);
  label(192, 55, '01 / ARMORY');
  label(784, 55, '02 / ECHO ARCHIVE');
  label(192, 460, '03 / PROVING CHAMBER');
  label(784, 460, '04 / OBSERVATORY');
  label(496, 94, 'THE STILLPOINT', '#e8d9b9', 12);
  label(496, 118, 'BETWEEN WORLDS', '#98a9bf', 8);
  label(784, 274, 'RECORDS HELD ON THIS DEVICE', '#a5b2c5', 8);
  label(496, 306, 'ARMORY  ←   →  ARCHIVE', '#a8b8cd', 9);
  label(496, 422, 'TRAINING  ↙   ↘  OBSERVATORY', '#a8b8cd', 8);

  floor.lineStyle(1, 0xdfc28b, 0.2);
  for (let y = 434; y < 545; y += 22) {
    floor.lineBetween(491, y, 496, y + 5).lineBetween(496, y + 5, 501, y);
  }

  for (const station of HEADQUARTERS_STATIONS) {
    const { x, y } = tileToWorld(station.x, station.y);
    const color = station.classId ? CLASS_THEME[station.classId].primary : station.id === 'training' ? '#edaa82' : station.id === 'observatory' ? '#7cf5ff' : '#dfc28b';
    const tint = hexToInt(color);
    if (station.id !== 'portal') {
      floor.fillStyle(tint, 0.05).fillCircle(x, y, 39);
      floor.lineStyle(1, tint, 0.22).strokeEllipse(x, y + 7, 72, 35);
      fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 12, 38, 17);
      fixtures.fillStyle(0x253346, 1).fillRoundedRect(x - 15, y - 10, 30, 26, 4);
      fixtures.lineStyle(1, tint, 0.65).strokeRoundedRect(x - 15, y - 10, 30, 26, 4);
      fixtures.fillStyle(tint, 0.9).fillRect(x - 8, y + 11, 16, 2);
      drawStationSymbol(fixtures, station, x, y - 13, tint);
    }
    const title = station.classId ? CLASS_THEME[station.classId].title.toUpperCase() : station.id === 'archive' ? 'READ THE ECHOES' : station.id === 'training' ? 'PRACTICE / RETURN' : station.id === 'observatory' ? 'WRITE A WORLD' : 'DEPARTURE GATE';
    label(x, y + (station.id === 'portal' ? -45 : 35), title, color, 9);
  }

  const prompt = label(0, 0, '', '#fff0c7', 10).setVisible(false);
  let previous = '';
  return {
    update(snapshot, localPlayerId) {
      const station = nearbyHeadquartersStation(snapshot, localPlayerId);
      const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
      const inHeadquarters = snapshot.phase === 'headquarters' && snapshot.roomId === room.id;
      const key = `${inHeadquarters}:${station?.id ?? ''}:${player?.classId ?? ''}`;
      if (key === previous) return;
      previous = key;
      highlights.clear();
      prompt.setVisible(Boolean(station));
      if (!inHeadquarters) return;
      for (const candidate of HEADQUARTERS_STATIONS) {
        const { x, y } = tileToWorld(candidate.x, candidate.y);
        if (candidate.classId && candidate.classId === player?.classId) {
          highlights.lineStyle(2, hexToInt(CLASS_THEME[candidate.classId].primary), 0.65).strokeCircle(x, y, 28);
        }
      }
      if (!station) return;
      const { x, y } = tileToWorld(station.x, station.y);
      highlights.lineStyle(2, 0xffedb9, 0.95).strokeEllipse(x, y + 5, 80, 46);
      prompt.setText(`F · ${station.action.toUpperCase()}`).setPosition(x, y - (station.id === 'portal' ? 70 : 38));
    },
  };
}

function drawStationSymbol(g: Phaser.GameObjects.Graphics, station: HeadquartersStation, x: number, y: number, color: number): void {
  g.lineStyle(2, color, 0.9);
  g.fillStyle(color, 0.18);
  switch (station.id) {
    case 'bastion':
      g.beginPath().moveTo(x - 13, y - 14).lineTo(x + 13, y - 14).lineTo(x + 10, y + 4).lineTo(x, y + 12).lineTo(x - 10, y + 4).closePath().fillPath().strokePath();
      g.lineBetween(x, y - 9, x, y + 5).lineBetween(x - 7, y - 3, x + 7, y - 3);
      break;
    case 'shade':
      g.fillTriangle(x - 15, y + 10, x - 6, y - 18, x - 2, y + 3);
      g.strokeTriangle(x - 15, y + 10, x - 6, y - 18, x - 2, y + 3);
      g.fillTriangle(x + 15, y - 12, x + 6, y + 16, x + 2, y - 5);
      g.strokeTriangle(x + 15, y - 12, x + 6, y + 16, x + 2, y - 5);
      break;
    case 'beacon':
      g.fillCircle(x, y, 10).strokeCircle(x, y, 10);
      g.lineBetween(x - 18, y, x - 13, y).lineBetween(x + 13, y, x + 18, y);
      g.lineBetween(x, y - 18, x, y - 13).lineBetween(x, y + 13, x, y + 18);
      g.fillStyle(0xfff4cf, 1).fillCircle(x, y, 4);
      break;
    case 'weaver':
      g.strokeEllipse(x, y, 36, 17).strokeEllipse(x, y, 17, 36);
      g.lineBetween(x - 12, y - 12, x + 12, y + 12).lineBetween(x + 12, y - 12, x - 12, y + 12);
      g.fillStyle(color, 1).fillCircle(x, y, 4);
      break;
    case 'archive':
      for (let i = -1; i <= 1; i++) {
        g.fillRoundedRect(x + i * 14 - 5, y - 18 + Math.abs(i) * 5, 10, 26, 2);
        g.strokeRoundedRect(x + i * 14 - 5, y - 18 + Math.abs(i) * 5, 10, 26, 2);
        g.lineBetween(x + i * 14 - 2, y - 7, x + i * 14 + 2, y - 7);
      }
      break;
    case 'observatory':
      g.strokeCircle(x, y - 4, 18).strokeEllipse(x, y - 4, 42, 15);
      g.lineBetween(x, y - 24, x, y + 16).lineBetween(x - 16, y + 14, x + 16, y - 20);
      g.fillStyle(color, 1).fillCircle(x, y - 4, 4).fillCircle(x + 17, y - 12, 3);
      break;
    case 'training':
      g.strokeCircle(x, y - 3, 17).strokeCircle(x, y - 3, 8);
      g.lineBetween(x - 22, y - 3, x - 11, y - 3).lineBetween(x + 11, y - 3, x + 22, y - 3);
      g.lineBetween(x, y - 25, x, y - 14).lineBetween(x, y + 8, x, y + 19);
      break;
    case 'portal':
      break;
  }
}
