import type { UiActions, UiModel } from '../../shared/ui';

/** Expedition HUD. Reads UiModel.hud/room/run; the only action is returning to HQ. */
export function Hud({ model, actions }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  const room = model.room;
  if (!hud || !room) return null;
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const runOver = model.run.status !== 'active' && model.run.status !== 'idle';
  return (
    <div className={`panel panel--hud ${hud.isDown ? 'panel--down' : ''}`}>
      <div className="panel__row">
        <h2 className="panel__title">
          Room {room.index + 1} · {room.name}
        </h2>
        {room.isFinal && <span className="badge badge--fixture">ANCHOR ROOM</span>}
      </div>

      <p className={`objective ${hud.roomCleared ? 'objective--done' : ''}`}>{hud.objective}</p>
      {hud.interactProgress > 0 && (
        <div className="meter meter--interact">
          <div className="meter__bar">
            <div className="meter__fill" style={{ width: `${Math.round(hud.interactProgress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="meter">
        <div className="meter__label">
          <span>{hud.isDown ? 'DOWN' : 'Integrity'}</span>
          <span>
            {Math.round(hud.hp)}/{hud.maxHp}
          </span>
        </div>
        <div className="meter__bar">
          <div className={`meter__fill ${hpPct < 35 ? 'meter__fill--low' : ''}`} style={{ width: `${hpPct}%` }} />
        </div>
      </div>

      <div className="abilities">
        <div className={`ability ${hud.attackReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">J / LMB</span>
          <span>Attack</span>
        </div>
        <div className={`ability ${hud.dashReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">Shift</span>
          <span>Dash{hud.dashReady ? '' : ` ${(hud.dashCooldownMs / 1000).toFixed(1)}s`}</span>
        </div>
        {hud.abilities.map((a) => (
          <div key={a.slot} className={`ability ability--${a.status}`} title={a.name}>
            <span className="ability__key">{a.key}</span>
            <span>
              {a.status === 'planned' ? 'planned' : a.status === 'locked' ? `${a.name} · locked` : a.status === 'cooldown' ? `${a.name} ${(a.cooldownMs / 1000).toFixed(1)}s` : a.name}
            </span>
          </div>
        ))}
      </div>
      {hud.shieldMs > 0 && <p className="muted">Bulwark up · {(hud.shieldMs / 1000).toFixed(1)}s</p>}

      <p className="muted">
        Hostiles: {hud.enemiesRemaining} · Shards this run: <strong>{hud.shardsThisRun}</strong> · Rooms cleared: {model.run.roomsCleared} · Players:{' '}
        {model.players.length}
      </p>
      {runOver ? (
        <p className="hint">Run over ({model.run.status}). Returning to headquarters…</p>
      ) : (
        <p className="hint">WASD move · mouse aim · J/click attack · Shift dash · Q shield · E tether (unlock at HQ) · hold F at the Anchor.</p>
      )}
      <button type="button" className="btn" onClick={actions.returnToHeadquarters}>
        Return to headquarters
      </button>
    </div>
  );
}
