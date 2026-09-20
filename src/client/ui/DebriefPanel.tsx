import type { UiActions, UiModel } from '../../shared/ui';

export function DebriefPanel({ model, actions }: { model: UiModel; actions: UiActions }) {
  const worldId = model.world?.worldId;
  const memories = worldId ? model.memories.filter((m) => m.worldId === worldId) : [];
  const summary = [...memories].reverse().find((m) => m.kind === 'run_summary');
  const highlights = memories.filter((m) => m.kind === 'milestone' || m.kind === 'anchor');
  const arrival = memories.find((m) => m.kind === 'arrival_keepsake');
  const anchored = model.hud?.anchor?.state === 'planted';

  return (
    <section className="panel panel--debrief" aria-labelledby="debrief-title">
      <p className="eyebrow">Expedition debrief</p>
      <h2 className="panel__title" id="debrief-title">{model.world?.title ?? 'Expedition ended'}</h2>
      <p className="debrief__outcome">
        {summary?.summary ?? 'No expedition outcome has been recorded yet.'}
      </p>
      {anchored && (
        <div className="debrief__keepsake">
          <div>
            <p className="eyebrow">Anchor planted</p>
            <h3 className="panel__subtitle">The world is anchored.</h3>
            <p className="muted">
              The Custodian is down and the Anchor is planted. The records below are saved on this
              device and appear in the headquarters archive.
            </p>
          </div>
        </div>
      )}
      {arrival && (
        <div className="debrief__keepsake">
          {arrival.thumbnailDataUrl && (
            <img className="debrief__thumb" src={arrival.thumbnailDataUrl} alt={`Arrival in ${arrival.worldTitle}`} />
          )}
          <div>
            <h3 className="panel__subtitle">Arrival keepsake</h3>
            <p className="muted">{arrival.summary}</p>
          </div>
        </div>
      )}
      {highlights.length > 0 && (
        <ul className="list" aria-label="Recorded expedition milestones">
          {highlights.map((m) => <li className="list__item" key={m.id}>{m.summary}</li>)}
        </ul>
      )}
      <p className="hint">
        {memories.length > 0
          ? `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} from this world on your device’s wall.`
          : 'No memories from this world are stored on this device.'}
      </p>
      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={actions.returnToHeadquarters} disabled={model.connection.isHost === false}>
          Return to headquarters
        </button>
        {model.connection.isHost === false && <p className="hint">The host returns the crew together.</p>}
      </div>
    </section>
  );
}
