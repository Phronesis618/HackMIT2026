import type { UiActions, UiModel } from '../../shared/ui';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import { CLASS_INFO, type ClassId } from '../../shared/registry';

const abilities: Record<ClassId, { q: string; e: string; description: string }> = {
  bastion: { q: 'Bulwark', e: 'Shockwave', description: 'Q guards against damage. E knocks back and stuns nearby hostiles.' },
  shade: { q: 'Blink strike', e: 'Shroud', description: 'Q blinks toward your aim and strikes. E conceals you and empowers your next attack.' },
  beacon: { q: 'Flare', e: 'Rally', description: 'Q damages and marks an aimed area. E heals nearby allies and boosts their pace.' },
  weaver: { q: 'Tether', e: 'Rewind', description: 'Q pulls and slows hostiles. E restores your recent position and lost integrity.' },
};

export function Hud({ model, actions }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  const room = model.room;
  if (!hud || !room) return null;
  const hp = Math.max(0, Math.min(hud.maxHp, hud.hp));
  const down = hud.state === 'down';
  const critical = !down && hp / hud.maxHp <= 0.25;
  const ability = abilities[model.localPlayer.classId];
  const qCooldown = hud.abilityQCooldownMs ?? 0;
  const eCooldown = hud.abilityECooldownMs ?? 0;
  const resources = hud.resources ?? 0;
  const host = model.connection.isHost !== false;
  return (
    <div className={`panel panel--hud ${down || critical ? 'panel--danger' : ''}`}>
      <div className="panel__row">
        <p className="eyebrow">
          {CLASS_INFO[model.localPlayer.classId].name} · Room {room.index + 1}
          {room.isFinal ? ' · Anchor room' : ''}
        </p>
      </div>
      {(down || critical) && (
        <p className="combat-status" role="status">
          {down ? `Operative down. A nearby teammate can hold F to revive you.${hud.reviveProgress ? ` Reviving ${Math.floor(hud.reviveProgress * 100)}%.` : ''}` : 'Integrity critical. Watch your next move.'}
        </p>
      )}
      {/* Visible Integrity bar lives in-world, above the room (RoomScene); this stays for screen readers. */}
      <div className="sr-only" role="meter" aria-label="Integrity" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={hud.maxHp}>
        Integrity {Math.round(hp)}/{hud.maxHp}
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
        <div className={`ability ${!down && qCooldown <= 0 ? 'ability--ready' : ''}`}>
          <span className="ability__key">Q</span>
          <span>{down ? 'unavailable' : qCooldown > 0 ? `${(qCooldown / 1000).toFixed(1)}s` : ability.q}</span>
        </div>
        <div className={`ability ${!down && hud.abilityEUnlocked && eCooldown <= 0 ? 'ability--ready' : ''}`}>
          <span className="ability__key">E</span>
          <span>{down ? 'unavailable' : !hud.abilityEUnlocked ? 'locked' : eCooldown > 0 ? `${(eCooldown / 1000).toFixed(1)}s` : ability.e}</span>
        </div>
      </div>

      <p className="hint">{ability.description}</p>
      <p className="muted">{hud.roomCleared ? 'Room cleared' : 'Clear hostiles to earn resources'} · Resources: {resources}</p>
      {!hud.abilityEUnlocked && (
        <button type="button" className="btn btn--primary" onClick={actions.unlockAbility} disabled={down || resources < ABILITY_UNLOCK_COST || !actions.unlockAbility || model.connection.status !== 'connected'}>
          Unlock {ability.e} · {ABILITY_UNLOCK_COST} resources
        </button>
      )}
      {hud.anchor && (
        <p className="combat-status" role="status">
          {hud.anchor.state === 'planted' ? 'Anchor secured.'
            : hud.enemiesRemaining > 0 ? 'Defeat the Guardian and remaining hostiles to secure the Anchor.'
              : hud.anchor.state === 'planting' ? `Hold F · planting Anchor ${Math.floor(hud.anchor.progress * 100)}%`
                : 'Approach the Anchor and hold F to secure this world.'}
        </p>
      )}
      <button type="button" className="btn" onClick={actions.returnToHeadquarters} disabled={!host || model.connection.status !== 'connected'}>
        Return to headquarters
      </button>
      {!host && <p className="hint">The host returns the crew together.</p>}
    </div>
  );
}
