/**
 * Floors UI (agent F3): minimap model (visited / seen / fog), biome header, the choice
 * screen (solo picks, guests cannot) and the session -> UiModel bridge.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { connectFloorsUi, createUiStore } from '../../src/client/game/uiStore';
import { BiomeChoice, choiceKeyAction, pickBiome } from '../../src/client/ui/BiomeChoice';
import { FullMap } from '../../src/client/ui/FullMap';
import { Minimap } from '../../src/client/ui/Minimap';
import { buildMinimap, describeLayout, floorUiFrom, minimapPitch } from '../../src/client/ui/floorsModel';
import { RunStatus } from '../../src/client/ui/Hud';
import { IDLE_GENERATION_STATUS, type GameSnapshot } from '../../src/shared/contracts';
import { ROOM_BUDGETS } from '../../src/shared/floors';
import { lintProse } from '../../src/shared/prose';
import { samplePlayers, sampleSnapshot } from '../../src/shared/samples';
import type { GameSession } from '../../src/shared/session';
import type { UiActions, UiModel } from '../../src/shared/ui';
import { floorsFixture } from './floorsFixture';

const { world, runtime, biomeId, runState } = floorsFixture('ui');
const plan = runtime.plan(biomeId);
const local = { playerId: samplePlayers[0]!.id, solo: true, isHost: true };
const players = sampleSnapshot.players;
const nextOptions = runtime.nextBiomeChoices(biomeId);
const choiceState = (votes: Record<string, string> = {}, hostPlayerId: string | null = null) =>
  runState([plan.entranceId], { biomeChoice: { fromBiomeId: biomeId, options: nextOptions, votes, hostPlayerId, chosenBiomeId: null } });

describe('minimap model', () => {
  it('shows the current room, its seen neighbours, and nothing else (fog)', () => {
    const floor = runState([plan.entranceId]);
    const map = buildMinimap(floor);
    const entrance = plan.rooms.find((room) => room.id === plan.entranceId)!;
    const neighbourIds = Object.values(entrance.doors);
    expect(map.cells.find((cell) => cell.roomId === plan.entranceId)!.state).toBe('current');
    expect(map.cells.filter((cell) => cell.state === 'seen').map((cell) => cell.roomId).sort()).toEqual([...neighbourIds].sort());
    expect(map.cells).toHaveLength(1 + neighbourIds.length);
    expect(map.cells.length).toBeLessThan(plan.rooms.length);
    // one connector per door of the visited room, none leaving a room that was only seen
    expect(map.links).toHaveLength(neighbourIds.length);
  });

  it('marks earlier rooms visited, draws each visited-visited link once, and normalises to the revealed box', () => {
    const next = Object.values(plan.rooms.find((room) => room.id === plan.entranceId)!.doors)[0]!;
    const floor = runState([plan.entranceId, next]);
    const map = buildMinimap(floor);
    expect(map.cells.find((cell) => cell.roomId === plan.entranceId)!.state).toBe('visited');
    expect(map.cells.find((cell) => cell.roomId === next)!.state).toBe('current');
    expect(Math.min(...map.cells.map((cell) => cell.col))).toBe(0);
    expect(Math.min(...map.cells.map((cell) => cell.row))).toBe(0);
    const between = map.links.filter((link) => {
      const ends = [`${link.from.col},${link.from.row}`, `${link.to.col},${link.to.row}`];
      const cellOf = (id: string) => { const cell = map.cells.find((c) => c.roomId === id)!; return `${cell.col},${cell.row}`; };
      return ends.includes(cellOf(plan.entranceId)) && ends.includes(cellOf(next));
    });
    expect(between).toHaveLength(1);
  });

  it('hides the kind of a seen room until the sim reveals it, and gives revealed kinds an icon', () => {
    const floor = runState([plan.entranceId]);
    floor.map = floor.map.map((room, index) => (room.state === 'seen' ? { ...room, kind: index % 2 === 0 ? null : 'treasure' } : room));
    for (const cell of buildMinimap(floor).cells.filter((c) => c.state === 'seen')) {
      expect(cell.icon).toBe(cell.kind === null ? null : 'treasure');
    }
  });

  it('fits 10 to 30 room floors (up to 15 x 13 cells) inside ~200px with legible cells', () => {
    for (const size of [{ cols: 3, rows: 2 }, { cols: 9, rows: 7 }, { cols: 15, rows: 13 }]) {
      const pitch = minimapPitch(size, 140, 24);
      expect(pitch).toBeGreaterThanOrEqual(8);
      expect((Math.max(size.cols, size.rows) + 1) * pitch).toBeLessThanOrEqual(Math.max(140, 16 * 8));
    }
    expect(ROOM_BUDGETS[4]).toBe(30);
  });

  it('renders biome name, depth pips and room count; the full map adds the route and a legend', () => {
    const floor = floorUiFrom({ floor: runState([plan.entranceId]), players }, world, local)!;
    const mini = renderToStaticMarkup(createElement(Minimap, { floor }));
    expect(mini).toContain(runtime.brief(biomeId).name);
    expect(mini).toContain('Biome 1/5');
    expect(mini).toContain(`1/${ROOM_BUDGETS[0]} rooms`);
    expect(mini).toContain('data-state="current"');
    expect(mini).toContain('data-state="seen"');
    const full = renderToStaticMarkup(createElement(FullMap, { floor, onClose: () => {} }));
    expect(full).toContain('You are here');
    expect(full).toContain(`1 of ${ROOM_BUDGETS[0]} rooms visited`);
  });
});

describe('biome choice', () => {
  it('describes layouts in plain words', () => {
    const specials = { treasure: 0, lore: 0, rest: 0, elite: 0 };
    expect(describeLayout({ linearity: 0.9, branchiness: 0.1, specials })).toBe('Long and direct. Few side rooms.');
    expect(describeLayout({ linearity: 0.5, branchiness: 0.9, specials })).toBe('Winding. Many dead ends.');
    expect(describeLayout({ linearity: 0.1, branchiness: 0.5, specials })).toBe('Wide and sprawling. Some side rooms.');
  });

  it('builds one card per option with name, tier, room count, enemies and hazards from the brief', () => {
    const ui = floorUiFrom({ floor: choiceState(), players }, world, local)!;
    expect(ui.choice!.options.map((option) => option.biomeId)).toEqual(nextOptions);
    for (const option of ui.choice!.options) {
      const brief = runtime.brief(option.biomeId);
      expect(option).toMatchObject({ name: brief.name, tagline: brief.tagline, depth: 2, roomCount: ROOM_BUDGETS[1], hazards: brief.hazards });
      expect(option.enemies.length).toBeGreaterThan(0);
      expect(option.enemies).not.toContain('Guardian');
    }
    const html = renderToStaticMarkup(createElement(BiomeChoice, { choice: ui.choice!, fromBiomeName: ui.biomeName, localPlayerId: local.playerId, onChoose: () => {} }));
    for (const option of ui.choice!.options) expect(html).toContain(option.name);
    expect(html).toContain('Pick one');
    expect(html).not.toMatch(/whisper|ancient|mysterious|echo/i);
  });

  it('solo: 1 / 2 / Enter / click pick a biome through chooseBiome', () => {
    const ui = floorUiFrom({ floor: choiceState(), players }, world, local)!;
    const choice = ui.choice!;
    expect(choice.canPick).toBe(true);
    expect(choiceKeyAction(choice, 'Digit1', 0)).toEqual({ choose: nextOptions[0] });
    expect(choiceKeyAction(choice, 'Digit2', 0)).toEqual({ choose: nextOptions[1] });
    expect(choiceKeyAction(choice, 'ArrowRight', 0)).toEqual({ highlight: 1 });
    expect(choiceKeyAction(choice, 'Enter', 1)).toEqual({ choose: nextOptions[1] });
    expect(choiceKeyAction(choice, 'KeyW', 0)).toBeNull();
    const chooseBiome = vi.fn();
    expect(pickBiome(choice, nextOptions[1]!, chooseBiome)).toBe(true);
    expect(chooseBiome).toHaveBeenCalledWith(nextOptions[1]);
    expect(pickBiome(choice, 'not-on-offer', chooseBiome)).toBe(false);
    expect(chooseBiome).toHaveBeenCalledTimes(1);
  });

  it('co-op guest: sees the doors and the host pick, is told to wait, and cannot pick', () => {
    const [host, guest] = players;
    const floor = choiceState({ [host!.id]: nextOptions[1]! }, host!.id);
    const ui = floorUiFrom({ floor, players }, world, { playerId: guest!.id, solo: false, isHost: false })!;
    const choice = ui.choice!;
    expect(choice.canPick).toBe(false);
    const chooseBiome = vi.fn();
    expect(choiceKeyAction(choice, 'Digit1', 0)).toBeNull();
    expect(choiceKeyAction(choice, 'Enter', 0)).toBeNull();
    expect(pickBiome(choice, nextOptions[0]!, chooseBiome)).toBe(false);
    expect(chooseBiome).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(BiomeChoice, { choice, fromBiomeName: ui.biomeName, localPlayerId: guest!.id, onChoose: chooseBiome }));
    expect(html).toContain(`Waiting for ${host!.displayName} to choose`);
    expect(html).toContain('is-host-pick');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    // the host of the same session can pick
    expect(floorUiFrom({ floor, players }, world, { playerId: host!.id, solo: false, isHost: true })!.choice!.canPick).toBe(true);
  });

  it('a single option (before the finale) is a confirm, and a resolved choice closes the screen', () => {
    const floor = choiceState();
    floor.biomeChoice!.options = [nextOptions[0]!];
    expect(floorUiFrom({ floor, players }, world, local)!.choice).toMatchObject({ confirmOnly: true });
    floor.biomeChoice!.chosenBiomeId = nextOptions[0]!;
    expect(floorUiFrom({ floor, players }, world, local)!.choice).toBeNull();
  });
});

describe('run rail in floors mode', () => {
  /** A floors UiModel: `plannedRoomCount` is 1 in a floors world, which is what used to leak out. */
  const railModel = (visited: string[]): UiModel => ({
    phase: 'expedition',
    connection: { mode: 'local', status: 'connected' },
    localPlayer: { ...samplePlayers[0]!, isLocal: true },
    players: [{ ...samplePlayers[0]!, isLocal: true }],
    contributions: [], generation: IDLE_GENERATION_STATUS, liveGenerationAvailable: false,
    world: {
      worldId: world.worldId, title: world.recipe.title, tagline: world.recipe.tagline, themeSummary: world.recipe.themeSummary,
      provenance: world.provenance, receipt: world.receipt,
      committedRoomCount: 1, plannedRoomCount: 1, lore: [], attunements: [],
    },
    room: { index: 0, name: 'Entrance hall', description: 'A room', isFinal: false },
    hud: { hp: 100, maxHp: 100, state: 'idle', dashReady: true, dashCooldownMs: 0, attackReady: true, enemiesRemaining: 0 },
    discoveredLore: [], memories: [],
    classStatus: { bastion: 'partial', shade: 'planned', beacon: 'planned', weaver: 'planned' },
    preview: { fixtureWorld: true, startRoom: null }, notice: null,
    floor: floorUiFrom({ floor: runState(visited), players }, world, local),
  });

  it('counts rooms of the biome and names the biome depth instead of the legacy "1/1"', () => {
    const next = Object.values(plan.rooms.find((room) => room.id === plan.entranceId)!.doors)[0]!;
    const ui = railModel([plan.entranceId, next]);
    expect(ui.floor).toMatchObject({ roomsVisited: 2, roomCount: ROOM_BUDGETS[0], depth: 1, depthCount: 5 });
    const html = renderToStaticMarkup(createElement(RunStatus, { model: ui }));
    expect(html).toContain('<dt>Rooms</dt>');
    expect(html).toContain(`<dd>2<small>/${ROOM_BUDGETS[0]}</small></dd>`);
    expect(html).toContain('<dt>Biome</dt>');
    expect(html).toContain('<dd>1<small>/5</small></dd>');
    expect(html).toContain(runtime.brief(biomeId).name);
    expect(html).toContain('aria-label="Biome 1 of 5"');
    // the legacy world-room tile and its 1/1 reading are gone
    expect(html).not.toContain('<dt>Room</dt>');
    expect(html).not.toContain('1<small>/1</small>');
  });

  it('leaves the legacy room tile alone when there is no floors run', () => {
    const ui = { ...railModel([plan.entranceId]), floor: null };
    ui.world = { ...ui.world!, committedRoomCount: 3, plannedRoomCount: 3 };
    const html = renderToStaticMarkup(createElement(RunStatus, { model: ui }));
    expect(html).toContain('<dt>Room</dt>');
    expect(html).toContain('<dd>1<small>/3</small></dd>');
    expect(html).not.toContain('<dt>Biome</dt>');
  });
});

