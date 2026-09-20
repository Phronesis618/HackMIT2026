import type { UiActions, UiModel } from '../../shared/ui';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import { CLASS_INFO, ENEMY_IDS, ENEMY_INFO, type ClassId } from '../../shared/registry';
import { ENEMY_LORE } from '../../sim/training';

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
  const hpPct = (hp / hud.maxHp) * 100;
  const down = hud.state === 'down';
  const critical = !down && hpPct <= 25;
  const ability = abilities[model.localPlayer.classId];
  const resources = hud.resources ?? 0;
  const host = model.connection.isHost !== false;
  const training = model.phase === 'training';
  const awake = new Set(hud.training?.awakeEnemyIds ?? []);
  return (
    <div className={`panel panel--hud ${down || critical ? 'panel--danger' : ''}`}>
      <p className="eyebrow">{CLASS_INFO[model.localPlayer.classId].name} · {training ? 'Training Range' : `Expedition ${room.index + 1}`}</p>
      <div className="panel__row">
        <h2 className="panel__title">
          {training ? room.name : `Room ${room.index + 1} · ${room.name}`}
        </h2>
        {room.isFinal && <span className="badge badge--fixture">ANCHOR ROOM</span>}
      </div>
      <p className="muted">{room.description}</p>
      {(down || critical) && (
        <p className="combat-status" role="status">
          {down ? `Operative down. A nearby teammate can hold F to revive you.${hud.reviveProgress ? ` Reviving ${Math.floor(hud.reviveProgress * 100)}%.` : ''}` : 'Integrity critical. Watch your next move.'}
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

      {training && (
        <ul className="training-guide">
          {ENEMY_IDS.map((id) => {
            const active = [...awake].some((awakeId) => awakeId.startsWith(`tr-${id}`));
            return (
              <li key={id} className={`training-guide__row ${active ? 'training-guide__row--active' : ''}`}>
                <span className="training-guide__name">{ENEMY_INFO[id].name}</span>
                <span className="training-guide__attack">{ENEMY_LORE[id].attack}</span>
                <span className="training-guide__tip">{ENEMY_LORE[id].tip}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">
        State: <strong>{hud.state}</strong> · Weapon: {down ? 'unavailable' : hud.attackReady ? 'ready' : 'recovering'} · Hostiles: {hud.enemiesRemaining} ·
        Players: {model.players.length}
        {training ? ' · targets respawn' : ''}
      </p>
      {!down && <p className="hint">WASD / arrows to move · mouse to aim · J / click to attack · Shift / Space to dash. Hold F near a fallen teammate to revive. Clear the room, then walk into a glowing exit to move on.</p>}
      <p className="hint">{ability.description} Hover the ability bar under the canvas for exact numbers.</p>
      {!training && <p className="muted">{hud.roomCleared ? 'Room cleared' : 'Clear hostiles to earn resources'} · Resources: {resources}</p>}
      {!hud.abilityEUnlocked && !training && (
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
