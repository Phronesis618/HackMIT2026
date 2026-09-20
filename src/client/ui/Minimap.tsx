/**
 * Floors minimap (agent F3). Isaac-style grid drawn in SVG from `UiFloor.run.map` only:
 * visited rooms solid, seen-but-unvisited neighbours outlined, the current room lit,
 * kind icons where the sim has revealed the kind, door connectors, and nothing at all
 * for the rest (the slot's background is the fog).
 * Mounted by `FloorsHud`.
 */
import { useMemo } from 'react';
import type { UiFloor } from '../../shared/ui';
import { buildMinimap, minimapPitch, type MinimapCell, type MinimapIcon, type MinimapModel } from './floorsModel';

/** Icon glyphs in a 10×10 box centred on 0,0; scaled to the cell by the caller. */
function IconGlyph({ icon }: { icon: MinimapIcon }) {
  switch (icon) {
    case 'exit': // a gate: two posts and a lintel
      return <path d="M-4 4V-3.5h8V4M-1.6 4V-0.8h3.2V4" fill="none" strokeWidth="1.7" />;
    case 'treasure': // a cut gem
      return <path d="M0 -4.2L4.2 0L0 4.2L-4.2 0Z" strokeWidth="0" />;
    case 'rest': // a medical cross
      return <path d="M-1.4 -4.2h2.8v2.8h2.8v2.8h-2.8v2.8h-2.8v-2.8h-2.8v-2.8h2.8Z" strokeWidth="0" />;
    case 'lore': // a written tablet
      return <path d="M-3.2 -4h6.4v8h-6.4ZM-1.6 -1.6h3.2M-1.6 0.4h3.2M-1.6 2.2h2" fill="none" strokeWidth="1.3" />;
    case 'elite': // a spiked threat mark
      return <path d="M0 -4.6L4.4 3.8H-4.4Z" strokeWidth="0" />;
    case 'shop':
      return <circle r="3.4" fill="none" strokeWidth="1.6" />;
    case 'entrance':
      return <circle r="1.8" strokeWidth="0" />;
  }
}

export interface MapGridProps {
  map: MinimapModel;
  /** Side of the square the grid must fit in, px. */
  size: number;
  /** Largest cell pitch; small floors stop growing here instead of filling the box. */
  maxPitch?: number;
  label?: string;
}

export function MapGrid({ map, size, maxPitch = 30, label }: MapGridProps) {
  const pitch = minimapPitch(map, size, maxPitch);
  const room = pitch * 0.74;
  const width = (map.cols + 1) * pitch;
  const height = (map.rows + 1) * pitch;
  const centre = (index: number): number => (index + 1) * pitch;
  const iconScale = (room * 0.62) / 10;
  const cellClass = (cell: MinimapCell): string =>
    `fmap__room fmap__room--${cell.state}${cell.cleared ? ' is-cleared' : ''}${cell.kind ? ` fmap__room--${cell.kind}` : ''}`;
  return (
    <svg className="fmap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? 'Floor map'}>
      <g className="fmap__links">
        {map.links.map((link) => {
          const x1 = centre(link.from.col);
          const y1 = centre(link.from.row);
          const x2 = centre(link.to.col);
          const y2 = centre(link.to.row);
          // unknown far side: stop halfway, a stub into the fog
          const reach = link.known ? 1 : 0.62;
          return (
            <line
              key={`${link.from.col},${link.from.row},${link.side}`}
              className={`fmap__link${link.known ? '' : ' fmap__link--stub'}`}
              x1={x1} y1={y1} x2={x1 + (x2 - x1) * reach} y2={y1 + (y2 - y1) * reach}
              strokeWidth={Math.max(2, pitch * 0.16)}
            />
          );
        })}
      </g>
      {map.cells.map((cell) => (
        <g key={cell.roomId} className={cellClass(cell)} transform={`translate(${centre(cell.col)} ${centre(cell.row)})`} data-room={cell.roomId} data-state={cell.state}>
          {cell.state === 'current' && <rect className="fmap__halo" x={-room / 2 - 2.5} y={-room / 2 - 2.5} width={room + 5} height={room + 5} rx={3} />}
          <rect className="fmap__box" x={-room / 2} y={-room / 2} width={room} height={room} rx={2} />
          {cell.icon && pitch >= 10 && (
            <g className={`fmap__icon fmap__icon--${cell.icon}`} transform={`scale(${iconScale})`}><IconGlyph icon={cell.icon} /></g>
          )}
        </g>
      ))}
    </svg>
  );
}

export function BiomeHeader({ floor }: { floor: UiFloor }) {
  return (
    <div className="fmap-head">
      <span className="fmap-head__name" title={floor.biomeTagline}>{floor.biomeName}</span>
      <span className="fmap-head__depth">
        <span className="fmap-head__pips" aria-hidden="true">
          {Array.from({ length: floor.depthCount }, (_, index) => (
            <i key={index} className={index + 1 < floor.depth ? 'is-done' : index + 1 === floor.depth ? 'is-here' : ''} />
          ))}
        </span>
        Biome {floor.depth}/{floor.depthCount}
      </span>
    </div>
  );
}

export function Minimap({ floor, size = 196 }: { floor: UiFloor; size?: number }) {
  const map = useMemo(() => buildMinimap(floor.run), [floor.run]);
  return (
    <div className={`fmini${floor.run.doorsLocked ? ' is-locked' : ''}`} style={{ width: size }}>
      <BiomeHeader floor={floor} />
      <div className="fmini__grid" style={{ height: size - 58 }}>
        <MapGrid map={map} size={size - 58} maxPitch={24} label={`Map of ${floor.biomeName}: ${map.visitedCount} rooms visited`} />
      </div>
      <div className="fmini__foot">
        <span>{map.visitedCount}/{floor.roomCount} rooms</span>
        <span>{floor.run.doorsLocked ? 'Sealed' : 'M · map'}</span>
      </div>
    </div>
  );
}
