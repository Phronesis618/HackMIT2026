/**
 * Party frames: a headshot, name, class and Integrity bar for the local operative (large)
 * and every crewmate (compact), pinned to the top-left of the stage during a run. Vitals
 * come straight from the authoritative snapshot via the UI model; nothing here is derived
 * from guesses.
 */
import { CLASS_THEME, type ClassId } from '../../shared/registry';
import type { UiModel, UiPlayer } from '../../shared/ui';

export function PartyPlate({ model }: { model: UiModel }) {
  const me = model.players.find((p) => p.isLocal) ?? model.localPlayer;
  const hud = model.hud;
  const crew = model.players.filter((p) => !p.isLocal);
  const hp = hud ? Math.max(0, Math.min(hud.maxHp, hud.hp)) : me.hp ?? 0;
  const maxHp = hud?.maxHp ?? me.maxHp ?? 100;
  const ult = hud?.ultCharge ?? 0;
  return (
    <div className="party" aria-label="Party">
      <PlateRow player={me} hp={hp} maxHp={maxHp} large ult={ult} resources={hud?.resources} down={hud?.state === 'down'} />
      {crew.map((p) => (
        <PlateRow key={p.id} player={p} hp={p.hp ?? 0} maxHp={p.maxHp ?? 100} down={p.state === 'down'} />
      ))}
      {model.phase === 'expedition' && model.world?.laws && model.world.laws.length > 0 && (
        <ul className="rules rules--hud" aria-label="Laws of this world in effect">
          {model.world.laws.map((law) => (
            <li key={law.lawId} className="rules__chip" title={law.effect}><b>{law.name}</b></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlateRow({ player, hp, maxHp, large = false, ult, resources, down }: {
  player: UiPlayer; hp: number; maxHp: number; large?: boolean; ult?: number; resources?: number; down?: boolean;
}) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const tone = down ? 'down' : ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'hurt' : 'ok';
  const theme = CLASS_THEME[player.classId];
  return (
    <div className={`plate ${large ? 'plate--large' : ''} plate--${tone}`} style={{ ['--plate-accent' as string]: theme.primary, ['--plate-soft' as string]: theme.secondary }}>
      <div className="plate__portrait" aria-hidden="true">
        <ClassPortrait classId={player.classId} />
      </div>
      <div className="plate__body">
        <div className="plate__head">
          <span className="plate__name">{player.displayName}</span>
          <span className="plate__class">{theme.title}</span>
        </div>
        <div className="plate__bar" role="meter" aria-label={`${player.displayName} Integrity`} aria-valuenow={Math.round(hp)} aria-valuemin={0} aria-valuemax={maxHp}>
          <span className="plate__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
          <span className="plate__hp">{down ? 'DOWN' : `${Math.round(hp)} / ${maxHp}`}</span>
        </div>
        {large && (
          <div className="plate__sub">
            <span className="plate__ult" title="Ultimate charge">
              <span className="plate__ultfill" style={{ width: `${Math.round(Math.max(0, Math.min(100, ult ?? 0)))}%` }} />
            </span>
            <span className="plate__meta">R {Math.round(ult ?? 0)}%{resources !== undefined ? ` · ◆ ${resources}` : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small original portraits: one silhouette per class, tinted by the class theme. */
export function ClassPortrait({ classId }: { classId: ClassId }) {
  const theme = CLASS_THEME[classId];
  const common = { width: 36, height: 36, viewBox: '0 0 36 36', role: 'img', 'aria-label': theme.title } as const;
  switch (classId) {
    case 'bastion':
      return (
        <svg {...common}>
          <path d="M18 3 L31 8 V18 C31 26 25 31 18 34 C11 31 5 26 5 18 V8 Z" fill="#0b1220" stroke={theme.primary} strokeWidth="1.6" />
          <path d="M10 15 H26 V19 C26 24 22 27 18 28 C14 27 10 24 10 19 Z" fill={theme.primary} opacity="0.25" />
          <rect x="11" y="16" width="14" height="3" fill={theme.primary} />
          <path d="M14 10 Q18 7 22 10" stroke={theme.secondary} strokeWidth="1.4" fill="none" />
        </svg>
      );
    case 'shade':
      return (
        <svg {...common}>
          <path d="M18 4 C9 4 6 14 6 22 L9 32 L18 28 L27 32 L30 22 C30 14 27 4 18 4 Z" fill="#0b0a18" stroke={theme.primary} strokeWidth="1.6" />
          <path d="M12 21 L15 19 L17 22 Z" fill={theme.secondary} />
          <path d="M24 21 L21 19 L19 22 Z" fill={theme.secondary} />
          <path d="M10 12 Q18 9 26 12" stroke={theme.primary} strokeWidth="1.2" fill="none" opacity="0.7" />
        </svg>
      );
    case 'beacon':
      return (
        <svg {...common}>
          <circle cx="18" cy="18" r="13" fill="none" stroke={theme.primary} strokeWidth="1.2" opacity="0.5" strokeDasharray="3 3" />
          <circle cx="18" cy="19" r="8" fill="#1a1408" stroke={theme.primary} strokeWidth="1.6" />
          <circle cx="18" cy="19" r="3" fill={theme.secondary} />
          <path d="M18 2 V6 M18 30 V34 M2 18 H6 M30 18 H34 M6.7 6.7 L9.5 9.5 M26.5 26.5 L29.3 29.3 M29.3 6.7 L26.5 9.5 M9.5 26.5 L6.7 29.3" stroke={theme.primary} strokeWidth="1.4" />
        </svg>
      );
    case 'weaver':
      return (
        <svg {...common}>
          <path d="M8 12 L18 6 L28 12 V24 L18 30 L8 24 Z" fill="#071410" stroke={theme.primary} strokeWidth="1.6" />
          <path d="M8 12 L28 24 M28 12 L8 24 M18 6 V30" stroke={theme.secondary} strokeWidth="1" opacity="0.6" />
          <circle cx="18" cy="18" r="3.5" fill={theme.primary} />
          <circle cx="11" cy="14" r="1.2" fill={theme.secondary} />
          <circle cx="25" cy="22" r="1.2" fill={theme.secondary} />
        </svg>
      );
  }
}
