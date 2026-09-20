import type Phaser from 'phaser';
import type { GameSnapshot, RoomSpec } from '../../shared/contracts';
import { DEPTH, tileToWorld } from '../../shared/conventions';
import {
  HEADQUARTERS_ID, HEADQUARTERS_INTERACT_RANGE, HEADQUARTERS_RECORD_PLINTHS, HEADQUARTERS_RELIC_BRACKETS, HEADQUARTERS_STATIONS,
  nearbyHeadquartersStation, type HeadquartersStation,
} from '../../shared/headquarters';
import { CLASS_THEME, type ClassId } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import { createCueSuppressor, renderCue, type RenderedCue } from '../chronicle/hubCues';
import { hubStateBus, shelfRelics, type HubState, type HubStateBus } from '../chronicle/hubState';

export interface HeadquartersStationView {
  update(snapshot: GameSnapshot, localPlayerId: string): void;
}

export interface HeadquartersRenderOptions {
  textResolution?: number;
  /** Device-local hub state source (relay.hub.v1). Defaults to the page bus. */
  hub?: HubStateBus;
  /** Wall clock for the speech-box timeout; injected for tests. */
  now?: () => number;
}

/** How long the quartermaster's speech box stays up once you are in range. */
export const QUARTERMASTER_SPEECH_MS = 8000;
const QUARTERMASTER_TILE = { x: 15, y: 6 };
const WARM_LAMP = 0xffcf8a;

