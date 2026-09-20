import { useState, useSyncExternalStore } from 'react';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import { headquartersRecords, headquartersStation } from '../../shared/headquarters';
import { ABILITY_DETAILS, CLASS_ABILITIES, CLASS_IDS, CLASS_INFO, CLASS_THEME, ENEMY_INFO, type AbilityId, type ClassId, type EnemyId } from '../../shared/registry';
import type { UiActions, UiModel } from '../../shared/ui';
import { renderCue, type HubCueContext } from '../chronicle/hubCues';
import { HUB_SHELF_BRACKETS, hubStateBus, shelfRelics, type ClassRecord, type HubState, type HubStateBus } from '../chronicle/hubState';
import { CrewStrip, gateFromPlayers, gateReadout } from './HeadquartersCrew';
import { departureBus, HeadquartersDeparture, isDeparting, useDeparture, type DepartureBus } from './HeadquartersDeparture';
import '../styles/headquarters.css';

const DEVICE_LOCAL_FOOTER = 'Counts reflect events recorded on this browser. They are not lifetime totals.';

function useHubState(bus: HubStateBus): HubState {
  return useSyncExternalStore(bus.subscribe, bus.get, bus.get);
}

function sourceLabel(source: string): string {
  return source === 'live' ? 'Live generation' : source === 'live_fallback_fixture' ? 'Fallback fixture' : 'Offline fixture';
}

function topKey<K extends string>(counts: Readonly<Record<string, number>>): K | null {
  let best: string | null = null;
  for (const [key, count] of Object.entries(counts)) {
    if (count > 0 && (best === null || count > counts[best]! || (count === counts[best]! && key < best))) best = key;
  }
  return best as K | null;
}

export function HeadquartersPrompt({ model, actions, departure = departureBus }: { model: UiModel; actions: UiActions; departure?: DepartureBus }) {
  const station = headquartersStation(model.headquarters?.nearbyStationId);
  const departing = isDeparting(useDeparture(departure));
  const busy = departing || model.phase === 'preparing' || ['queued', 'generating', 'validating'].includes(model.generation.phase);
  return (
    <>
    <HeadquartersDeparture bus={departure} />
    {model.connection.mode === 'remote' && <CrewStrip players={model.players} />}
    <div className="hq-wayfinder">
      <span className="hq-wayfinder__place">THE STILLPOINT <span>Headquarters</span></span>
      {station ? (
        <button type="button" className="hq-prompt" onClick={actions.activateHeadquartersStation} disabled={busy || model.connection.status !== 'connected'}>
          <kbd>F</kbd><span><strong>{station.name}</strong><small>{departing ? 'The gate is opening' : busy ? 'World preparation in progress' : station.action}</small></span>
        </button>
      ) : (
        <p className="hq-wayfinder__hint">WASD / arrows to walk · approach a station · F to interact</p>
      )}
    </div>
    </>
  );
}

