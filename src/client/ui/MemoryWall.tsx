import type { MemoryRecord } from '../../shared/contracts';
import type { UiActions } from '../../shared/ui';

const KIND_LABEL: Record<MemoryRecord['kind'], string> = {
  creation_receipt: 'Receipt',
  arrival_keepsake: 'Arrival',
  milestone: 'Milestone',
  anchor: 'Anchor',
  run_summary: 'Expedition',
};

/** Device-local memory wall. Only ever shows records derived from real events. */
export function MemoryWall({ memories, actions }: { memories: MemoryRecord[]; actions: UiActions }) {
  const ordered = [...memories].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="wall">
      <div className="wall__head">
        <h2 className="panel__title">Memory wall</h2>
        <span className="muted">{memories.length === 0 ? 'Nothing yet — memories appear from real play on this device.' : `${memories.length} saved on this device`}</span>
        {memories.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={actions.clearMemories}>
            Clear
          </button>
        )}
      </div>
      <div className="wall__cards">
        {ordered.map((m) => (
          <article key={m.id} className={`card card--${m.kind}`}>
            {m.thumbnailDataUrl && <img className="card__thumb" src={m.thumbnailDataUrl} alt="" />}
            <div className="card__body">
              <div className="card__meta">
                <span className="badge badge--kind">{KIND_LABEL[m.kind]}</span>
                <span className={`badge badge--${m.provenanceSource === 'live' ? 'live' : m.provenanceSource === 'fixture' ? 'fixture' : 'fallback'}`}>
                  {m.provenanceSource.replace(/_/g, ' ')}
                </span>
                <time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleTimeString()}</time>
              </div>
              <h3 className="card__title">{m.title}</h3>
              <p className="card__summary">{m.summary}</p>
              <p className="card__people">{m.participants.map((p) => p.displayName).join(', ')}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
