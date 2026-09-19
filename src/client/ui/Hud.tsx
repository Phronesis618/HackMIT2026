import type { UiActions, UiModel } from '../../shared/ui';

/** Expedition HUD. Reads UiModel.hud/room; the only action is returning to HQ. */
export function Hud({ model, actions }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  const room = model.room;
  if (!hud || !room) return null;
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  return (
    <div className="panel panel--hud">
      <div className="panel__row">
        <h2 className="panel__title">
          Room {room.index + 1} · {room.name}
        </h2>
        {room.isFinal && <span className="badge badge--fixture">ANCHOR ROOM</span>}
      </div>
      <p className="muted">{room.description}</p>

      <div className="meter">
        <div className="meter__label">
          <span>Integrity</span>
          <span>
            {Math.round(hud.hp)}/{hud.maxHp}
          </span>
        </div>
        <div className="meter__bar">
          <div className="meter__fill" style={{ width: `${hpPct}%` }} />
        </div>
      </div>

      <div className="abilities">
        <div className={`ability ${hud.dashReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">Shift</span>
          <span>Dash{hud.dashReady ? '' : ` ${(hud.dashCooldownMs / 1000).toFixed(1)}s`}</span>
        </div>
        <div className={`ability ${hud.attackReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">J</span>
          <span>Attack</span>
        </div>
        <div className="ability ability--planned">
          <span className="ability__key">Q</span>
          <span>planned</span>
        </div>
        <div className="ability ability--planned">
          <span className="ability__key">E</span>
          <span>locked</span>
        </div>
      </div>

      <p className="muted">
        State: <strong>{hud.state}</strong> · Hostiles: {hud.enemiesRemaining} · Players: {model.players.length}
      </p>
      <p className="hint">Walk into the glowing exit tile to move on. Enemies stand still and attacks do no damage yet (feat/core slice).</p>
      <button type="button" className="btn" onClick={actions.returnToHeadquarters}>
        Return to headquarters
      </button>
    </div>
  );
}