export function HeadquartersStationPanel({ model, actions, hub = hubStateBus, departure = departureBus }: { model: UiModel; actions: UiActions; hub?: HubStateBus; departure?: DepartureBus }) {
  const station = headquartersStation(model.headquarters?.activeStationId);
  const hubState = useHubState(hub);
  const departing = isDeparting(useDeparture(departure));
  const gate = gateFromPlayers(model.players);
  const [recordsTab, setRecordsTab] = useState<ClassId | null>(null);
  if (!station) return null;
  const classId = station.classId;
  const records = headquartersRecords(model.memories);
  const busy = model.phase === 'preparing' || ['queued', 'generating', 'validating'].includes(model.generation.phase);
  const ready = model.connection.status === 'connected' && !busy && !departing;
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
          <p className="hq-status" role="status">{model.localPlayer.classId === classId ? `CURRENT · ${CLASS_THEME[classId].weapon}` : `Carrying · ${CLASS_THEME[model.localPlayer.classId].weapon}`}</p>
          {model.localPlayer.classId !== classId && <button type="button" className="btn" disabled={!ready} onClick={actions.activateHeadquartersStation}>{station.action}</button>}
          <p>{CLASS_INFO[classId].role}</p>
          <dl className="hq-abilities">
            {(['q', 'e', 'r'] as const).map((key) => {
              const ability = ABILITY_DETAILS[abilities[key]];
              return <div key={key}><dt><kbd>{key.toUpperCase()}</kbd> {ability.name}</dt><dd>{ability.description}<span>{ability.stats}</span></dd></div>;
            })}
          </dl>
          <p className="hint">E {model.localPlayer.classId === classId && model.hud?.abilityEUnlocked ? 'unlocked' : `unlocks for ${ABILITY_UNLOCK_COST} resources`}. R charges in combat. Swap weapons here at no cost.</p>
          {model.localPlayer.classId === classId && !model.hud?.abilityEUnlocked && actions.unlockAbility && (
            <button type="button" className="btn" disabled={!ready || (model.hud?.resources ?? 0) < ABILITY_UNLOCK_COST} onClick={actions.unlockAbility}>
              Unlock E · {model.hud?.resources ?? 0}/{ABILITY_UNLOCK_COST} resources
            </button>
          )}
        </>
      )}
      {station.id === 'archive' && (
        <>
          <p className="hq-status">Device-local records</p>
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
          <h3 className="eyebrow">Latest records</h3>
          {latest.length === 0 ? <p className="muted">No records yet. The first one is saved when a world is prepared.</p> : (
            <ul className="hq-echoes">{latest.map((memory) => (
              <li key={memory.id}><strong>{memory.title}</strong><p>{memory.summary}</p><small>{memory.worldTitle} · {memory.provenanceSource === 'live' ? 'Live generation' : memory.provenanceSource === 'live_fallback_fixture' ? 'Fallback fixture' : 'Offline fixture'}</small></li>
            ))}</ul>
          )}
        </>
      )}
      {station.id === 'quartermaster' && <QuartermasterPanel model={model} hub={hubState} />}
      {station.id === 'records' && <RecordsPanel hub={hubState} tab={recordsTab ?? model.localPlayer.classId} onTab={setRecordsTab} />}
      {station.id === 'relics' && <RelicsPanel hub={hubState} />}
      {station.id === 'observatory' && (
        <>
          <p className="hq-status">{model.contributions.length} / 24 signals collected</p>
          <p className="hint">The contribution console below remains available anywhere in headquarters. Add an idea, then prepare a world.</p>
          <button type="button" className="btn" onClick={() => document.getElementById('contribution')?.focus()} disabled={!ready}>Write an idea</button>
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
          <p className="hq-status">{model.world?.title ?? 'No world prepared'}</p>
          <p className="hint">{departing ? 'The gate is opening. F or Esc leaves now.' : model.world ? 'Walk into the gate or enter here when the crew is ready.' : 'Contribute an idea in the console below and prepare a world first.'}</p>
          {!gate.solo && <p className="hq-status" role="status">{gateReadout(gate)}{gate.all ? '' : ' · everyone stands at the gate before it opens'}</p>}
          <button type="button" className="btn btn--primary" onClick={() => departure.begin(actions.enterPortal)} disabled={!ready || !model.world || !host || !gate.all}>{departing ? 'Departing…' : 'Enter portal'}</button>
          {!host && <p className="hint">The crew leader opens the gate for everyone.</p>}
        </>
      )}
    </section>
  );
}

