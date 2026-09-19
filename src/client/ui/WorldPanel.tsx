import type { UiWorldSummary } from '../../shared/ui';
import { ProvenanceBadge } from './ProvenanceBadge';

/** Creation receipt: shown immediately after a world is prepared. Honest by construction. */
export function WorldPanel({ world }: { world: UiWorldSummary }) {
  const r = world.receipt;
  return (
    <div className="panel panel--world">
      <p className="eyebrow">World dossier · {world.committedRoomCount}/{world.plannedRoomCount} rooms ready</p>
      <div className="panel__row">
        <h2 className="panel__title">{world.title}</h2>
        <ProvenanceBadge provenance={world.provenance} />
      </div>
      <p className="tagline">{world.tagline}</p>
      <p className="muted">{world.themeSummary}</p>
      <p className="muted">
        Rooms committed: {world.committedRoomCount}/{world.plannedRoomCount} · prepared in {Math.round(world.provenance.durationMs)} ms ·{' '}
        {world.provenance.attempts} model call{world.provenance.attempts === 1 ? '' : 's'}
      </p>

      <h3 className="panel__subtitle">Creation receipt</h3>
      {world.provenance.source !== 'live' && (
        <p className="receipt__disclosure">
          {world.provenance.source === 'fixture' ? 'Offline fixture.' : 'Live generation failed; using an offline fixture.'}
          {' '}Your ideas are recorded, but did not shape this world.
        </p>
      )}
      <p className="receipt__headline">{r.headline}</p>
      {r.lines.length > 0 && (
        <ul className="list">
          {r.lines.map((line) => (
            <li key={line.contributionId} className={`list__item ${world.provenance.source === 'live' && line.used ? 'list__item--used' : 'list__item--unused'}`}>
              <span className="list__who">{line.playerName}</span> “{line.text}”
              <div className="list__meta">{world.provenance.source === 'live' && line.used ? `→ ${line.featureDescription ?? 'Attributed by the generation receipt'}` : 'recorded · not used in this world'}</div>
            </li>
          ))}
        </ul>
      )}
      {r.lines.length === 0 && <p className="muted">No contributions were submitted for this world.</p>}
      {world.provenance.notes.length > 0 && (
        <details className="notes">
          <summary>Provenance notes</summary>
          <ul>
            {world.provenance.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