/** All objects belong to `layer`; discard this view when the room layer is destroyed. */
export function drawHeadquartersStations(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Layer,
  room: RoomSpec,
  options: number | HeadquartersRenderOptions = 1,
): HeadquartersStationView {
  if (room.id !== HEADQUARTERS_ID) return { update: () => {} };
  const opts: HeadquartersRenderOptions = typeof options === 'number' ? { textResolution: options } : options;
  const textResolution = opts.textResolution ?? 1;
  const hub = opts.hub ?? hubStateBus;
  const now = opts.now ?? Date.now;

  const floor = scene.add.graphics().setDepth(DEPTH.floorDecal + 2);
  const fixtures = scene.add.graphics().setDepth(DEPTH.propsBehind + 2);
  const highlights = scene.add.graphics().setDepth(DEPTH.floorDecal + 5);
  /** Redrawn on state change: weapon stands, record plinths, relic shelf. */
  const dynamic = scene.add.graphics().setDepth(DEPTH.propsBehind + 3);
  layer.add([floor, fixtures, highlights, dynamic]);
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
    const color = stationColor(station);
    const tint = hexToInt(color);
    if (station.classId) {
      // Weapon rack: the stand itself is static, the silhouette is redrawn when the class changes.
      floor.fillStyle(tint, 0.05).fillCircle(x, y, 39);
      floor.lineStyle(1, tint, 0.22).strokeEllipse(x, y + 7, 72, 35);
      fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 12, 38, 17);
      fixtures.fillStyle(0x253346, 1).fillRoundedRect(x - 15, y - 4, 30, 20, 4);
      fixtures.lineStyle(1, tint, 0.65).strokeRoundedRect(x - 15, y - 4, 30, 20, 4);
      fixtures.fillStyle(tint, 0.9).fillRect(x - 8, y + 11, 16, 2);
    } else if (station.id === 'quartermaster') {
      drawQuartermaster(fixtures, x, y);
    } else if (station.id === 'relics') {
      // Reading lectern for the shelf: a slanted top on a post.
      floor.fillStyle(tint, 0.05).fillCircle(x, y + 8, 30);
      fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 14, 26, 10);
      fixtures.fillStyle(0x253346, 1).fillRect(x - 3, y - 2, 6, 14);
      fixtures.fillStyle(0x2f4160, 1).fillRoundedRect(x - 12, y - 10, 24, 10, 2);
      fixtures.lineStyle(1, tint, 0.65).strokeRoundedRect(x - 12, y - 10, 24, 10, 2);
    } else if (station.id !== 'portal') {
      floor.fillStyle(tint, 0.05).fillCircle(x, y, 39);
      floor.lineStyle(1, tint, 0.22).strokeEllipse(x, y + 7, 72, 35);
      fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 12, 38, 17);
      fixtures.fillStyle(0x253346, 1).fillRoundedRect(x - 15, y - 10, 30, 26, 4);
      fixtures.lineStyle(1, tint, 0.65).strokeRoundedRect(x - 15, y - 10, 30, 26, 4);
      fixtures.fillStyle(tint, 0.9).fillRect(x - 8, y + 11, 16, 2);
      drawStationSymbol(fixtures, station, x, y - 13, tint);
    }
    const title = stationTitle(station);
    if (title) label(x, y + stationTitleOffset(station), title, color, 9);
  }

  // Relic shelf: five brackets along the north wall, framed by the existing pillars.
  const shelfLabels = HEADQUARTERS_RELIC_BRACKETS.map((bracket) => {
    const { x, y } = tileToWorld(bracket.x, bracket.y);
    fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 20, 26, 9);
    fixtures.fillStyle(0x1d2a40, 1).fillRoundedRect(x - 12, y - 8, 24, 28, 3);
    fixtures.lineStyle(1, WARM_LAMP, 0.35).strokeRoundedRect(x - 12, y - 8, 24, 28, 3);
    return label(x, y + 34, '', '#a5b2c5', 7).setVisible(false);
  });
  label(tileToWorld(15, 1).x, tileToWorld(15, 1).y - 22, 'RELIC SHELF · ANCHORED RUNS ONLY', '#dfc28b', 8);

  // Record plinths: static base plus class title; lit state is redrawn from hub state.
  for (const plinth of HEADQUARTERS_RECORD_PLINTHS) {
    const { x, y } = tileToWorld(plinth.x, plinth.y);
    fixtures.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 12, 30, 12);
    fixtures.fillStyle(0x1f2c44, 1).fillRoundedRect(x - 11, y - 6, 22, 20, 3);
    fixtures.lineStyle(1, hexToInt(CLASS_THEME[plinth.classId].primary), 0.3).strokeRoundedRect(x - 11, y - 6, 22, 20, 3);
  }

  const currentTag = label(0, 0, 'CURRENT', '#fff0c7', 8).setVisible(false);
  const speech = scene.add.text(0, 0, '', {
    fontFamily: tokens.font.mono, fontSize: '10px', color: '#fff0c7', resolution: textResolution,
    backgroundColor: '#101923', padding: { x: 7, y: 5 }, align: 'left', wordWrap: { width: 250 },
  }).setOrigin(0.5, 1).setDepth(DEPTH.overlay).setVisible(false);
  layer.add(speech);
  const prompt = label(0, 0, '', '#fff0c7', 10).setVisible(false);

  const suppressor = createCueSuppressor();
  let speechShownAt: number | null = null;
  let speechCueId: string | null = null;
  let previous = '';
  let previousHub: HubState | null = null;

  return {
    update(snapshot, localPlayerId) {
      const station = nearbyHeadquartersStation(snapshot, localPlayerId);
      const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
      const inHeadquarters = snapshot.phase === 'headquarters' && snapshot.roomId === room.id;
      const state = hub.get();

      // Quartermaster proximity: within interact range of the NPC, for up to 8 s, one cue per run.
      const qm = tileToWorld(QUARTERMASTER_TILE.x, QUARTERMASTER_TILE.y);
      const nearQuartermaster = Boolean(inHeadquarters && player && player.hp > 0 && Math.hypot(player.x - qm.x, player.y - qm.y) <= HEADQUARTERS_INTERACT_RANGE);
      const t = now();
      let cue: RenderedCue | null = null;
      if (nearQuartermaster) {
        if (speechShownAt === null) speechShownAt = t;
        const expired = t - speechShownAt >= QUARTERMASTER_SPEECH_MS;
        if (!expired) {
          cue = renderCue(cueContext(state, snapshot, player?.classId ?? 'bastion'), suppressor.forRun(state.lastRun));
          speechCueId = cue?.id ?? null;
        } else if (speechCueId) {
          suppressor.shown(speechCueId);
          speechCueId = null;
        }
      } else if (speechShownAt !== null) {
        if (speechCueId) suppressor.shown(speechCueId);
        speechShownAt = null;
        speechCueId = null;
      }

      const key = `${inHeadquarters}:${station?.id ?? ''}:${player?.classId ?? ''}:${cue?.id ?? ''}:${cue?.lines.join('|') ?? ''}`;
      const hubChanged = state !== previousHub;
      if (key === previous && !hubChanged) return;
      previous = key;
      previousHub = state;

      highlights.clear();
      prompt.setVisible(Boolean(station));
      speech.setVisible(Boolean(cue));
      currentTag.setVisible(false);
      if (!inHeadquarters) {
        speech.setVisible(false);
        return;
      }

      dynamic.clear();
      for (const candidate of HEADQUARTERS_STATIONS) {
        if (!candidate.classId) continue;
        const { x, y } = tileToWorld(candidate.x, candidate.y);
        const current = candidate.classId === player?.classId;
        drawWeapon(dynamic, candidate.classId, x, y - 16, hexToInt(CLASS_THEME[candidate.classId].primary), current);
        if (current) {
          highlights.lineStyle(2, hexToInt(CLASS_THEME[candidate.classId].primary), 0.65).strokeCircle(x, y, 28);
          currentTag.setPosition(x, y - 48).setVisible(true);
        }
      }
      drawPlinths(dynamic, state);
      drawShelf(dynamic, state, shelfLabels);

      if (cue) {
        speech.setText(cue.lines.join('\n')).setPosition(qm.x, qm.y - 40);
      }
      if (!station) return;
      const { x, y } = tileToWorld(station.x, station.y);
      highlights.lineStyle(2, 0xffedb9, 0.95).strokeEllipse(x, y + 5, 80, 46);
      const promptY = station.id === 'portal' ? -70 : station.id === 'quartermaster' ? 22 : station.classId ? -30 : -38;
      prompt.setText(`F · ${station.action.toUpperCase()}`).setPosition(x, y + promptY);
    },
  };
}