function QuartermasterPanel({ model, hub }: { model: UiModel; hub: HubState }) {
  const ctx: HubCueContext = {
    lastRun: hub.lastRun,
    records: hub.records,
    totals: hub.totals,
    session: {
      classId: model.localPlayer.classId,
      classChangedSinceLastRun: hub.lastRun !== null && hub.lastRun.classId !== model.localPlayer.classId,
      worldPrepared: model.world !== null,
      crewSize: Math.max(1, model.players?.length ?? 1),
    },
  };
  const cue = renderCue(ctx);
  const run = hub.lastRun;
  return (
    <>
      <blockquote className="hq-speech">{cue ? cue.lines.map((line) => <p key={line}>{line}</p>) : <p>…</p>}</blockquote>
      {run ? (
        <dl className="hq-records hq-records--compact">
          {[
            ['Last world', run.worldTitle],
            ['Outcome', run.outcome],
            ['Weapon', CLASS_THEME[run.classId].weapon],
            ['Deepest room', String(run.deepestRoomIndex + 1)],
            ['Deepest tier', run.deepestTier >= 0 ? String(run.deepestTier + 1) : '—'],
            ['Biomes cleared', String(run.biomesCleared)],
            ['Times downed', String(run.downs)],
            ['Crew', run.crew.map((member) => member.displayName).join(', ') || '—'],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      ) : <p className="muted">No expedition has been recorded on this browser yet.</p>}
      <p className="hint hq-evidence">{cue?.evidence ?? 'from: nothing recorded'}</p>
      <p className="hint">Lines derive only from events recorded on this browser. {DEVICE_LOCAL_FOOTER}</p>
    </>
  );
}

function RecordsPanel({ hub, tab, onTab }: { hub: HubState; tab: ClassId; onTab: (classId: ClassId) => void }) {
  const record: ClassRecord = hub.records[tab];
  const ability = topKey<AbilityId>(record.abilityUseCounts);
  const nemesis = topKey<EnemyId>(record.nemesisCounts);
  const rows: [string, string][] = [
    ['Expeditions', String(record.runs)],
    ['Anchored', String(record.anchors)],
    ['Collapsed', String(record.collapses)],
    ['Deepest room', record.runs > 0 ? String(record.deepestRoomIndex + 1) : '—'],
    ['Deepest tier', record.deepestTier >= 0 ? String(record.deepestTier + 1) : '—'],
    ['Biomes cleared', String(record.biomesCleared)],
    ['Rooms cleared', String(record.roomsCleared)],
    ['Hostiles down', String(record.enemiesDefeated)],
    ['Damage dealt', String(Math.round(record.damageDealt))],
    ['Damage taken', String(Math.round(record.damageTaken))],
    ['Times downed', String(record.timesDowned)],
    ['Picked up', String(record.revivesReceived)],
    ['Picked up others', String(record.revivesGiven)],
    ['Fragments read', String(record.loreRead)],
  ];
  if (ability) rows.push(['Most used ability', `${ability in ABILITY_DETAILS ? ABILITY_DETAILS[ability].name : ability} ×${record.abilityUseCounts[ability]}`]);
  if (nemesis) rows.push(['Nemesis', `${nemesis in ENEMY_INFO ? ENEMY_INFO[nemesis].name : nemesis} ×${record.nemesisCounts[nemesis]}`]);
  return (
    <>
      <div className="hq-tabs" role="tablist" aria-label="Weapon records">
        {CLASS_IDS.map((id) => (
          <button
            key={id} type="button" role="tab" aria-selected={id === tab} className={`hq-tab${id === tab ? ' hq-tab--active' : ''}${hub.records[id].runs === 0 ? ' hq-tab--unlit' : ''}`}
            style={{ ['--station-color' as string]: CLASS_THEME[id].primary }} onClick={() => onTab(id)}
          >
            {CLASS_INFO[id].name}
          </button>
        ))}
      </div>
      {record.runs === 0 ? (
        <p className="muted">No expedition recorded with the {CLASS_THEME[tab].weapon.toLowerCase()} on this browser.</p>
      ) : (
        <dl className="hq-records hq-records--compact">
          {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      <p className="hint">{DEVICE_LOCAL_FOOTER}</p>
    </>
  );
}

function RelicsPanel({ hub }: { hub: HubState }) {
  const shelf = shelfRelics(hub);
  return (
    <>
      <p className="hq-status">{hub.totals.relics} recovered · {shelf.length} of {HUB_SHELF_BRACKETS} brackets filled</p>
      {shelf.length === 0 ? (
        <p className="muted">Empty brackets. A relic is shelved when a fragment marked relic is read and the run ends anchored.</p>
      ) : (
        <ul className="hq-echoes hq-shelf">
          {shelf.map((relic) => (
            <li key={relic.id}>
              <strong>{relic.title}</strong>
              <p>{relic.text}</p>
              <small>{relic.worldTitle} · {sourceLabel(relic.worldSource)} · recovered by {relic.recoveredBy.map((member) => member.displayName).join(', ') || 'unknown'}</small>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Relics derive from lore_discovered events with kind relic, kept only when run_ended reports anchored. {DEVICE_LOCAL_FOOTER}</p>
    </>
  );
}
