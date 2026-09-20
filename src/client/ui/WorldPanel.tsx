import { ENEMY_INFO } from '../../shared/registry';
import type { UiWorldSummary } from '../../shared/ui';
import { openMenu } from './MemoryWall';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * Codex: what the crew has actually found, nothing more. Fragments are authored by the
 * world and only unlock through play — reading a relic in a room, or defeating an enemy
 * kind for the first time. Undiscovered entries stay ??? so the sidebar never tells what
 * the rooms are meant to show.
 */
export function Codex({ world, discovered }: { world: UiWorldSummary; discovered: number[] }) {
  if (world.lore.length === 0) return null;
  const found = new Set(discovered);
  const relics = world.lore.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === 'relic');
  const remains = world.lore.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === 'remains');
  const entry = ({ f, i }: { f: UiWorldSummary['lore'][number]; i: number }) => {
    const known = found.has(i);
    const hint = f.kind === 'relic'
      ? `Unread · room ${f.roomIndex + 1}`
      : `Unknown · ${f.enemyId ? ENEMY_INFO[f.enemyId].name : 'hostile'} remains`;
    return (
      <li key={i} className={`codex__entry ${known ? 'codex__entry--found' : ''}`}>
        <span className="codex__title">{known ? f.title : '???'}</span>
        {known && <span className="codex__source">{f.source}</span>}
        <span className="codex__text">{known ? f.text : hint}</span>
      </li>
    );
  };
  return (
    <div className="codex">
      <p className="eyebrow">Codex · {found.size}/{world.lore.length} found</p>
      {relics.length > 0 && <ul className="codex__list" aria-label="Relics">{relics.map(entry)}</ul>}
      {remains.length > 0 && <ul className="codex__list" aria-label="Remains">{remains.map(entry)}</ul>}
    </div>
  );
}

/** Creation receipt: shown immediately after a world is prepared. Honest by construction. */
export function WorldPanel({ world, discoveredLore = [], compact = false }: { world: UiWorldSummary; discoveredLore?: number[]; compact?: boolean }) {
  const r = world.receipt;
  // In a run the rail only identifies the world; the Codex and receipt are one Tab away.
  if (compact) {
    return (
      <button type="button" className="panel panel--world world-brief" onClick={() => openMenu('codex')} aria-label={`${world.title}. Open codex.`}>
        <span className="eyebrow">World</span>
        <span className="world-brief__title">{world.title}</span>
        <span className="tagline">{world.tagline}</span>
        <span className="world-brief__foot">
          <span>{world.committedRoomCount}/{world.plannedRoomCount} rooms</span>
          <span className="world-brief__codex">Codex {new Set(discoveredLore).size}/{world.lore.length} ›</span>
        </span>
      </button>
    );
  }
  return (
    <div className="panel panel--world">
      <p className="eyebrow">World dossier · {world.committedRoomCount}/{world.plannedRoomCount} rooms ready</p>
      <div className="panel__row">
        <h2 className="panel__title">{world.title}</h2>
        <ProvenanceBadge provenance={world.provenance} />
      </div>
      <p className="tagline">{world.tagline}</p>
      <section aria-label="Creation receipt" aria-live="polite">
        <p className="eyebrow">Creation receipt · {r.lines.length} contribution{r.lines.length === 1 ? '' : 's'} recorded</p>
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
      </section>
      <Codex world={world} discovered={discoveredLore} />
      <details className="notes">
        <summary>World dossier · generation details</summary>
        <p className="muted">{world.themeSummary}</p>
        <p className="muted">
          Prepared in {Math.round(world.provenance.durationMs)} ms · {world.provenance.attempts} model call{world.provenance.attempts === 1 ? '' : 's'}
        </p>
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
      </details>
    </div>
  );
}