function cueContext(state: HubState, snapshot: GameSnapshot, classId: ClassId) {
  return {
    lastRun: state.lastRun,
    records: state.records,
    totals: state.totals,
    session: {
      classId,
      classChangedSinceLastRun: state.lastRun !== null && state.lastRun.classId !== classId,
      worldPrepared: snapshot.worldId !== null,
      crewSize: snapshot.players.length,
    },
  };
}

function stationColor(station: HeadquartersStation): string {
  if (station.classId) return CLASS_THEME[station.classId].primary;
  switch (station.id) {
    case 'training': return '#edaa82';
    case 'observatory': return '#7cf5ff';
    case 'quartermaster':
    case 'relics': return '#ffcf8a';
    default: return '#dfc28b';
  }
}

function stationTitle(station: HeadquartersStation): string | null {
  if (station.classId) return CLASS_THEME[station.classId].title.toUpperCase();
  switch (station.id) {
    case 'archive': return 'READ THE ECHOES';
    case 'records': return 'SERVICE RECORD';
    case 'training': return 'PRACTICE / RETURN';
    case 'observatory': return 'WRITE A WORLD';
    case 'quartermaster': return 'QUARTERMASTER';
    case 'relics': return null;
    default: return 'DEPARTURE GATE';
  }
}

function stationTitleOffset(station: HeadquartersStation): number {
  if (station.id === 'portal') return -45;
  if (station.id === 'quartermaster') return 38;
  return 35;
}

/** 28×44 standing figure in warm lamp colour: anything human is warm (ART_DIRECTION). */
function drawQuartermaster(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x050b14, 0.8).fillEllipse(x, y + 16, 30, 11);
  g.fillStyle(0x3a2f24, 1).fillRoundedRect(x - 14, y - 12, 28, 30, 5);
  g.fillStyle(WARM_LAMP, 0.9).fillRoundedRect(x - 10, y - 10, 20, 26, 4);
  g.fillStyle(0xe8b98a, 1).fillCircle(x, y - 20, 8);
  g.fillStyle(0x3a2f24, 1).fillRoundedRect(x - 10, y - 30, 20, 7, 2);
  g.lineStyle(1, 0x101923, 0.8).lineBetween(x - 6, y - 2, x + 6, y - 2).lineBetween(x - 6, y + 4, x + 6, y + 4);
  g.fillStyle(0xfff0c7, 1).fillRect(x - 7, y + 8, 14, 3);
}

function drawPlinths(g: Phaser.GameObjects.Graphics, state: HubState): void {
  for (const plinth of HEADQUARTERS_RECORD_PLINTHS) {
    const { x, y } = tileToWorld(plinth.x, plinth.y);
    const tint = hexToInt(CLASS_THEME[plinth.classId].primary);
    const lit = state.records[plinth.classId].runs > 0;
    if (lit) {
      g.fillStyle(tint, 0.14).fillCircle(x, y, 22);
      g.lineStyle(1, tint, 0.9).strokeRoundedRect(x - 11, y - 6, 22, 20, 3);
      g.fillStyle(tint, 1).fillRoundedRect(x - 7, y - 16, 14, 8, 2);
    } else {
      g.lineStyle(1, tint, 0.25).strokeRoundedRect(x - 7, y - 16, 14, 8, 2);
    }
  }
}

