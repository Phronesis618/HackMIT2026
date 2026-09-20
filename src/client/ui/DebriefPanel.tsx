import type { UiActions, UiModel } from '../../shared/ui';

export function DebriefPanel({ model, actions }: { model: UiModel; actions: UiActions }) {
  const worldId = model.world?.worldId;
  const memories = worldId ? model.memories.filter((m) => m.worldId === worldId) : [];
  const summary = [...memories].reverse().find((m) => m.kind === 'run_summary');
  const highlights = memories.filter((m) => m.kind === 'milestone' || m.kind === 'anchor');
  const arrival = memories.find((m) => m.kind === 'arrival_keepsake');

  return (
    <section className="panel panel--debrief" aria-labelledby="debrief-title">
      <p className="eyebrow">Expedition debrief</p>
      <h2 className="panel__title" id="debrief-title">{model.world?.title ?? 'Expedition ended'}</h2>
      <p className="debrief__outcome">
        {summary?.summary ?? 'No expedition outcome has been recorded yet.'}
      </p>
      {arrival && (
        <div className="debrief__keepsake">
          {arrival.thumbnailDataUrl && (
            <img className="debrief__thumb" src={arrival.thumbnailDataUrl} alt={`Arrival in ${arrival.worldTitle}`} />
          )}
          <div>
            <h3 className="panel__subtitle">Arrival preserved</h3>
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
        <button type="button" className="btn btn--primary" onClick={actions.returnToHeadquarters}>
          Return to headquarters
        </button>
      </div>
    </section>
  );
}
