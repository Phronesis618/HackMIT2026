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
      <p className={`objective ${hud.roomCleared ? 'objective--done' : ''}`} role="status">
        {hud.objective}
      </p>
      {hud.interactProgress > 0 && (
        <div className="meter meter--interact" aria-label="Interaction progress">
          <div className="meter__bar">
            <div className="meter__fill" style={{ width: `${Math.round(hud.interactProgress * 100)}%` }} />
          </div>
        </div>
      )}
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
        {hud.abilities.map((a) => {
          const status = down && (a.status === 'ready' || a.status === 'cooldown') ? 'unavailable' : a.status;
          return (
            <div key={a.slot} className={`ability ability--${status}`} title={a.name}>
              <span className="ability__key">{a.key}</span>
              <span>
                {status === 'planned'
                  ? 'planned'
                  : status === 'unavailable'
                    ? 'unavailable'
                    : status === 'locked'
                      ? `${a.name} · locked`
                      : status === 'cooldown'
                        ? `${a.name} ${(a.cooldownMs / 1000).toFixed(1)}s`
                        : a.name}
              </span>
            </div>
          );
        })}
      </div>
      {hud.shieldMs > 0 && <p className="muted">Bulwark up · {(hud.shieldMs / 1000).toFixed(1)}s</p>}

      <p className="muted">
        State: <strong>{hud.state}</strong> · Hostiles: {hud.enemiesRemaining} · Shards this run: <strong>{hud.shardsThisRun}</strong> · Rooms cleared:{' '}
        {model.run.roomsCleared} · Players: {model.players.length}
      </p>
      {!down && (
        <p className="hint">
          WASD / arrows to move · mouse to aim · J / click to attack · Shift / Space to dash · Q shield · E tether (unlock at HQ) · hold F at the Anchor.
        </p>
      )}
      {ABILITY_STATUS.attack === 'partial' && <p className="hint">Combat damage is still in development.</p>}
      <button type="button" className="btn" onClick={actions.returnToHeadquarters}>
        Return to headquarters
      </button>
    </div>
  );
}
