import { useState } from 'react';
import { ABILITY_STATUS, CLASS_IDS, CLASS_INFO } from '../../shared/registry';
import type { UiActions, UiModel } from '../../shared/ui';
import { gateFromPlayers, gateReadout, useGateOverride } from './HeadquartersCrew';
import { departureBus, isDeparting, useDeparture, type DepartureBus } from './HeadquartersDeparture';

/**
 * Headquarters: identity, contributions, and the "open the portal" request.
 * Talks only to UiActions; reads only UiModel.
 */
export function HeadquartersPanel({ model, actions, departure = departureBus }: { model: UiModel; actions: UiActions; departure?: DepartureBus }) {
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(model.localPlayer.displayName);
  const departing = isDeparting(useDeparture(departure));
  const gate = gateFromPlayers(model.players);
  // A seat that never reaches the gate cannot keep the crew at headquarters: the host departs anyway.
  const override = useGateOverride(!gate.all && model.world !== null);
  const gateOpen = gate.all || override;
  const busy =departing || model.phase === 'preparing' || ['queued', 'generating', 'validating'].includes(model.generation.phase);
  const connected = model.connection.status === 'connected';
  const host = model.connection.isHost !== false;
  const gen = model.generation;
  const worldReady = model.world !== null;
  const full = model.contributions.length >= 24;
  const selectedClass = CLASS_INFO[model.localPlayer.classId];

  const submit = (): void => {
    if (!draft.trim() || busy || full) return;
    actions.submitContribution(draft.trim());
    setDraft('');
  };

  return (
    <div className="panel panel--hq">
      <p className="eyebrow">Headquarters</p>
      <h2 className="panel__title">The Stillpoint</h2>
      <p className="muted">Pick a weapon, add an idea for the next world, then take the gate.</p>
      <div className="hq-directory" aria-label="Headquarters directory">
        <span><strong>Northwest · Armory</strong> — four weapon stands</span>
        <span><strong>North · Returns hall</strong> — quartermaster and relic shelf</span>
        <span><strong>Northeast · Archive</strong> — device-local records and class plinths</span>
        <span><strong>Southwest · Training</strong> — practice enemy patterns</span>
        <span><strong>Southeast · Observatory</strong> — shape the next world</span>
        <span><strong>South · Departure gate</strong> — enter your expedition</span>
      </div>
      {model.connection.mode === 'remote' && (
        <div className="generation">
          <p className="eyebrow">Shared crew · {model.players.length}/4</p>
          <p className="muted">{model.players.map((player) => player.displayName).join(' · ')}</p>
          {!gate.solo && <p className="hq-status" role="status">{gateReadout(gate)}{gateOpen && !gate.all ? ' · the gate opens without them' : ''}</p>}
          <p className="hint">{host ? 'You lead this crew. Prepare a world and open the portal once everyone stands at the gate.' : 'Contribute your idea, then stand at the gate. The host opens the portal once the crew is ready.'}</p>
        </div>
      )}
      {!connected && <p className="combat-status" role="status">Server {model.connection.status}. Rejoin co-op to reconnect; solo remains available.</p>}

      <details className="operative">
        <summary>{model.localPlayer.displayName} · {selectedClass.name} · name and weapon</summary>
      <label className="field">
        <span className="field__label">Operative</span>
        <input
          className="input"
          value={name}
          disabled={busy || !connected}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && actions.setDisplayName(name)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      <div className="field">
        <span className="field__label">Weapon · the same choice as the armory stands</span>
        <div className="chips">
          {CLASS_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip ${model.localPlayer.classId === id ? 'chip--active' : ''}`}
              onClick={() => actions.selectClass(id)}
              title={CLASS_INFO[id].role}
              aria-pressed={model.localPlayer.classId === id}
              disabled={busy || !connected}
            >
              {CLASS_INFO[id].name}
              <small className={`status status--${model.classStatus[id]}`}>{model.classStatus[id]}</small>
            </button>
          ))}
        </div>
        <p className="hint">{selectedClass.role} {model.classStatus[model.localPlayer.classId] !== 'implemented' && 'Class abilities are still in development; selecting a class previews its appearance.'}</p>
      </div>
      </details>

      <div className="field">
        <label className="field__label" htmlFor="contribution">Your idea for this world</label>
        <textarea
          id="contribution"
          className="input input--area"
          rows={2}
          maxLength={200}
          placeholder="e.g. a flooded archive where the books still whisper"
          value={draft}
          disabled={busy || full || !connected}
          aria-describedby="contribution-help"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="panel__row">
          <span id="contribution-help" className="hint">{full ? 'All 24 contribution slots are filled.' : `${draft.length}/200 · Enter to contribute`}</span>
          <button type="button" className="btn" onClick={submit} disabled={!draft.trim() || busy || full || !connected}>
            Contribute
          </button>
        </div>
      </div>

      {model.contributions.length > 0 && (
        <ul className="list contributions" aria-label="Contributed ideas">
          {model.contributions.map((c) => (
            <li key={c.id} className="list__item">
              <span className="list__who">{c.playerName}</span> {c.text}
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={actions.requestWorld} disabled={busy || !connected || !host}>
          {busy ? 'Preparing…' : worldReady ? 'Prepare another world' : 'Prepare world'}
        </button>
        <button type="button" className="btn" onClick={() => departure.begin(actions.enterPortal)} disabled={busy || !worldReady || !connected || !host || !gateOpen}>
          {departing ? 'Departing…' : 'Enter portal'}
        </button>
      </div>
      {model.connection.mode === 'local' && actions.enterTraining && (
        <div className="training-entry">
          <button type="button" className="btn btn--training" onClick={() => actions.enterTraining?.()} disabled={busy}>
            Training range
          </button>
          <span className="hint">See every enemy’s attack and try all abilities (E and R unlocked there). No run, no risk.</span>
        </div>
      )}

      <div className={`generation status-line--${gen.phase}`} aria-busy={busy}>
        <div className="panel__row">
          <span className="eyebrow">{busy && <span className="activity" aria-hidden="true" />}{gen.phase}</span>
          {gen.phase !== 'idle' && <span className="generation__time">{(gen.elapsedMs / 1000).toFixed(1)}s</span>}
        </div>
        <p className="muted" role="status">{gen.message}</p>
      </div>
      {!model.liveGenerationAvailable && (
        <p className="hint">
          Live generation is off on this server (no credentials or fixture mode). Worlds come from a validated offline fixture and are
          labelled as such.
        </p>
      )}
      {ABILITY_STATUS.attack === 'partial' && <p className="hint">Attack damage is not implemented yet.</p>}
    </div>
  );
}
