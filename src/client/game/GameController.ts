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
import type { GameEvent, GameSnapshot, PlayerIdentity, PlayerState, PreparedWorld, RoomSpec } from '../../shared/contracts';
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
import { departureBus, isDeparting } from '../ui/HeadquartersDeparture';
import { createKeyboardMouseInput, type InputSampler } from './input';
import { stageOwnsInput } from './keyboardFocus';
import type { UiStore } from './uiStore';
import { IMPLEMENTED_LAW_IDS, lawEffectText, resolveLaws, worldLawsView } from '../../sim/laws';
import { withLookOverrides } from '../render/lookOverrides';

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
  persistIdentity?: (identity: PlayerIdentity) => void;
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
  private viewVersion = 0;

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
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !stageOwnsInput(event.target, stage)) return;
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
    // Mirror connection state eagerly (and on a timer) so a tab whose animation frames are
    // throttled or paused never shows "offline" for a session that is actually running.
    const syncConnection = (): void => {
      const connection = { mode: session.mode, status: session.getConnectionStatus(), isHost: session.getIsHost?.() ?? session.mode === 'local' };
      const previous = store.get().connection;
      if (previous.status !== connection.status || previous.isHost !== connection.isHost) store.set({ connection });
    };
    syncConnection();
    const connectionTimer = setInterval(syncConnection, 500);
    this.disposers.push(() => clearInterval(connectionTimer));

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
    this.viewVersion++;
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
    this.syncIdentity();
    const snapshot = this.latestSnapshot;
    if (snapshot && this.input) {
      const me = snapshot.players.find((p) => p.id === session.localPlayerId);
      const pointer = this.input.getPointer();
      const aim = pointer ? renderer.screenToWorld(pointer.x, pointer.y) : me ? { x: me.x + Math.cos(me.facing), y: me.y + Math.sin(me.facing) } : { x: 0, y: 0 };
      const sampled = this.input.sample(aim);
      // Departure ritual (HUB.md §8): inputs lock while the gate opens; F / Escape only skip the wait.
      const intent = isDeparting(departureBus.get()) ? { ...sampled, moveX: 0, moveY: 0, attack: false, dash: false, ability: null, interact: false } : sampled;
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
          prev.collapse?.stage !== hud.collapse?.stage ||
          prev.collapse?.chosenKey !== hud.collapse?.chosenKey ||
          (prev.collapse?.offer.map((card) => card.votes.join()).join('|') ?? '') !== (hud.collapse?.offer.map((card) => card.votes.join()).join('|') ?? '') ||
          // A tenth of a second is the collapse clock's precision, and the only reason to re-render it.
          Math.round((prev.collapse?.remainingMs ?? 0) / 100) !== Math.round((hud.collapse?.remainingMs ?? 0) / 100) ||
          prev.abilityRCooldownMs !== hud.abilityRCooldownMs ||
          (prev.training?.awakeEnemyIds.join(',') ?? '') !== (hud.training?.awakeEnemyIds.join(',') ?? '') ||
          Math.abs(prev.dashCooldownMs - hud.dashCooldownMs) > 40
        ) {
          store.set({ hud });
        }
      }
      const players = snapshot.players.map((p) => ({
        id: p.id, displayName: p.displayName, classId: p.classId, isLocal: p.id === session.localPlayerId,
        hp: Math.round(p.hp), maxHp: p.maxHp, state: p.state, skills: p.skills,
      }));
      const prevPlayers = store.get().players;
      if (prevPlayers.length !== players.length || prevPlayers.some((p, i) => {
        const next = players[i]!;
        return p.id !== next.id || p.displayName !== next.displayName || p.classId !== next.classId || p.hp !== next.hp || p.maxHp !== next.maxHp || p.state !== next.state
          || (p.skills?.length ?? 0) !== (next.skills?.length ?? 0);
      })) {
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
    if (
      this.latestSnapshot?.worldId !== snapshot.worldId ||
      this.latestSnapshot?.roomId !== snapshot.roomId ||
      this.latestSnapshot?.phase !== snapshot.phase
    ) this.viewVersion++;
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
      const lawsView = withLookOverrides(worldLawsView(world));
      // Exit label: where the door leads, so the run reads as a route.
      const nextIndex = room.exits[0]?.toRoomIndex;
      const nextRoom = snapshot.floor || nextIndex === undefined ? undefined : world.rooms[nextIndex];
      const exitLabel = nextRoom ? `→ ${nextRoom.name}` : !snapshot.floor && nextIndex !== undefined && !room.isFinal ? '→ next room (still forming)' : undefined;
      renderer.showRoom(room, world.art, world.receipt.lines, {
        title: world.recipe.title, tagline: world.recipe.tagline, look: lawsView.look, lightRadius: resolveLaws(lawsView.laws).lightRadius,
        ...(exitLabel ? { exitLabel } : {}),
      });
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
      localPlayerId: session.localPlayerId,
      classByPlayerId: Object.fromEntries((snapshot?.players ?? []).map((p) => [p.id, p.classId])),
      world: world
        ? { worldId: world.worldId, title: world.recipe.title, provenanceSource: world.provenance.source, receipt: world.receipt, biomes: world.floors?.briefs.map((brief) => ({ id: brief.id, name: brief.name })) }
        : null,
    });
    for (const memory of created) {
      audio.play('memory_saved');
      if (memory.kind === 'arrival_keepsake') {
        const arrival = events.find((event) => event.type === 'room_entered' && memory.sourceEventIds.includes(event.id));
        if (arrival?.type !== 'room_entered') continue;
        const showingArrival = (): boolean => {
          const current = session.getSnapshot();
          return current?.worldId === memory.worldId && current.roomId === arrival.roomId
            && current.phase === 'expedition' && this.shownWorldId === memory.worldId
            && this.shownRoomId === arrival.roomId;
        };
        const timer = setTimeout(() => {
          this.thumbnailTimers.delete(timer);
          if (!showingArrival()) return;
          const version = this.viewVersion;
          renderer
            .captureThumbnail()
            .then((dataUrl) => {
              if (dataUrl && version === this.viewVersion && showingArrival()) chronicle.attachThumbnail(memory.id, dataUrl);
            })
            .catch(() => {});
        }, 900);
        this.thumbnailTimers.add(timer);
      }
    }
  }

  private handleWorld(world: PreparedWorld): void {
    this.deps.audio.setWorld?.(world.art);
    this.deps.chronicle.refreshReceipt({
      worldId: world.worldId,
      title: world.recipe.title,
      provenanceSource: world.provenance.source,
      receipt: world.receipt,
    });
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
        laws: withLookOverrides(worldLawsView(world)).laws.map((law) => ({
          lawId: law.lawId, name: law.name, description: law.description, effect: lawEffectText(law), active: IMPLEMENTED_LAW_IDS.includes(law.lawId),
        })),
        palette: world.art.palette,
        motifIds: world.art.motifIds,
        roomNames: world.rooms.map((room) => room.name),
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

  private syncIdentity(): void {
    const { session, store, persistIdentity } = this.deps;
    if (session.mode === 'remote' && session.getConnectionStatus() !== 'connected') return;
    const identity = session.getLocalPlayer();
    const previous = store.get().localPlayer;
    if (previous.id === identity.id && previous.classId === identity.classId && previous.displayName === identity.displayName) return;
    store.set({ localPlayer: { ...identity, isLocal: true } });
    persistIdentity?.(identity);
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
        this.syncIdentity();
      },
      selectClass: (classId: ClassId) => {
        if (!this.canUseHeadquarters()) return;
        session.setClass(classId);
        this.syncIdentity();
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
      learnSkill: (skillId: string) => session.learnSkill?.(skillId),
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
    collapse: snapshot.collapse ?? null,
    training:
      snapshot.phase === 'training'
        ? { awakeEnemyIds: snapshot.enemies.filter((e) => e.state !== 'idle' && e.state !== 'dead').map((e) => e.id) }
        : null,
  };
}
