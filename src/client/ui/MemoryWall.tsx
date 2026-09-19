import type { MemoryRecord } from '../../shared/contracts';
import type { UiActions } from '../../shared/ui';
import { useState } from 'react';

const KIND_LABEL: Record<MemoryRecord['kind'], string> = {
  creation_receipt: 'Receipt',
  arrival_keepsake: 'Arrival',
  milestone: 'Milestone',
  anchor: 'Anchor',
  run_summary: 'Expedition',
};

/** Device-local memory wall. Only ever shows records derived from real events. */
export function MemoryWall({ memories, actions }: { memories: MemoryRecord[]; actions: UiActions }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const ordered = [...memories].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section className="wall" aria-label="Device-local memory wall">
      <div className="wall__head">
        <h2 className="panel__title">Memory wall</h2>
        <span className="muted">{memories.length === 0 ? 'Nothing yet — memories appear from real play on this device.' : `${memories.length} saved on this device`}</span>
        {memories.length > 0 && (
          <div className="wall__actions">
            {confirmClear ? <>
              <span className="hint">Erase memories on this device?</span>
              <button type="button" className="btn" onClick={() => { actions.clearMemories(); setConfirmClear(false); }}>Erase memories</button>
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
            </> : <button type="button" className="btn btn--ghost" onClick={() => setConfirmClear(true)}>Clear</button>}
          </div>
        )}
      </div>
      <div className="wall__cards">
        {ordered.length === 0 && (
          <p className="wall__empty">Prepare a world for your first receipt. Enter it for your first keepsake.</p>
        )}
        {ordered.map((m) => (
          <article key={m.id} className={`card card--${m.kind}`}>
            {m.thumbnailDataUrl && <img className="card__thumb" src={m.thumbnailDataUrl} alt={`Captured arrival in ${m.worldTitle}`} loading="lazy" />}
            <div className="card__body">
              <div className="card__meta">
                <span className="badge badge--kind">{KIND_LABEL[m.kind]}</span>
                <span className={`badge badge--${m.provenanceSource === 'live' ? 'live' : m.provenanceSource === 'fixture' ? 'fixture' : 'fallback'}`}>
                  {m.provenanceSource.replace(/_/g, ' ')}
                </span>
                <time dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString()}>{new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
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
