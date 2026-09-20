/**
 * GameController — Agent A's application controller. The only place where the
 * session, renderer, input, UI store, audio and Chronicle meet.
 *
 *   session.onSnapshot -> renderer.renderSnapshot + HUD
 *   session.onEvents   -> renderer.playEvents + audio + chronicle.ingest -> memory wall
 *   session.onWorld    -> UI world summary / receipt
 *   input (per frame)  -> session.setIntent
 *   UiActions          -> session methods (UI never touches the session directly)
 */
import type { GameEvent, GameSnapshot, PlayerState, PreparedWorld, RoomSpec } from '../../shared/contracts';
import { CLASS_INFO, CLASS_IDS, type ClassId } from '../../shared/registry';
import type { WorldRenderer } from '../../shared/render';
import type { GameSession } from '../../shared/session';
import type { UiActions, UiModel } from '../../shared/ui';
import { nearbyHeadquartersStation } from '../../shared/headquarters';
import { createRoomProvider, headquartersArt, headquartersRoom, trainingArt, trainingRoom, type RoomProvider } from '../../sim';
import type { AudioPort } from '../audio';
import { cueForEvent } from '../audio';
import type { BrowserChronicle } from '../chronicle';
import type { LocalSession } from '../transport/LocalSession';
import { createKeyboardMouseInput, type InputSampler } from './input';
import type { UiStore } from './uiStore';

export interface PreviewFlags {
  fixtureWorld: boolean;
  startRoom: number | null;
  autoEnter: boolean;
}

export function parsePreviewFlags(search: string): PreviewFlags {
  const params = new URLSearchParams(search);
  const room = params.get('room');
  const startRoom = room !== null && /^\d$/.test(room) ? Number(room) : null;
  return {
    fixtureWorld: params.get('world') === 'fixture',
    startRoom,
    autoEnter: params.get('autoenter') === '1' || startRoom !== null,
  };
}

export interface GameControllerDeps {
  session: GameSession;
  renderer: WorldRenderer;
  chronicle: BrowserChronicle;
  audio: AudioPort;
  store: UiStore;
  flags: PreviewFlags;
  liveGenerationAvailable: boolean;
}

export class GameController {
  readonly actions: UiActions;
  private input: InputSampler | null = null;
  private rafHandle = 0;
  private latestSnapshot: GameSnapshot | null = null;
  private interactHeld = false;
  private stageMounted = false;
  private disposers: Array<() => void> = [];
  private thumbnailTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Floors worlds: rooms are compiled here from `world.floors`, the snapshot only names them. */
  private floorRooms: { worldId: string; provider: RoomProvider } | null = null;
  private shownWorldId: string | null = null;
  private shownRoomId: string | null = null;

  constructor(private readonly deps: GameControllerDeps) {
    this.actions = this.createActions();
  }

  static initialModel(session: GameSession, flags: PreviewFlags, chronicle: BrowserChronicle, liveGenerationAvailable: boolean): UiModel {
    const me = session.getLocalPlayer();
    return {
      phase: 'headquarters',
      connection: { mode: session.mode, status: session.getConnectionStatus(), isHost: session.getIsHost?.() ?? session.mode === 'local' },
      localPlayer: { ...me, isLocal: true },
      players: [{ ...me, isLocal: true }],
      contributions: session.getContributions(),
      generation: session.getGenerationStatus(),
      liveGenerationAvailable,
      world: null,
      room: null,
      hud: null,
      discoveredLore: [],
      memories: chronicle.getMemories(),
      classStatus: Object.fromEntries(CLASS_IDS.map((id) => [id, CLASS_INFO[id].status])) as UiModel['classStatus'],
      preview: { fixtureWorld: flags.fixtureWorld, startRoom: flags.startRoom },
      notice: null,
      headquarters: { nearbyStationId: null, activeStationId: null },
    };
  }

