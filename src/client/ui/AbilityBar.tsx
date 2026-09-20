import { useState } from 'react';
import { ABILITY_DETAILS, CLASS_ABILITIES, CLASS_INFO, CLASS_THEME, ULT_CHARGE_MAX, type AbilityId } from '../../shared/registry';
import { ABILITY_UNLOCK_COST } from '../../shared/conventions';
import type { UiActions, UiModel } from '../../shared/ui';
import { tokens } from '../../shared/tokens';
import { AbilityIcon } from './AbilityIcon';
import { HudVitals } from './Hud';

interface Slot {
  id: AbilityId;
  cooldownMs: number;
  cooldownTotalMs: number;
  state: 'ready' | 'cooldown' | 'locked' | 'charging' | 'unavailable';
  charge?: number; // ultimate 0..100
}

const COOLDOWN_TOTALS: Partial<Record<AbilityId, number>> = {
  dash: 800,
  'bastion.q.bulwark': 6000,
  'bastion.e.shockwave': 8000,
  'shade.q.blink_strike': 4000,
  'shade.e.shroud': 9000,
  'beacon.q.flare': 5000,
  'beacon.e.rally': 10000,
  'weaver.q.tether': 4500,
  'weaver.e.rewind': 10000,
};

/**
 * League-style ability bar: Attack · Dash · Q · E · R with icons, key labels, cooldown
 * sweeps, the ultimate's charge ring, lock state and hover tooltips describing exactly
 * what the simulation does. Reads UiModel only; the only action is unlocking E at HQ.
 */
export function AbilityBar({ model, actions }: { model: UiModel; actions: UiActions }) {
  const [hover, setHover] = useState<AbilityId | null>(null);
  const classId = model.localPlayer.classId;
  const theme = CLASS_THEME[classId];
  const hud = model.hud;
  const down = hud?.state === 'down';
  const atHq = model.phase === 'headquarters' || model.phase === 'preparing';
  const inTraining = model.phase === 'training';
  const abilities = CLASS_ABILITIES[classId];
  const eUnlocked = (hud?.abilityEUnlocked ?? false) || inTraining;
  const ultCharge = hud?.ultCharge ?? 0;

  const slots: Slot[] = [
    { id: 'attack', cooldownMs: 0, cooldownTotalMs: 0, state: down ? 'unavailable' : hud && !hud.attackReady ? 'cooldown' : 'ready' },
    { id: 'dash', cooldownMs: hud?.dashCooldownMs ?? 0, cooldownTotalMs: 800, state: down ? 'unavailable' : (hud?.dashCooldownMs ?? 0) > 0 ? 'cooldown' : 'ready' },
    {
      id: abilities.q,
      cooldownMs: hud?.abilityQCooldownMs ?? 0,
      cooldownTotalMs: COOLDOWN_TOTALS[abilities.q] ?? 5000,
      state: down ? 'unavailable' : (hud?.abilityQCooldownMs ?? 0) > 0 ? 'cooldown' : 'ready',
    },
    {
      id: abilities.e,
      cooldownMs: hud?.abilityECooldownMs ?? 0,
      cooldownTotalMs: COOLDOWN_TOTALS[abilities.e] ?? 8000,
      state: !eUnlocked ? 'locked' : down ? 'unavailable' : (hud?.abilityECooldownMs ?? 0) > 0 ? 'cooldown' : 'ready',
    },
    {
      id: abilities.r,
      cooldownMs: hud?.abilityRCooldownMs ?? 0,
      cooldownTotalMs: 1200,
      charge: ultCharge,
      state: down ? 'unavailable' : ultCharge >= ULT_CHARGE_MAX && (hud?.abilityRCooldownMs ?? 0) === 0 ? 'ready' : 'charging',
    },
  ];

  const canUnlock = atHq && !eUnlocked && (hud?.resources ?? 0) >= ABILITY_UNLOCK_COST;
  const hovered = hover ? ABILITY_DETAILS[hover] : null;

  return (
    <div className="commandbar" style={{ ['--class-color' as string]: theme.primary, ['--class-secondary' as string]: theme.secondary }}>
      <HudVitals model={model} />
      <div className="abilitybar">
        {hovered && (
          <div className="abilitybar__tooltip" role="tooltip">
            <div className="abilitybar__tooltip-head">
              <span className="abilitybar__tooltip-key">{hovered.key}</span>
              <strong>{hovered.name}</strong>
              <span className="muted">· {CLASS_INFO[classId].name}</span>
            </div>
            <p>{hovered.description}</p>
            <p className="abilitybar__tooltip-stats">{hovered.stats}</p>
            {hovered.gate === 'unlock' && !eUnlocked && (
              <p className="abilitybar__tooltip-gate">
                Locked · unlock at headquarters for {ABILITY_UNLOCK_COST} resources{inTraining ? '' : ' (free to try in the Training Range)'}.
              </p>
            )}
            {hovered.gate === 'ultimate' && <p className="abilitybar__tooltip-gate">Ultimate · charges as you deal damage ({Math.round(ultCharge)}%). Fires at 100%.</p>}
          </div>
        )}
        <div className="abilitybar__slots">
          {slots.map((slot, index) => {
            const detail = ABILITY_DETAILS[slot.id];
            const isUlt = detail.gate === 'ultimate';
            const sweep = slot.state === 'cooldown' && slot.cooldownTotalMs > 0 ? Math.min(1, slot.cooldownMs / slot.cooldownTotalMs) : 0;
            const chargePct = isUlt ? Math.min(100, Math.round(slot.charge ?? 0)) : 0;
            const dim = slot.state === 'locked' || slot.state === 'unavailable';
            return (
              <div
                key={slot.id}
                className={`abilityslot abilityslot--${slot.state} ${isUlt ? 'abilityslot--ult' : ''} ${index === 2 ? 'abilityslot--group' : ''}`}
                onMouseEnter={() => setHover(slot.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(slot.id)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${detail.key}: ${detail.name}. ${detail.description}`}
              >
                <div className="abilityslot__frame">
                  <AbilityIcon icon={detail.icon} color={dim ? tokens.color.mist300 : isUlt ? theme.secondary : theme.primary} />
                  {isUlt && slot.state !== 'ready' && <div className="abilityslot__charge" style={{ height: `${100 - chargePct}%` }} />}
                  {sweep > 0 && <div className="abilityslot__sweep" style={{ ['--sweep' as string]: `${sweep * 360}deg` }} />}
                  {sweep > 0 && slot.cooldownMs >= 300 && <span className="abilityslot__timer">{(slot.cooldownMs / 1000).toFixed(1)}</span>}
                  {isUlt && slot.state === 'charging' && <span className="abilityslot__timer abilityslot__timer--charge">{chargePct}<small>%</small></span>}
                  {slot.state === 'locked' && (
                    <svg className="abilityslot__lock" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      <rect x="3.5" y="7" width="9" height="6.5" fill="currentColor" />
                    </svg>
                  )}
                  {slot.state === 'ready' && isUlt && <span className="abilityslot__readyglow" />}
                </div>
                <span className="abilityslot__key">{detail.key}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="commandbar__aside">
        <div className="resource" title="Resources · spent at headquarters to unlock abilities">
          <span className="resource__label">Resources</span>
          <span className="resource__num">{hud?.resources ?? 0}</span>
        </div>
        {atHq && !eUnlocked && actions.unlockAbility && (
          <button type="button" className="btn btn--primary abilityslot__unlock" disabled={!canUnlock} onClick={() => actions.unlockAbility?.()}>
            Unlock E · {ABILITY_UNLOCK_COST}
          </button>
        )}
      </div>
    </div>
  );
}
