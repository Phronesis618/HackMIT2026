import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import { headquartersRecords, headquartersStation } from '../../shared/headquarters';
import { ABILITY_DETAILS, CLASS_ABILITIES, CLASS_INFO, CLASS_THEME } from '../../shared/registry';
import type { UiActions, UiModel } from '../../shared/ui';
import '../styles/headquarters.css';

export function HeadquartersPrompt({ model, actions }: { model: UiModel; actions: UiActions }) {
  const station = headquartersStation(model.headquarters?.nearbyStationId);
  const busy = model.phase === 'preparing' || ['queued', 'generating', 'validating'].includes(model.generation.phase);
  return (
    <div className="hq-wayfinder">
      <span className="hq-wayfinder__place">THE STILLPOINT <span>Sanctuary / headquarters</span></span>
      {station ? (
        <button type="button" className="hq-prompt" onClick={actions.activateHeadquartersStation} disabled={busy || model.connection.status !== 'connected'}>
          <kbd>F</kbd><span><strong>{station.name}</strong><small>{busy ? 'World preparation in progress' : station.action}</small></span>
        </button>
      ) : (
        <p className="hq-wayfinder__hint">WASD / arrows to walk · approach a station · F to interact</p>
      )}
    </div>
  );
}

export function HeadquartersStationPanel({ model, actions }: { model: UiModel; actions: UiActions }) {
  const station = headquartersStation(model.headquarters?.activeStationId);
  if (!station) return null;
  const classId = station.classId;
  const records = headquartersRecords(model.memories);
  const busy = model.phase === 'preparing' || ['queued', 'generating', 'validating'].includes(model.generation.phase);
  const ready = model.connection.status === 'connected' && !busy;
  const host = model.connection.isHost !== false;
  const latest = [...model.memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const abilities = classId ? CLASS_ABILITIES[classId] : null;

  return (
    <section className="panel hq-station" aria-labelledby="hq-station-title" style={classId ? { ['--station-color' as string]: CLASS_THEME[classId].primary } : undefined}>
      <div className="panel__row">
        <p className="eyebrow">{station.wing}</p>
        <button type="button" className="btn btn--ghost" aria-label="Close station" onClick={actions.closeHeadquartersStation}>Close</button>
      </div>
      <h2 className="panel__title" id="hq-station-title">{station.name}</h2>
      <p className="muted">{station.description}</p>
      {classId && abilities && (
        <>
          <p className="hq-attunement" role="status">{model.localPlayer.classId === classId ? `Attuned · ${CLASS_INFO[classId].name}` : `Current attunement · ${CLASS_INFO[model.localPlayer.classId].name}`}</p>
          {model.localPlayer.classId !== classId && <button type="button" className="btn" disabled={!ready} onClick={actions.activateHeadquartersStation}>{station.action}</button>}
          <p>{CLASS_INFO[classId].role}</p>
          <dl className="hq-abilities">
            {(['q', 'e', 'r'] as const).map((key) => {
              const ability = ABILITY_DETAILS[abilities[key]];
              return <div key={key}><dt><kbd>{key.toUpperCase()}</kbd> {ability.name}</dt><dd>{ability.description}<span>{ability.stats}</span></dd></div>;
            })}
          </dl>
          <p className="hint">E {model.localPlayer.classId === classId && model.hud?.abilityEUnlocked ? 'unlocked' : `unlocks for ${ABILITY_UNLOCK_COST} resources`}. R charges in combat. Your attunement is free to change here.</p>
          {model.localPlayer.classId === classId && !model.hud?.abilityEUnlocked && actions.unlockAbility && (
            <button type="button" className="btn" disabled={!ready || (model.hud?.resources ?? 0) < ABILITY_UNLOCK_COST} onClick={actions.unlockAbility}>
              Unlock E · {model.hud?.resources ?? 0}/{ABILITY_UNLOCK_COST} resources
            </button>
          )}
        </>
      )}
      {station.id === 'archive' && (
        <>
          <p className="hq-attunement">Device-local records</p>
          <p className="hint">Counts reflect saved event-derived memories on this browser. Clearing the Chronicle clears these records. They are not lifetime totals or win counts.</p>
          <dl className="hq-records">
            {[
              ['Saved memories', records.memories],
              ['Worlds with arrivals', records.worldsVisited],
              ['Recorded endings', records.expeditionsEnded],
              ['Anchor memories', records.anchors],
              ['Lore fragments saved', records.lore],
              ['Creation receipts', records.receipts],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <h3 className="eyebrow">Latest echoes</h3>
          {latest.length === 0 ? <p className="muted">The archive is quiet. Enter a world to begin recording your journey.</p> : (
            <ul className="hq-echoes">{latest.map((memory) => (
              <li key={memory.id}><strong>{memory.title}</strong><p>{memory.summary}</p><small>{memory.worldTitle} · {memory.provenanceSource === 'live' ? 'Live generation' : memory.provenanceSource === 'live_fallback_fixture' ? 'Fallback fixture' : 'Offline fixture'}</small></li>
            ))}</ul>
          )}
        </>
      )}
      {station.id === 'observatory' && (
        <>
          <p className="hq-attunement">{model.contributions.length} / 24 signals collected</p>
          <p className="hint">The contribution console below remains available anywhere in headquarters. Add an idea, then prepare a world.</p>
          <button type="button" className="btn" onClick={() => document.getElementById('contribution')?.focus()} disabled={!ready}>Write a world signal</button>
          {model.world && <p className="muted">Charted destination: {model.world.title}</p>}
        </>
      )}
      {station.id === 'training' && (
        <>
          <p className="hint">Practice enemy tells and every ability with E and R unlocked. Training creates no expedition records.</p>
          <button type="button" className="btn btn--primary" onClick={actions.enterTraining} disabled={!ready || model.connection.mode !== 'local' || !actions.enterTraining}>Enter training range</button>
          {model.connection.mode !== 'local' && <p className="hint">The range is available in solo play. Your shared crew stays here.</p>}
        </>
      )}
      {station.id === 'portal' && (
        <>
          <p className="hq-attunement">{model.world?.title ?? 'No destination charted'}</p>
          <p className="hint">{model.world ? 'Walk into the gate or enter here when the crew is ready.' : 'Contribute an idea in the console below and prepare a world first.'}</p>
          <button type="button" className="btn btn--primary" onClick={actions.enterPortal} disabled={!ready || !model.world || !host}>Enter portal</button>
          {!host && <p className="hint">The crew leader opens the gate for everyone.</p>}
        </>
      )}
    </section>
  );
}
