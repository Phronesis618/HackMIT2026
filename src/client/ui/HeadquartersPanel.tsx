import { useState } from 'react';
import { CLASS_IDS, CLASS_INFO } from '../../shared/registry';
import type { UiActions, UiModel } from '../../shared/ui';

/**
 * Headquarters: identity, contributions, and the "open the portal" request.
 * Talks only to UiActions; reads only UiModel.
 */
export function HeadquartersPanel({ model, actions }: { model: UiModel; actions: UiActions }) {
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(model.localPlayer.displayName);
  const busy = model.phase === 'preparing';
  const gen = model.generation;
  const worldReady = model.world !== null;

  const submit = (): void => {
    if (!draft.trim()) return;
    actions.submitContribution(draft);
    setDraft('');
  };

  return (
    <div className="panel">
      <h2 className="panel__title">Headquarters</h2>

      <label className="field">
        <span className="field__label">Operative</span>
        <input
          className="input"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && actions.setDisplayName(name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      </label>

      <div className="field">
        <span className="field__label">Class</span>
        <div className="chips">
          {CLASS_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`chip ${model.localPlayer.classId === id ? 'chip--active' : ''}`}
              onClick={() => actions.selectClass(id)}
              title={CLASS_INFO[id].role}
            >
              {CLASS_INFO[id].name}
              <small className={`status status--${model.classStatus[id]}`}>{model.classStatus[id]}</small>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field__label">Your idea for this world</span>
        <textarea
          className="input input--area"
          rows={2}
          maxLength={200}
          placeholder="e.g. a flooded archive where the books still whisper"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn" onClick={submit} disabled={!draft.trim()}>
          Contribute
        </button>
      </label>

      {model.contributions.length > 0 && (
        <ul className="list">
          {model.contributions.map((c) => (
            <li key={c.id} className="list__item">
              <span className="list__who">{c.playerName}</span> {c.text}
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={actions.requestWorld} disabled={busy}>
          {busy ? 'Preparing…' : worldReady ? 'Prepare another world' : 'Prepare world'}
        </button>
        <button type="button" className="btn" onClick={actions.enterPortal} disabled={!worldReady || busy}>
          Enter portal
        </button>
      </div>

      <p className={`status-line status-line--${gen.phase}`}>
        <strong>{gen.phase.toUpperCase()}</strong> {gen.message}
        {gen.phase !== 'idle' && gen.elapsedMs > 0 ? ` (${(gen.elapsedMs / 1000).toFixed(1)}s)` : ''}
      </p>
      {!model.liveGenerationAvailable && (
        <p className="hint">
          Live generation is off on this server (no credentials or fixture mode). Worlds come from a validated offline fixture and are
          labelled as such.
        </p>
      )}
      <p className="hint">
        Move with WASD / arrows. Walk onto the glowing portal at the bottom of the room to enter once a world is ready. Shift/Space to dash,
        J or click to attack (no damage yet).
      </p>
    </div>
  );
}
