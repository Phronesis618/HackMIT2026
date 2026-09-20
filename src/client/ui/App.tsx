import { useCallback } from 'react';
import type { UiActions } from '../../shared/ui';
import type { UiStore } from '../game/uiStore';
import { HeadquartersPanel } from './HeadquartersPanel';
import { Hud } from './Hud';
import { MemoryWall } from './MemoryWall';
import { GenerationOverlay } from './GenerationOverlay';
import { PartyPlate } from './PartyPlate';
import { ProvenanceBadge } from './ProvenanceBadge';
import { useUiModel } from './useUiModel';
import { WorldPanel } from './WorldPanel';
import { DebriefPanel } from './DebriefPanel';
import { AbilityBar } from './AbilityBar';
import { GameMenu } from './GameMenu';

export interface AppProps {
  store: UiStore;
  actions: UiActions;
  /** Called once with the element that should host the game canvas. */
  onStageReady: (stage: HTMLElement) => void;
}

export function App({ store, actions, onStageReady }: AppProps) {
  const model = useUiModel(store);
  const inRun = model.phase === 'expedition' || model.phase === 'training';
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) onStageReady(el);
    },
    [onStageReady],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 22a10 10 0 0 1 20 0" />
            <path d="M10.5 22a5.5 5.5 0 0 1 11 0" />
            <circle cx="16" cy="22" r="1.8" />
            <path d="M16 4v6" />
          </svg>
          <span className="brand__name">RELAY</span>
          <span className="brand__tag">Worlds end. Your stories don't.</span>
          <span className="brand__telemetry" aria-hidden="true">
            {model.world ? `${model.world.title} · ` : ''}
            {model.phase === 'expedition' && model.room ? `room ${model.room.index + 1}` : model.phase === 'training' ? 'training range' : model.phase === 'debrief' ? 'debrief' : model.phase === 'preparing' ? 'preparing' : 'sanctuary'}
          </span>
        </div>
        <div className="topbar__status">
          <a className="btn btn--ghost" href={model.connection.mode === 'remote' ? '/' : '?mode=coop'}>
            {model.connection.mode === 'remote' ? 'Play solo' : 'Join co-op'}
          </a>
          <button className="btn btn--ghost" type="button" onClick={actions.toggleAudio} aria-pressed={!model.audioMuted}>
            Sound {model.audioMuted ? 'off' : 'on'}
          </button>
          {model.preview.fixtureWorld && <span className="badge badge--preview">PREVIEW · client fixture</span>}
          {model.world && <ProvenanceBadge provenance={model.world.provenance} compact />}
          <span className={`badge badge--conn badge--conn-${model.connection.status}`}>
            {model.connection.mode === 'remote' ? `co-op · ${model.connection.isHost ? 'host' : 'crew'}` : 'solo'} · {model.connection.status}
          </span>
        </div>
      </header>

      <main className={`layout ${inRun ? 'layout--run' : ''}`}>
        <section className="stage-wrap">
          <div className="stage" ref={stageRef} tabIndex={0} aria-label="RELAY game canvas" />
          <div className="stage-caption" aria-hidden="true">
            <span>{inRun || model.phase === 'debrief' ? model.room?.name : 'RELAY / SANCTUARY'}</span>
          </div>
          {inRun && <PartyPlate model={model} />}
          {inRun && <Hud model={model} actions={actions} />}
          {!inRun && <GenerationOverlay model={model} actions={actions} />}
          {model.phase !== 'debrief' && <AbilityBar model={model} actions={actions} />}
        </section>
        {!inRun && (
          <aside className="side">
            {(model.phase === 'headquarters' || model.phase === 'preparing') && <HeadquartersPanel model={model} actions={actions} />}
            {model.phase === 'debrief' && <DebriefPanel model={model} actions={actions} />}
            {model.world && <WorldPanel world={model.world} discoveredLore={model.discoveredLore} />}
          </aside>
        )}
      </main>

      <MemoryWall memories={model.memories} actions={actions} />
      <GameMenu model={model} actions={actions} />

      {model.notice && (
        <div className={`notice notice--${model.notice.kind}`} role="status">
          <span>{model.notice.text}</span>
          <button type="button" className="btn btn--ghost" onClick={actions.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