describe('the full map legend', () => {
  it('says a rest site works once, so nobody walks back for a second one (A4)', () => {
    const floor = floorUiFrom({ floor: runState([plan.entranceId]), players }, world, local)!;
    const html = renderToStaticMarkup(createElement(FullMap, { floor, onClose: () => {} }));
    expect(html).toContain('Rest site · mends the crew once');
    const lint = lintProse('Rest site · mends the crew once', { kind: 'uiLabel' });
    expect(lint.hardFail, JSON.stringify(lint.issues)).toBe(false);
  });
});

describe('connectFloorsUi', () => {
  it('publishes UiModel.floor from snapshots, clears it outside a run and wires chooseBiome', () => {
    let listener: (snapshot: GameSnapshot) => void = () => {};
    const chooseBiome = vi.fn();
    const session = {
      mode: 'local', localPlayerId: local.playerId, getWorld: () => world, getIsHost: () => true, chooseBiome,
      onSnapshot: (l: (snapshot: GameSnapshot) => void) => { listener = l; return () => {}; },
    } as unknown as GameSession;
    const store = createUiStore({ floor: null } as unknown as UiModel);
    const actions = {} as UiActions;
    connectFloorsUi(session, store, actions);
    listener({ ...sampleSnapshot, phase: 'expedition', floor: runState([plan.entranceId]) });
    expect(store.get().floor).toMatchObject({ depth: 1, depthCount: 5, biomeName: runtime.brief(biomeId).name });
    const published = store.get().floor;
    listener({ ...sampleSnapshot, phase: 'expedition', floor: runState([plan.entranceId]) });
    expect(store.get().floor).toBe(published); // unchanged state is not re-published
    listener({ ...sampleSnapshot, phase: 'expedition', floor: runState([plan.entranceId], { doorsLocked: true }) });
    expect(store.get().floor!.run.doorsLocked).toBe(true);
    listener({ ...sampleSnapshot, phase: 'headquarters' });
    expect(store.get().floor).toBeNull();
    actions.chooseBiome!('biome-2');
    expect(chooseBiome).toHaveBeenCalledWith('biome-2');
  });

  it('stays silent for legacy worlds', () => {
    expect(floorUiFrom({ floor: undefined, players }, world, local)).toBeNull();
    expect(floorUiFrom({ floor: runState([plan.entranceId]), players }, { ...world, floors: undefined }, local)).toBeNull();
  });
});
