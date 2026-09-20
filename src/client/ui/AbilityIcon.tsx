import type { ReactElement } from 'react';
import type { AbilityIcon as IconId } from '../../shared/registry';

/** Inline SVG glyphs for ability buttons (League-style icons). Colour comes from `color`. */
export function AbilityIcon({ icon, color, size = 30 }: { icon: IconId; color: string; size?: number }) {
  const stroke = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const glow = { stroke: color, strokeWidth: 6, fill: 'none', opacity: 0.25, strokeLinecap: 'round' as const };
  let body: ReactElement;
  switch (icon) {
    case 'blade':
      body = (
        <>
          <path d="M6 26 L24 8 L28 4 L26 10 L10 28 Z" fill={color} opacity={0.9} />
          <path d="M9 21 L13 25" {...stroke} />
        </>
      );
      break;
    case 'twin_blades':
      body = (
        <>
          <path d="M5 27 L20 8 L24 5 L22 11 L9 28 Z" fill={color} opacity={0.9} />
          <path d="M27 27 L12 8 L8 5 L10 11 L23 28 Z" fill={color} opacity={0.6} />
        </>
      );
      break;
    case 'pulse':
      body = (
        <>
          <circle cx="16" cy="16" r="4" fill={color} />
          <circle cx="16" cy="16" r="9" {...stroke} />
          <path d="M16 3 L16 7 M16 25 L16 29 M3 16 L7 16 M25 16 L29 16" {...stroke} />
        </>
      );
      break;
    case 'orb':
      body = (
        <>
          <circle cx="16" cy="16" r="7" fill={color} opacity={0.9} />
          <ellipse cx="16" cy="16" rx="13" ry="5" {...stroke} transform="rotate(-25 16 16)" />
        </>
      );
      break;
    case 'dash':
      body = (
        <>
          <path d="M4 16 L20 16 M9 10 L20 10 M9 22 L20 22" {...stroke} />
          <path d="M18 8 L28 16 L18 24 Z" fill={color} />
        </>
      );
      break;
    case 'shield':
      body = (
        <>
          <path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill={color} opacity={0.25} {...{ stroke: color, strokeWidth: 2 }} />
          <path d="M16 9 V22" {...stroke} />
        </>
      );
      break;
    case 'magnet':
      body = (
        <>
          <path d="M8 6 V17 A8 8 0 0 0 24 17 V6" {...glow} />
          <path d="M8 6 V17 A8 8 0 0 0 24 17 V6" {...stroke} />
          <path d="M6 6 H12 M20 6 H26" {...stroke} />
          <path d="M16 24 V29 M11 27 L9 30 M21 27 L23 30" {...stroke} />
        </>
      );
      break;
    case 'slam':
      body = (
        <>
          <path d="M16 3 L16 15" {...stroke} />
          <path d="M11 9 L16 15 L21 9" {...stroke} />
          <path d="M4 22 C8 18 12 18 16 22 C20 26 24 26 28 22" {...stroke} />
          <path d="M3 28 C8 24 12 24 16 28 C20 32 24 32 29 28" {...stroke} opacity={0.6} />
        </>
      );
      break;
    case 'blink':
      body = (
        <>
          <path d="M5 16 L14 16" {...stroke} opacity={0.5} />
          <path d="M9 10 L15 16 L9 22" {...stroke} opacity={0.5} />
          <path d="M17 8 L26 16 L17 24 L20 16 Z" fill={color} />
        </>
      );
      break;
    case 'shroud':
      body = (
        <>
          <path d="M16 4 C9 4 6 10 6 16 C6 23 10 27 16 29 C22 27 26 23 26 16 C26 10 23 4 16 4 Z" fill={color} opacity={0.25} />
          <path d="M11 15 C13 13 15 13 16 15 M17 15 C18 13 20 13 21 15" {...stroke} />
          <path d="M8 24 C12 20 20 20 24 24" {...stroke} opacity={0.6} />
        </>
      );
      break;
    case 'storm':
      body = (
        <>
          <circle cx="16" cy="16" r="10" {...stroke} strokeDasharray="6 5" />
          <path d="M16 16 L26 8 M16 16 L6 24 M16 16 L24 25 M16 16 L8 7" {...stroke} />
          <circle cx="16" cy="16" r="3" fill={color} />
        </>
      );
      break;
    case 'flare':
      body = (
        <>
          <circle cx="16" cy="16" r="5" fill={color} />
          <path d="M16 2 L16 8 M16 24 L16 30 M2 16 L8 16 M24 16 L30 16 M6 6 L10 10 M22 22 L26 26 M26 6 L22 10 M10 22 L6 26" {...stroke} />
        </>
      );
      break;
    case 'rally':
      body = (
        <>
          <path d="M16 27 C9 22 5 17 5 12 A6 6 0 0 1 16 9 A6 6 0 0 1 27 12 C27 17 23 22 16 27 Z" fill={color} opacity={0.3} {...{ stroke: color, strokeWidth: 2 }} />
          <path d="M16 12 V20 M12 16 H20" {...stroke} />
        </>
      );
      break;
    case 'lance':
      body = (
        <>
          <path d="M3 29 L27 5" {...glow} />
          <path d="M3 29 L27 5" {...stroke} />
          <path d="M27 5 L22 6 M27 5 L26 10" {...stroke} />
          <circle cx="8" cy="24" r="3" fill={color} />
        </>
      );
      break;
    case 'tether':
      body = (
        <>
          <path d="M5 9 C10 9 10 15 15 15 C20 15 20 21 26 21" {...stroke} />
          <circle cx="5" cy="9" r="3" fill={color} />
          <path d="M26 21 L29 26 M26 21 L22 25" {...stroke} />
        </>
      );
      break;
    case 'rewind':
      body = (
        <>
          <path d="M8 16 A8 8 0 1 1 16 24" {...stroke} />
          <path d="M8 16 L4 12 M8 16 L12 12" {...stroke} />
          <path d="M16 11 V16 L19 18" {...stroke} />
        </>
      );
      break;
    case 'singularity':
    default:
      body = (
        <>
          <circle cx="16" cy="16" r="4" fill={color} />
          <path d="M16 4 C22 4 28 10 28 16 M16 28 C10 28 4 22 4 16" {...stroke} />
          <path d="M9 9 C13 13 19 13 23 9 M9 23 C13 19 19 19 23 23" {...stroke} opacity={0.7} />
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {body}
    </svg>
  );
}
