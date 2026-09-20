import type { UiActions, UiModel } from '../../shared/ui';

/**
 * In-the-moment prompts only, overlaid on the canvas. Everything explanatory (abilities,
 * lore, crew, world) lives in the Tab menu; live status (Integrity, cooldowns) is drawn
 * in-world and on the ability bar. This strip should be empty most of the time.
 */
export function Hud({ model }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  if (!hud) return null;
  const hp = Math.max(0, Math.min(hud.maxHp, hud.hp));
  const down = hud.state === 'down';
  const critical = !down && hp / hud.maxHp <= 0.25;
  const anchor = hud.anchor;
  const anchorPrompt = !anchor ? null
    : anchor.state === 'planted' ? 'Anchor secured'
      : hud.enemiesRemaining > 0 ? null
        : anchor.state === 'planting' ? `Planting Anchor · ${Math.floor(anchor.progress * 100)}%`
          : 'Hold F at the Anchor to secure this world';
  return (
    <div className="hud-strip" aria-live="polite">
      {/* Visible Integrity bar lives in-world, above the room (RoomScene); this stays for screen readers. */}
      <div className="sr-only" role="meter" aria-label="Integrity" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={hud.maxHp}>
        Integrity {Math.round(hp)}/{hud.maxHp}
      </div>
      {down && (
        <p className="combat-status" role="status">
          Operative down · a teammate can hold F beside you to revive{hud.reviveProgress ? ` · ${Math.floor(hud.reviveProgress * 100)}%` : ''}
        </p>
      )}
      {critical && <p className="combat-status" role="status">Integrity critical</p>}
      {anchorPrompt && <p className="combat-status combat-status--calm" role="status">{anchorPrompt}</p>}
    </div>
  );
}
