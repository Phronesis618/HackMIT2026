import type { UiActions, UiModel } from '../../shared/ui';
import { ABILITY_STATUS, CLASS_INFO } from '../../shared/registry';

/** Expedition HUD. Reads UiModel.hud/room; the only action is returning to HQ. */
export function Hud({ model, actions }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  const room = model.room;
  if (!hud || !room) return null;
  const hp = Math.max(0, Math.min(hud.maxHp, hud.hp));
  const hpPct = (hp / hud.maxHp) * 100;
  const down = hud.state === 'down';
  const critical = !down && hpPct <= 25;
  return (
    <div className={`panel panel--hud ${down || critical ? 'panel--danger' : ''}`}>
      <p className="eyebrow">{CLASS_INFO[model.localPlayer.classId].name} · Expedition {room.index + 1}</p>
      <div className="panel__row">
        <h2 className="panel__title">
          Room {room.index + 1} · {room.name}
        </h2>
        {room.isFinal && <span className="badge badge--fixture">ANCHOR ROOM</span>}
      </div>
      <p className="muted">{room.description}</p>
      {(down || critical) && (
        <p className="combat-status" role="status">
          {down ? 'Operative down. Return to headquarters to regroup.' : 'Integrity critical. Watch your next move.'}
        </p>
      )}

      <div className={`meter ${down || critical ? 'meter--danger' : ''}`}>
        <div className="meter__label">
          <span>Integrity</span>
          <span>
            {Math.round(hp)}/{hud.maxHp}
          </span>
        </div>
        <div className="meter__bar" role="meter" aria-label="Integrity" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={hud.maxHp}>
          <div className="meter__fill" style={{ width: `${hpPct}%` }} />
        </div>
      </div>

      <div className="abilities">
        <div className={`ability ${!down && hud.dashReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">Shift</span>
          <span>{down ? 'unavailable' : `Dash${hud.dashReady ? '' : ` ${(hud.dashCooldownMs / 1000).toFixed(1)}s`}`}</span>
        </div>
        <div className={`ability ${!down && hud.attackReady ? 'ability--ready' : ''}`}>
          <span className="ability__key">J</span>
          <span>{down ? 'unavailable' : hud.attackReady ? 'Attack' : 'recovering'}</span>
        </div>
        <div className="ability ability--planned">
          <span className="ability__key">Q</span>
          <span>planned</span>
        </div>
        <div className="ability ability--planned">
          <span className="ability__key">E</span>
          <span>unlock planned</span>
        </div>
      </div>

      <p className="muted">
        State: <strong>{hud.state}</strong> · Hostiles: {hud.enemiesRemaining} · Players: {model.players.length}
      </p>
      {!down && <p className="hint">WASD / arrows to move · mouse to aim · J / click to attack · Shift / Space to dash. Walk into a glowing exit to move on.</p>}
      {ABILITY_STATUS.attack === 'partial' && <p className="hint">Combat damage is still in development.</p>}
      <button type="button" className="btn" onClick={actions.returnToHeadquarters}>
        Return to headquarters
      </button>
    </div>
  );
}
