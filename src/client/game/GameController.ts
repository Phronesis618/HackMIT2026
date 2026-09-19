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
import type { GameEvent, GameSnapshot, PreparedWorld } from '../../shared/contracts';
import { ABILITY_STATUS, CLASS_INFO, CLASS_IDS, type ClassId } from '../../shared/registry';
import type { WorldRenderer } from '../../shared/render';
import type { GameSession } from '../../shared/session';
import type { UiActions, UiModel } from '../../shared/ui';
import { headquartersArt, headquartersRoom } from '../../sim';
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
  private stageMounted = false;
  private disposers: Array<() => void> = [];

  constructor(private readonly deps: GameControllerDeps) {
    this.actions = this.createActions();
  }

  static initialModel(session: GameSession, flags: PreviewFlags, chronicle: BrowserChronicle, liveGenerationAvailable: boolean): UiModel {
    const me = session.getLocalPlayer();
    return {
      phase: 'headquarters',
      connection: { mode: session.mode, status: session.getConnectionStatus() },
      localPlayer: { ...me, isLocal: true },
      players: [{ ...me, isLocal: true }],
      contributions: session.getContributions(),
      generation: session.getGenerationStatus(),
      liveGenerationAvailable,
      world: null,
      room: null,
      hud: null,
      memories: chronicle.getMemories(),
      classStatus: Object.fromEntries(CLASS_IDS.map((id) => [id, CLASS_INFO[id].status])) as UiModel['classStatus'],
      preview: { fixtureWorld: flags.fixtureWorld, startRoom: flags.startRoom },
      notice: null,
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
      session.onSnapshot((snapshot) => {
        this.latestSnapshot = snapshot;
      }),
      session.onEvents((events) => this.handleEvents(events)),
      session.onWorld((world) => this.handleWorld(world)),
      session.onGenerationStatus((generation) => store.set({ generation })),
      session.onPhase((phase) => this.handlePhase(phase)),
      chronicle.subscribe((memories) => store.set({ memories })),
    );

    await session.start();
    store.set({ connection: { mode: session.mode, status: session.getConnectionStatus() } });
    this.loop();

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
    this.input?.dispose();
    this.deps.session.dispose();
    this.deps.renderer.destroy();
  }

  // ---- frame loop ----------------------------------------------------------------

  private loop = (): void => {
    const { session, renderer, store } = this.deps;
    const snapshot = this.latestSnapshot;
    if (snapshot && this.input) {
      const me = snapshot.players.find((p) => p.id === session.localPlayerId);
      const pointer = this.input.getPointer();
      const aim = pointer ? renderer.screenToWorld(pointer.x, pointer.y) : me ? { x: me.x + Math.cos(me.facing), y: me.y + Math.sin(me.facing) } : { x: 0, y: 0 };
      session.setIntent(this.input.sample(aim));
      renderer.renderSnapshot(snapshot, session.localPlayerId);

      if (me) {
        const prev = store.get().hud;
        const hud = {
          hp: me.hp,
          maxHp: me.maxHp,
          state: me.state,
          dashReady: me.dashCooldownMs <= 0,
          dashCooldownMs: Math.round(me.dashCooldownMs),
          attackReady: me.attackCooldownMs <= 0,
          enemiesRemaining: snapshot.enemies.filter((e) => e.state !== 'dead').length,
        };
        if (
          !prev ||
          prev.hp !== hud.hp ||
          prev.state !== hud.state ||
          prev.dashReady !== hud.dashReady ||
          prev.attackReady !== hud.attackReady ||
          prev.enemiesRemaining !== hud.enemiesRemaining ||
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
    }
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  // ---- session listeners ---------------------------------------------------------

  private handleEvents(events: GameEvent[]): void {
    const { renderer, audio, chronicle, session, store } = this.deps;
    renderer.playEvents(events);
    for (const e of events) {
      const cue = cueForEvent(e);
      if (cue) audio.play(cue);
      if (e.type === 'room_entered') {
        const world = session.getWorld();
        const room = world?.rooms[e.roomIndex];
        if (world && room) {
          renderer.showRoom(room, world.art);
          store.set({ phase: 'expedition', room: { index: room.index, name: room.name, description: room.description, isFinal: room.isFinal } });
        }
      }
      if (e.type === 'contribution_submitted') store.set({ contributions: session.getContributions() });
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
        setTimeout(() => {
          renderer
            .captureThumbnail()
            .then((dataUrl) => {
              if (dataUrl) chronicle.attachThumbnail(memory.id, dataUrl);
            })
            .catch(() => {});
        }, 900);
      }
    }
  }

  private handleWorld(world: PreparedWorld): void {
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
      },
      notice: null,
    });
  }

  private handlePhase(phase: 'headquarters' | 'expedition' | 'debrief'): void {
    const { renderer, store } = this.deps;
    if (phase === 'headquarters') {
      renderer.showHeadquarters(headquartersRoom, headquartersArt);
      store.set({ phase: 'headquarters', room: null, hud: null });
    } else if (phase === 'debrief') {
      store.set({ phase: 'debrief' });
    }
  }

  private notice(kind: 'info' | 'error', text: string): void {
    this.deps.store.set({ notice: { kind, text } });
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
        session.setClass(classId);
        const me = session.getLocalPlayer();
        store.set({ localPlayer: { ...me, isLocal: true } });
        persistIdentity(me);
        if (CLASS_INFO[classId].status === 'planned') {
          this.notice('info', `${CLASS_INFO[classId].name} is selected but its abilities are not implemented yet (attack: ${ABILITY_STATUS.attack}, dash: ${ABILITY_STATUS.dash}).`);
        }
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
