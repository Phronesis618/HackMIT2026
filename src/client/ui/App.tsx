import { useCallback } from 'react';
import type { UiActions } from '../../shared/ui';
import type { UiStore } from '../game/uiStore';
import { HeadquartersPanel } from './HeadquartersPanel';
import { Hud } from './Hud';
import { MemoryWall } from './MemoryWall';
import { ProvenanceBadge } from './ProvenanceBadge';
import { useUiModel } from './useUiModel';
import { WorldPanel } from './WorldPanel';

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
          {model.preview.fixtureWorld && <span className="badge badge--preview">PREVIEW · client fixture</span>}
          {model.world && <ProvenanceBadge provenance={model.world.provenance} compact />}
          <span className={`badge badge--conn badge--conn-${model.connection.status}`}>
            {model.connection.mode} · {model.connection.status}
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="stage-wrap">
          <div className="stage" ref={stageRef} tabIndex={0} aria-label="RELAY game canvas" />
        </section>
        <aside className="side">
          {(model.phase === 'headquarters' || model.phase === 'preparing') && <HeadquartersPanel model={model} actions={actions} />}
          {model.phase === 'expedition' && <Hud model={model} actions={actions} />}
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
