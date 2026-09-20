/**
 * FloorsHud (agent F3): the single floors mount point used by App.tsx — minimap, full-map
 * overlay and the biome choice screen. The minimap fills U1's `.hud-minimap-slot` through
 * a portal when that slot exists and falls back to its own corner box when it does not.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UiActions, UiModel } from '../../shared/ui';
import { createHoldKey, FULL_MAP_KEYS } from '../game/input';
import { BiomeChoice } from './BiomeChoice';
import { FullMap } from './FullMap';
import { Minimap } from './Minimap';

/** Finds U1's reserved slot if it is mounted; re-checked on every render of the HUD. */
function useMinimapSlot(dependency: unknown): Element | null {
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    setSlot(typeof document === 'undefined' ? null : document.querySelector('.hud-minimap-slot'));
  }, [dependency]);
  return slot;
}

/** The one floors mount point for App.tsx: minimap, full-map overlay and the biome choice screen. */
export function FloorsHud({ model, actions }: { model: UiModel; actions: UiActions }) {
  const floor = model.phase === 'expedition' ? model.floor ?? null : null;
  const [held, setHeld] = useState(false);
  const [pinned, setPinned] = useState(false);
  const found = useMinimapSlot(`${model.phase}|${floor?.run.biomeId ?? ''}|${floor?.run.roomId ?? ''}`);
  const slot = found?.isConnected ? found : null;
  useEffect(() => createHoldKey(FULL_MAP_KEYS, setHeld), []);
  if (!floor) return null;
  const toggle = (): void => setPinned((value) => !value);
  const mini = (
    <div
      className="fmini-button" role="button" tabIndex={-1} aria-label="Toggle the full floor map" aria-pressed={pinned}
      onClick={toggle}
    >
      <Minimap floor={floor} size={slot ? 180 : 196} />
    </div>
  );
  return (
    <>
      {/* U1's rail slot when it is mounted; otherwise a corner box over the stage (narrow layouts hide the rail). */}
      {slot ? createPortal(mini, slot) : <div className="floors-hud">{mini}</div>}
      {(held || pinned) && !floor.choice && <FullMap floor={floor} onClose={() => setPinned(false)} />}
      {floor.choice && (
        <BiomeChoice choice={floor.choice} fromBiomeName={floor.biomeName} localPlayerId={model.localPlayer.id} onChoose={(biomeId) => actions.chooseBiome?.(biomeId)} />
      )}
    </>
  );
}
