/**
 * Expanded floor map (agent F3): shown while M is held, or pinned by clicking the minimap.
 * Same data and same fog rule as the minimap, drawn larger, with a legend and the route so far.
 */
import { useMemo } from 'react';
import type { UiFloor } from '../../shared/ui';
import { BiomeHeader, MapGrid } from './Minimap';
import { buildMinimap } from './floorsModel';

const LEGEND: Array<{ className: string; label: string }> = [
  { className: 'fmap-key--current', label: 'You are here' },
  { className: 'fmap-key--visited', label: 'Visited' },
  { className: 'fmap-key--seen', label: 'Door seen, not entered' },
  { className: 'fmap-key--exit', label: 'Exit gate' },
  { className: 'fmap-key--elite', label: 'Elite pack' },
  { className: 'fmap-key--treasure', label: 'Cache' },
  { className: 'fmap-key--rest', label: 'Rest site · mends the crew once' },
  { className: 'fmap-key--lore', label: 'Relic' },
];

export function FullMap({ floor, onClose }: { floor: UiFloor; onClose: () => void }) {
  const map = useMemo(() => buildMinimap(floor.run), [floor.run]);
  return (
    <div className="fullmap" role="dialog" aria-label={`Floor map of ${floor.biomeName}`} onClick={onClose}>
      <div className="fullmap__panel" onClick={(event) => event.stopPropagation()}>
        <BiomeHeader floor={floor} />
        <p className="fullmap__route">
          {floor.pathNames.map((name, index) => (
            <span key={`${name}-${index}`} className={index === floor.pathNames.length - 1 ? 'is-here' : ''}>{name}</span>
          ))}
        </p>
        <div className="fullmap__grid">
          <MapGrid map={map} size={380} maxPitch={48} label={`Full map of ${floor.biomeName}`} />
        </div>
        <p className="fullmap__count">
          {map.visitedCount} of {floor.roomCount} rooms visited · {map.seenCount} {map.seenCount === 1 ? 'door' : 'doors'} not entered
          {floor.run.doorsLocked ? ' · doors sealed until the room is clear' : ''}
        </p>
        <ul className="fullmap__legend">
          {LEGEND.map((entry) => (
            <li key={entry.className}><i className={`fmap-key ${entry.className}`} aria-hidden="true" />{entry.label}</li>
          ))}
        </ul>
        <p className="fullmap__hint">Release M to close</p>
      </div>
    </div>
  );
}
