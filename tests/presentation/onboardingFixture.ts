/** Test helper (O1): hand-built onboarding contexts. Every lesson predicate is pure. */
import type { GameEvent, GameSnapshot, PlayerState } from '../../src/shared/contracts';
import { IDLE_GENERATION_STATUS } from '../../src/shared/contracts';
import { samplePlayers } from '../../src/shared/samples';
import type { UiModel } from '../../src/shared/ui';
import { emptyFacts, type LessonContext, type RunFacts } from '../../src/client/onboarding';

export const ME = 'p-me';
export const MATE = 'p-mate';

export function player(id: string, over: Partial<PlayerState> = {}): PlayerState {
  return {
    id, displayName: id, classId: 'bastion', x: 100, y: 100, vx: 0, vy: 0, facing: 0,
    hp: 100, maxHp: 100, state: 'idle', dashCooldownMs: 0, attackCooldownMs: 0, invulnerableMs: 0, ...over,
  };
}

export function snapshot(over: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 1, timeMs: 1000, phase: 'expedition', worldId: 'w1', roomIndex: 0, roomId: 'r1',
    players: [player(ME)], enemies: [], anchor: null, ...over,
  };
}

export function uiModel(over: Partial<UiModel> = {}): UiModel {
  return {
    phase: 'expedition',
    connection: { mode: 'local', status: 'connected', isHost: true },
    localPlayer: { ...samplePlayers[0]!, id: ME, isLocal: true },
    players: [{ ...samplePlayers[0]!, id: ME, isLocal: true }],
    contributions: [],
    generation: IDLE_GENERATION_STATUS,
    liveGenerationAvailable: false,
    world: null,
    room: null,
    hud: null,
    discoveredLore: [],
    memories: [],
    classStatus: { bastion: 'implemented', shade: 'implemented', beacon: 'implemented', weaver: 'implemented' },
    preview: { fixtureWorld: true, startRoom: null },
    notice: null,
    ...over,
  };
}

export interface ContextOverrides {
  nowMs?: number;
  phaseMs?: number;
  snapshot?: GameSnapshot | null;
  model?: UiModel;
  facts?: Partial<RunFacts>;
  events?: GameEvent[];
  terrainHere?: string[];
  isHost?: boolean;
  isCoOp?: boolean;
  blocked?: boolean;
}

export function context(over: ContextOverrides = {}): LessonContext {
  const model = over.model ?? uiModel();
  const snap = over.snapshot === undefined ? snapshot({ phase: model.phase === 'headquarters' ? 'headquarters' : 'expedition' }) : over.snapshot;
  return {
    nowMs: over.nowMs ?? 10_000,
    phase: model.phase,
    phaseMs: over.phaseMs ?? 5000,
    snapshot: snap,
    model,
    localPlayerId: ME,
    events: over.events ?? [],
    // A player in a run has already walked to get there; hub tests set `moved: false`.
    facts: { ...emptyFacts('w1'), moved: model.phase !== 'headquarters', ...over.facts },
    world: null,
    terrainHere: over.terrainHere ?? [],
    isHost: over.isHost ?? true,
    isCoOp: over.isCoOp ?? false,
    blocked: over.blocked ?? false,
  };
}

/** A memory-backed `KeyValueStorage` for the persistence tests. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    raw: map,
  };
}