  /** Called once React has rendered the stage element. Mounts Phaser and starts the loop. */
  async attachStage(stage: HTMLElement): Promise<void> {
    if (this.stageMounted) return;
    this.stageMounted = true;
    const { session, renderer, store, chronicle, flags } = this.deps;

    await renderer.mount(stage);
    renderer.showHeadquarters(headquartersRoom, headquartersArt);
    this.input = createKeyboardMouseInput(stage);

    this.disposers.push(
      session.onSnapshot((snapshot) => this.handleSnapshot(snapshot)),
      session.onEvents((events) => this.handleEvents(events)),
      session.onWorld((world) => this.handleWorld(world)),
      session.onGenerationStatus((generation) => store.set({ generation })),
      session.onPhase((phase) => this.handlePhase(phase)),
      chronicle.subscribe((memories) => store.set({ memories })),
    );
    if (session.onError) this.disposers.push(session.onError((message) => this.notice('error', message)));
    // Floors stopgap until the biome-choice panel (agent F3) lands: 1 / 2 pick an offered biome.
    const pickBiome = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
      const choice = this.latestSnapshot?.floor?.biomeChoice;
      const biomeId = choice?.options[event.code === 'Digit1' ? 0 : event.code === 'Digit2' ? 1 : -1];
      if (biomeId !== undefined) session.chooseBiome?.(biomeId);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', pickBiome);
      this.disposers.push(() => window.removeEventListener('keydown', pickBiome));
    }

    this.loop();
    await session.start();

    if (flags.fixtureWorld && flags.autoEnter) {
      // Preview path for Agent C: skip the HQ flow, land straight in a room.
      try {
        await session.requestWorld();
        const local = session as LocalSession;
        if (flags.startRoom !== null && typeof local.enterRoomIndex === 'function') local.enterRoomIndex(flags.startRoom);
        else session.enterPortal();
      } catch (err) {
        this.notice('error', err instanceof Error ? err.message : String(err));
      }
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    for (const d of this.disposers) d();
    this.disposers = [];
    for (const timer of this.thumbnailTimers) clearTimeout(timer);
    this.thumbnailTimers.clear();
    this.input?.dispose();
    this.deps.session.dispose();
    this.deps.renderer.destroy();
    this.deps.audio.dispose?.();
  }

  // ---- frame loop ----------------------------------------------------------------

