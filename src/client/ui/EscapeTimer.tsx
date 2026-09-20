import type { UiModel } from '../../shared/ui';

/**
 * The collapse clock. Large, tenth-of-a-second precision, top centre: the research on timers is
 * that tension comes from the display rather than from a tight clock, so the timer is generous
 * and the readout does the work (docs/design/BOSS_FINALE.md §7.1, §9).
 *
 * Owner: Agent B1.
 */
export function EscapeTimer({ model }: { model: UiModel }) {
  const collapse = model.hud?.collapse;
  if (!collapse) return null;
  if (collapse.stage === 'extraction' || collapse.stage === 'complete') {
    return (
      <div className="escape escape--clear" role="status">
        <span className="escape__label">Clear of the collapse</span>
        <span className="escape__line">Take one thing with you.</span>
      </div>
    );
  }
  if (collapse.stage === 'stranded') {
    return (
      <div className="escape escape--stranded" role="status">
        <span className="escape__label">The Anchor held</span>
        <span className="escape__line">The crew did not get out. The world stands.</span>
      </div>
    );
  }
  const seconds = collapse.remainingMs / 1000;
  const urgent = seconds <= 20;
  const lost = collapse.lostRoomIds.length;
  return (
    <div className={`escape${urgent ? ' escape--urgent' : ''}`} role="status" aria-live="off">
      <span className="escape__label">Get back to the portal</span>
      <span className="escape__clock">{seconds.toFixed(1)}</span>
      <span className="escape__line">
        {lost > 0 ? `${lost} room${lost === 1 ? '' : 's'} gone behind you` : 'Every door is open'}
      </span>
    </div>
  );
}
