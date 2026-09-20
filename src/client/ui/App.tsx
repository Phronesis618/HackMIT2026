import { useCallback } from 'react';
import type { UiActions } from '../../shared/ui';
import type { UiStore } from '../game/uiStore';
import { HeadquartersPanel } from './HeadquartersPanel';
import { Hud } from './Hud';
import { MemoryWall } from './MemoryWall';
import { ProvenanceBadge } from './ProvenanceBadge';
import { useUiModel } from './useUiModel';
import { WorldPanel } from './WorldPanel';
import { DebriefPanel } from './DebriefPanel';
import { AbilityBar } from './AbilityBar';

export interface AppProps {
  store: UiStore;
  actions: UiActions;
  /** Called once with the element that should host the game canvas. */
  onStageReady: (stage: HTMLElement) => void;
}

export function App({ store, actions, onStageReady }: AppProps) {
  const model = useUiModel(store);
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
          <span className="brand__mark" />
          <span className="brand__name">RELAY</span>
          <span className="brand__tag">Worlds end. Your stories don't.</span>
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

      <main className="layout">
        <section className="stage-wrap">
          <div className="stage" ref={stageRef} tabIndex={0} aria-label="RELAY game canvas" />
          <div className="stage-caption" aria-hidden="true">
            <span>{model.phase === 'expedition' || model.phase === 'debrief' || model.phase === 'training' ? model.room?.name : 'RELAY / SANCTUARY'}</span>
          </div>
          {model.phase !== 'debrief' && <AbilityBar model={model} actions={actions} />}
        </section>
        <aside className="side">
          {(model.phase === 'headquarters' || model.phase === 'preparing') && <HeadquartersPanel model={model} actions={actions} />}
          {(model.phase === 'expedition' || model.phase === 'training') && <Hud model={model} actions={actions} />}
          {model.phase === 'debrief' && <DebriefPanel model={model} actions={actions} />}
          {model.world && <WorldPanel world={model.world} />}
        </aside>
      </main>

      <MemoryWall memories={model.memories} actions={actions} />

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
