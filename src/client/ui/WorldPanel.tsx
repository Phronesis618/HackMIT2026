import { ENEMY_INFO } from '../../shared/registry';
import type { UiFloor, UiWorldSummary } from '../../shared/ui';
import { floorLocationLabel } from './Hud';
import { openMenu } from './MemoryWall';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * Codex: what the crew has actually found, nothing more. Fragments are authored by the
 * world and only unlock through play — reading a relic in a room, or defeating an enemy
 * kind for the first time. An undiscovered entry says so in plain words and names its kind,
 * so the row reads as a locked slot rather than a riddle, and never tells what the rooms hold.
 */
export function Codex({ world, discovered }: { world: UiWorldSummary; discovered: number[] }) {
  if (world.lore.length === 0) return null;
  const found = new Set(discovered);
  const relics = world.lore.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === 'relic');
  const remains = world.lore.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === 'remains');
  const entry = ({ f, i }: { f: UiWorldSummary['lore'][number]; i: number }) => {
    const known = found.has(i);
    // The title already says the row is locked, so the second line only says where to look.
    const hint = f.kind === 'relic'
      ? `Room ${f.roomIndex + 1}`
      : `${f.enemyId ? ENEMY_INFO[f.enemyId].name : 'A hostile'} drops it`;
    return (
      <li key={i} className={`codex__entry ${known ? 'codex__entry--found' : ''}`}>
        <span className="codex__title">{known ? f.title : `Not found yet · ${f.kind === 'relic' ? 'relic' : 'remains'}`}</span>
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

/** Exported so a test can lint it: the one line that keeps derived laws honestly labelled. */
export const DERIVED_LAWS_DISCLOSURE =
  'No model wrote laws for this world. The engine picked these from its motifs and named them.';

/**
 * World laws: the world's own name for each rule beside the engine's plain effect. The name and
 * line are the world's; the effect sentence is trusted code and carries the real numbers, so a
 * law is announced before the portal and never discovered by dying to it.
 *
 * When no model wrote laws the engine picks two from the world's motifs. Those names and lines
 * are the engine's, and the panel says so rather than passing them off as the world's writing.
 */
export function WorldLaws({ world }: { world: UiWorldSummary }) {
  // Honesty: a law the engine does not apply is not listed at all. Fixtures, derivation and the
  // live prompt are already filtered to implemented laws; this is the last guard for an old world.
  const laws = (world.laws ?? []).filter((law) => law.active);
  if (laws.length === 0) return null;
  return (
    <section aria-label="World laws">
      <p className="eyebrow">Laws of this world · {laws.length}{world.lawsDerived ? ' · engine-chosen' : ''}</p>
      {world.lawsDerived && (
        <p className="receipt__disclosure">{DERIVED_LAWS_DISCLOSURE}</p>
      )}
      <ul className="list">
        {laws.map((law) => (
          <li key={law.lawId} className="list__item list__item--used">
            <span className="list__who">{law.name}</span>
            {world.lawsDerived && <em className="derived-stamp">Engine-chosen</em>}{' '}{law.effect}
            <div className="list__meta">{law.description}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Names of the laws this world actually runs under, for the one-line rail. */
function activeLawNames(world: UiWorldSummary): string[] {
  return (world.laws ?? []).filter((law) => law.active).map((law) => law.name);
}

/** Creation receipt: shown immediately after a world is prepared. Honest by construction. */
export function WorldPanel(
  { world, discoveredLore = [], compact = false, floor = null }:
  { world: UiWorldSummary; discoveredLore?: number[]; compact?: boolean; floor?: UiFloor | null },
) {
  const r = world.receipt;
  // A25. A floors world commits one room list per biome, so `plannedRoomCount` is 1 there and
  // "1/1 rooms" said nothing. Count the current biome's rooms instead; legacy worlds unchanged.
  const rooms = floor ? floorLocationLabel(floor) : `${world.committedRoomCount}/${world.plannedRoomCount} rooms`;
  // In a run the rail only identifies the world; the Codex and receipt are one Tab away.
  if (compact) {
    return (
      <button type="button" className="panel panel--world world-brief" onClick={() => openMenu('codex')} aria-label={`${world.title}. Open codex.`}>
        <span className="eyebrow">World</span>
        <span className="world-brief__title">{world.title}</span>
        <span className="tagline">{world.tagline}</span>
        <span className="world-brief__foot">
          {/* Sign-off: the full "biome 1/5 · room 1 of 10" never fit beside the Codex link and
              ended in an ellipsis. The room count is on the tile above; keep the short half. */}
          <span className="world-brief__facts">{floor ? `biome ${floor.depth} of ${floor.depthCount}` : rooms}</span>
          <span className="world-brief__codex">Codex {new Set(discoveredLore).size}/{world.lore.length} ›</span>
          {/* The law names get their own row: run together with the room count they wrapped
              into three ragged lines around the Codex link. A derived name carries the
              engine-chosen stamp here too, not only inside the dossier's note. */}
          {activeLawNames(world).length > 0 && (
            <span className="world-brief__laws">
              {/* Each name is unbreakable and carries its own trailing dot, so a wrapped row
                  never opens on a separator or splits a law's name in two. */}
              <span>
                {activeLawNames(world).map((name, i, all) => (
                  <span key={name} className="world-brief__law">{name}{i < all.length - 1 ? ' · ' : ''}</span>
                ))}
              </span>
              {world.lawsDerived && <em className="derived-stamp">Engine-chosen</em>}
            </span>
          )}
        </span>
      </button>
    );
  }
  return (
    <div className="panel panel--world">
      {/* Sign-off: "… rooms ready" ran the eyebrow onto a second line in the 294 px debrief
          rail, which left the stamp's marker floating between the two. The count says it. */}
      <p className="eyebrow">World dossier · {rooms}</p>
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
      <WorldLaws world={world} />
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