  private loop = (): void => {
    const { session, renderer, store } = this.deps;
    const connection = { mode: session.mode, status: session.getConnectionStatus(), isHost: session.getIsHost?.() ?? session.mode === 'local' };
    const previous = store.get();
    if (previous.connection.status !== connection.status || previous.connection.isHost !== connection.isHost) store.set({ connection });
    const contributions = session.getContributions();
    if (previous.contributions.length !== contributions.length || previous.contributions.some((c, index) => c.id !== contributions[index]?.id)) store.set({ contributions });
    const identity = session.getLocalPlayer();
    if (previous.localPlayer.id !== identity.id || previous.localPlayer.classId !== identity.classId || previous.localPlayer.displayName !== identity.displayName) {
      store.set({ localPlayer: { ...identity, isLocal: true } });
    }
    const snapshot = this.latestSnapshot;
    if (snapshot && this.input) {
      const me = snapshot.players.find((p) => p.id === session.localPlayerId);
      const pointer = this.input.getPointer();
      const aim = pointer ? renderer.screenToWorld(pointer.x, pointer.y) : me ? { x: me.x + Math.cos(me.facing), y: me.y + Math.sin(me.facing) } : { x: 0, y: 0 };
      const intent = this.input.sample(aim);
      if (intent.interact && !this.interactHeld) this.activateHeadquartersStation();
      this.interactHeld = intent.interact === true;
      session.setIntent(intent);
      renderer.renderSnapshot(snapshot, session.localPlayerId);

      if (me) {
        const prev = store.get().hud;
        const hud = hudFrom(me, snapshot);
        if (
          !prev ||
          prev.hp !== hud.hp ||
          prev.state !== hud.state ||
          prev.dashReady !== hud.dashReady ||
          prev.attackReady !== hud.attackReady ||
          prev.enemiesRemaining !== hud.enemiesRemaining ||
          prev.maxHp !== hud.maxHp ||
          prev.resources !== hud.resources ||
          prev.abilityEUnlocked !== hud.abilityEUnlocked ||
          prev.abilityQCooldownMs !== hud.abilityQCooldownMs ||
          prev.abilityECooldownMs !== hud.abilityECooldownMs ||
          prev.reviveProgress !== hud.reviveProgress ||
          prev.roomCleared !== hud.roomCleared ||
          prev.anchor?.state !== hud.anchor?.state ||
          prev.anchor?.progress !== hud.anchor?.progress ||
          prev.ultCharge !== hud.ultCharge ||
          prev.abilityRCooldownMs !== hud.abilityRCooldownMs ||
          (prev.training?.awakeEnemyIds.join(',') ?? '') !== (hud.training?.awakeEnemyIds.join(',') ?? '') ||
          Math.abs(prev.dashCooldownMs - hud.dashCooldownMs) > 40
        ) {
          store.set({ hud });
        }
      }
      const players = snapshot.players.map((p) => ({ id: p.id, displayName: p.displayName, classId: p.classId, isLocal: p.id === session.localPlayerId }));
      const prevPlayers = store.get().players;
      if (prevPlayers.length !== players.length || prevPlayers.some((p, i) => p.id !== players[i]!.id || p.displayName !== players[i]!.displayName || p.classId !== players[i]!.classId)) {
        store.set({ players });
      }
      const discoveredLore = snapshot.discoveredLore ?? [];
      const prevLore = store.get().discoveredLore;
      if (prevLore.length !== discoveredLore.length || prevLore.some((index, i) => index !== discoveredLore[i])) {
        store.set({ discoveredLore });
      }
    }
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  // ---- session listeners ---------------------------------------------------------

  private handleSnapshot(snapshot: GameSnapshot): void {
    this.latestSnapshot = snapshot;
    const { session, store, renderer, audio } = this.deps;
    const nearbyStationId = nearbyHeadquartersStation(snapshot, session.localPlayerId)?.id ?? null;
    const headquarters = store.get().headquarters;
    const activeStationId = headquarters?.activeStationId === nearbyStationId ? nearbyStationId : null;
    if (headquarters?.nearbyStationId !== nearbyStationId || headquarters?.activeStationId !== activeStationId) {
      store.set({ headquarters: { nearbyStationId, activeStationId } });
    }
    const me = snapshot.players.find((p) => p.id === session.localPlayerId);
    audio.setScene?.(snapshot.phase);
    if (snapshot.phase === 'training') {
      if (store.get().phase !== 'training') {
        this.shownWorldId = null;
        this.shownRoomId = trainingRoom.id;
        renderer.showRoom(trainingRoom, trainingArt);
        store.set({ phase: 'training', room: { index: 0, name: trainingRoom.name, description: trainingRoom.description, isFinal: false }, hud: me ? hudFrom(me, snapshot) : null });
      }
      return;
    }
    if (snapshot.phase !== 'headquarters' && store.get().phase !== snapshot.phase) {
      store.set({ phase: snapshot.phase });
    }
    const world = session.getWorld();
    const room = snapshot.floor && world ? this.floorRoom(world, snapshot.floor)
      : snapshot.roomIndex === null ? null : world?.rooms[snapshot.roomIndex];
    const roomChanged = this.shownWorldId !== world?.worldId || this.shownRoomId !== room?.id;
    if (world && room && snapshot.worldId === world.worldId && snapshot.roomId === room.id && snapshot.phase !== 'headquarters' && roomChanged) {
      this.shownWorldId = world.worldId;
      this.shownRoomId = room.id;
      renderer.showRoom(room, world.art, world.receipt.lines, { title: world.recipe.title, tagline: world.recipe.tagline });
      store.set({ room: { index: room.index, name: room.name, description: room.description, isFinal: room.isFinal }, phase: snapshot.phase, hud: me ? hudFrom(me, snapshot) : store.get().hud });
    }
  }

  /** Same deterministic provider the sim uses, so a room address is all the snapshot has to carry. */
  private floorRoom(world: PreparedWorld, floor: NonNullable<GameSnapshot['floor']>): RoomSpec | null {
    if (this.floorRooms?.worldId !== world.worldId) {
      const provider = createRoomProvider(world);
      this.floorRooms = provider ? { worldId: world.worldId, provider } : null;
    }
    try {
      return this.floorRooms?.provider.getRoom({ biomeId: floor.biomeId, roomId: floor.roomId }) ?? null;
    } catch {
      return null; // an address outside this world: keep showing the last room
    }
  }

  private handleEvents(events: GameEvent[]): void {
    const { renderer, audio, chronicle, session, store } = this.deps;
    renderer.playEvents(events);
    for (const e of events) {
      const cue = cueForEvent(e);
      if (cue) audio.play(cue);
      if (e.type === 'contribution_submitted') store.set({ contributions: session.getContributions() });
      if (e.type === 'biome_choice_offered') {
        const names = e.options.map((id, i) => `[${i + 1}] ${session.getWorld()?.floors?.briefs.find((brief) => brief.id === id)?.name ?? id}`);
        this.notice('info', `The way on is open. ${session.getIsHost?.() === false ? 'The host chooses' : 'Choose'}: ${names.join('  ·  ')}`);
      }
    }

    const world = session.getWorld();
    const snapshot = this.latestSnapshot ?? session.getSnapshot();
    const created = chronicle.ingest(events, {
      players: (snapshot?.players ?? []).map((p) => ({ id: p.id, displayName: p.displayName })),
      world: world
        ? { worldId: world.worldId, title: world.recipe.title, provenanceSource: world.provenance.source, receipt: world.receipt }
        : null,
    });
    for (const memory of created) {
      audio.play('memory_saved');
      if (memory.kind === 'arrival_keepsake') {
        // Real arrival, real frame: capture after the room reveal (fade/flash) has finished.
        const timer = setTimeout(() => {
          this.thumbnailTimers.delete(timer);
          if (session.getSnapshot()?.worldId !== memory.worldId || session.getPhase() !== 'expedition') return;
          renderer
            .captureThumbnail()
            .then((dataUrl) => {
              if (dataUrl) chronicle.attachThumbnail(memory.id, dataUrl);
            })
            .catch(() => {});
        }, 900);
        this.thumbnailTimers.add(timer);
      }
    }
  }

  private handleWorld(world: PreparedWorld): void {
    this.deps.audio.setWorld?.(world.art);
    this.deps.store.set({
      world: {
        worldId: world.worldId,
        title: world.recipe.title,
        tagline: world.recipe.tagline,
        themeSummary: world.recipe.themeSummary,
        provenance: world.provenance,
        receipt: world.receipt,
        committedRoomCount: world.rooms.length,
        plannedRoomCount: world.plannedRoomCount,
        lore: world.recipe.lore,
        attunements: world.recipe.attunements,
      },
      notice: null,
    });
  }

  private handlePhase(phase: 'headquarters' | 'training' | 'expedition' | 'debrief'): void {
    const { renderer, store, audio } = this.deps;
    audio.setScene?.(phase);
    store.set({ headquarters: { nearbyStationId: null, activeStationId: null } });
    if (phase === 'headquarters') {
      this.shownWorldId = null;
      this.shownRoomId = headquartersRoom.id;
      renderer.showHeadquarters(headquartersRoom, headquartersArt);
      store.set({ phase: 'headquarters', room: null, hud: null });
    } else if (phase === 'training') {
      if (this.shownWorldId !== null || this.shownRoomId !== trainingRoom.id) renderer.showRoom(trainingRoom, trainingArt);
      this.shownWorldId = null;
      this.shownRoomId = trainingRoom.id;
      store.set({ phase: 'training', room: { index: 0, name: trainingRoom.name, description: trainingRoom.description, isFinal: false } });
    } else if (phase === 'debrief') {
      store.set({ phase: 'debrief' });
    }
  }

  private notice(kind: 'info' | 'error', text: string): void {
    this.deps.store.set({ notice: { kind, text } });
  }

  private canUseHeadquarters(): boolean {
    const { session, store } = this.deps;
    return session.getPhase() === 'headquarters'
      && store.get().phase === 'headquarters'
      && !['queued', 'generating', 'validating'].includes(store.get().generation.phase)
      && session.getConnectionStatus() === 'connected';
  }

  private activateHeadquartersStation(): void {
    if (!this.canUseHeadquarters()) return;
    const { session, store, audio } = this.deps;
    const snapshot = session.getSnapshot();
    const station = snapshot ? nearbyHeadquartersStation(snapshot, session.localPlayerId) : null;
    if (!station) return;
    store.set({ headquarters: { nearbyStationId: station.id, activeStationId: station.id } });
    if (station.classId) this.actions.selectClass(station.classId);
    audio.play('ui_confirm');
  }

  // ---- UiActions -------------------------------------------------------------------

  private createActions(): UiActions {
    const { session, store, chronicle, audio } = this.deps;
    return {
      setDisplayName: (name) => {
        session.setDisplayName(name);
        const me = session.getLocalPlayer();
        store.set({ localPlayer: { ...me, isLocal: true } });
        persistIdentity(me);
      },
      selectClass: (classId: ClassId) => {
        if (!this.canUseHeadquarters()) return;
        session.setClass(classId);
        const me = session.getLocalPlayer();
        store.set({ localPlayer: { ...me, isLocal: true } });
        persistIdentity(me);
      },
      submitContribution: (text) => {
        const c = session.submitContribution(text);
        if (c) {
          audio.play('ui_confirm');
          store.set({ contributions: session.getContributions(), notice: null });
        } else {
          this.notice('error', 'Contribution must be 1–200 characters (max 24 per session).');
        }
      },
      requestWorld: () => {
        store.set({ phase: 'preparing', notice: null });
        session
          .requestWorld()
          .then(() => store.set({ phase: session.getPhase() === 'expedition' ? 'expedition' : 'headquarters' }))
          .catch((err: unknown) => {
            store.set({ phase: 'headquarters' });
            this.notice('error', err instanceof Error ? err.message : String(err));
          });
      },
      enterPortal: () => {
        if (!session.getWorld()) {
          this.notice('info', 'Prepare a world first, then step onto the portal or press Enter Portal.');
          return;
        }
        session.enterPortal();
      },
      returnToHeadquarters: () => session.returnToHeadquarters(),
      clearMemories: () => chronicle.clear(),
      dismissNotice: () => store.set({ notice: null }),
      toggleAudio: () => {
        audio.setMuted(!audio.isMuted());
        store.set({ audioMuted: audio.isMuted() });
      },
      unlockAbility: () => session.unlockAbility?.(),
      enterTraining: () => {
        const ok = session.enterTraining?.() ?? false;
        if (!ok) this.notice('info', 'The training range is available in solo play from headquarters.');
      },
      activateHeadquartersStation: () => this.activateHeadquartersStation(),
      closeHeadquartersStation: () => store.set((model) => ({
        ...model,
        headquarters: { nearbyStationId: model.headquarters?.nearbyStationId ?? null, activeStationId: null },
      })),
    };
  }
}

// ---- identity persistence (device-local) --------------------------------------------

export const IDENTITY_STORAGE_KEY = 'relay.identity.v1';

export function persistIdentity(identity: { id: string; displayName: string; classId: ClassId }): void {
  try {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
}

/** HUD projection of the local player's state (shared by the frame loop and phase changes). */
function hudFrom(me: PlayerState, snapshot: GameSnapshot): NonNullable<UiModel['hud']> {
  return {
    hp: me.hp,
    maxHp: me.maxHp,
    state: me.state,
    dashReady: me.dashCooldownMs <= 0,
    dashCooldownMs: Math.round(me.dashCooldownMs),
    attackReady: me.attackCooldownMs <= 0,
    enemiesRemaining: snapshot.enemies.filter((e) => e.state !== 'dead').length,
    resources: me.resources ?? 0,
    abilityEUnlocked: me.abilityEUnlocked ?? false,
    abilityQCooldownMs: Math.ceil((me.abilityQCooldownMs ?? 0) / 100) * 100,
    abilityECooldownMs: Math.ceil((me.abilityECooldownMs ?? 0) / 100) * 100,
    reviveProgress: me.reviveProgress ?? 0,
    roomCleared: snapshot.roomCleared ?? false,
    anchor: snapshot.anchor,
    ultCharge: Math.round(me.ultCharge ?? 0),
    abilityRCooldownMs: Math.ceil((me.abilityRCooldownMs ?? 0) / 100) * 100,
    training:
      snapshot.phase === 'training'
        ? { awakeEnemyIds: snapshot.enemies.filter((e) => e.state !== 'idle' && e.state !== 'dead').map((e) => e.id) }
        : null,
  };
}