function drawShelf(g: Phaser.GameObjects.Graphics, state: HubState, labels: Phaser.GameObjects.Text[]): void {
  const relics = shelfRelics(state);
  HEADQUARTERS_RELIC_BRACKETS.forEach((bracket, index) => {
    const { x, y } = tileToWorld(bracket.x, bracket.y);
    const relic = relics[index];
    const text = labels[index]!;
    if (relic) {
      g.fillStyle(WARM_LAMP, 0.18).fillCircle(x, y + 6, 16);
      g.fillStyle(WARM_LAMP, 0.95).fillTriangle(x, y - 6, x + 8, y + 6, x, y + 18);
      g.fillStyle(0xfff0c7, 0.95).fillTriangle(x, y - 6, x - 8, y + 6, x, y + 18);
      g.lineStyle(1, WARM_LAMP, 0.9).strokeRoundedRect(x - 12, y - 8, 24, 28, 3);
      text.setText(relic.title.toUpperCase().slice(0, 14)).setVisible(true);
    } else {
      g.lineStyle(1, WARM_LAMP, 0.35).strokeRoundedRect(x - 7, y - 2, 14, 16, 2);
      text.setVisible(false);
    }
  });
}

/** Four distinct weapon silhouettes. The stand you took from shows only the empty bracket. */
function drawWeapon(g: Phaser.GameObjects.Graphics, classId: ClassId, x: number, y: number, color: number, taken: boolean): void {
  if (taken) {
    g.lineStyle(1, color, 0.35).strokeRoundedRect(x - 10, y - 18, 20, 30, 3);
    return;
  }
  g.lineStyle(2, color, 0.9);
  g.fillStyle(color, 0.22);
  switch (classId) {
    case 'bastion':
      // Tower shield with an arc-blade leaning across it.
      g.beginPath().moveTo(x - 12, y - 16).lineTo(x + 12, y - 16).lineTo(x + 10, y + 4).lineTo(x, y + 12).lineTo(x - 10, y + 4).closePath().fillPath().strokePath();
      g.lineStyle(3, color, 1).lineBetween(x - 14, y + 14, x + 12, y - 20);
      g.fillStyle(color, 1).fillRect(x - 17, y + 12, 6, 6);
      break;
    case 'shade':
      // Twin phase blades crossed.
      g.fillTriangle(x - 14, y + 12, x - 4, y - 20, x - 1, y + 2);
      g.strokeTriangle(x - 14, y + 12, x - 4, y - 20, x - 1, y + 2);
      g.fillTriangle(x + 14, y + 12, x + 4, y - 20, x + 1, y + 2);
      g.strokeTriangle(x + 14, y + 12, x + 4, y - 20, x + 1, y + 2);
      break;
    case 'beacon':
      // Lantern staff: a long shaft with a hooded lamp.
      g.lineStyle(3, color, 1).lineBetween(x, y - 22, x, y + 14);
      g.lineStyle(2, color, 0.9).strokeRoundedRect(x - 7, y - 22, 14, 12, 3);
      g.fillStyle(0xfff4cf, 1).fillCircle(x, y - 16, 3);
      break;
    case 'weaver':
      // Plasma loom: a frame with threads.
      g.strokeRoundedRect(x - 14, y - 16, 28, 26, 3);
      g.lineStyle(1, color, 0.9);
      for (let i = -2; i <= 2; i++) g.lineBetween(x + i * 5, y - 16, x + i * 5, y + 10);
      g.fillStyle(color, 1).fillCircle(x, y - 3, 4);
      break;
  }
}

function drawStationSymbol(g: Phaser.GameObjects.Graphics, station: HeadquartersStation, x: number, y: number, color: number): void {
  g.lineStyle(2, color, 0.9);
  g.fillStyle(color, 0.18);
  switch (station.id) {
    case 'archive':
      for (let i = -1; i <= 1; i++) {
        g.fillRoundedRect(x + i * 14 - 5, y - 18 + Math.abs(i) * 5, 10, 26, 2);
        g.strokeRoundedRect(x + i * 14 - 5, y - 18 + Math.abs(i) * 5, 10, 26, 2);
        g.lineBetween(x + i * 14 - 2, y - 7, x + i * 14 + 2, y - 7);
      }
      break;
    case 'records':
      // Four small tablets, one per plinth.
      for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 6], [8, 6]] as const) {
        g.fillRoundedRect(x + dx - 5, y + dy - 6, 10, 12, 2);
        g.strokeRoundedRect(x + dx - 5, y + dy - 6, 10, 12, 2);
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
    default:
      break;
  }
}
