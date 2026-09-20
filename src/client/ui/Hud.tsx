import type { UiActions, UiModel } from '../../shared/ui';
import { anchorInstruction } from '../../shared/finale';
import { CLASS_INFO, CLASS_THEME } from '../../shared/registry';

/**
 * In-the-moment prompts only, overlaid on the canvas. Everything explanatory (abilities,
 * lore, crew, world) lives in the Tab menu; live status (Integrity, cooldowns) is drawn
 * in-world and on the command bar. This strip should be empty most of the time.
 */
export function Hud({ model }: { model: UiModel; actions: UiActions }) {
  const hud = model.hud;
  if (!hud) return null;
  const hp = Math.max(0, Math.min(hud.maxHp, hud.hp));
  const down = hud.state === 'down';
  const critical = !down && hp / hud.maxHp <= 0.25;
  const anchor = hud.anchor;
  const anchorPrompt = !anchor ? null
    : hud.enemiesRemaining > 0 ? null : anchorInstruction(anchor, hud.roomCleared === true);
  return (
    <div className="hud-strip" aria-live="polite">
      {/* The visible Integrity readout is HudVitals on the command bar; this stays for screen readers. */}
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

/**
 * Reserved minimap container (top of the run rail). Deliberately empty: agent F3 mounts the
 * minimap into `.hud-minimap-slot` (`data-slot="minimap"`). Square, 180–220 px.
 */
export function MinimapSlot() {
  return (
    <div className="hud-minimap-slot" data-slot="minimap" aria-label="Minimap" role="img">
      <span className="hud-minimap-slot__placeholder" aria-hidden="true">Map · no signal</span>
    </div>
  );
}

/** Left cluster of the command bar: who you are and how much Integrity is left, readable at a glance. */
export function HudVitals({ model }: { model: UiModel }) {
  const hud = model.hud;
  const classId = model.localPlayer.classId;
  const maxHp = hud?.maxHp ?? 0;
  const hp = hud ? Math.max(0, Math.min(maxHp, hud.hp)) : 0;
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const down = hud?.state === 'down';
  const tone = down ? 'down' : ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'hurt' : 'ok';
  return (
    <div className={`vitals vitals--${tone}`} aria-hidden="true">
      <div className="vitals__id">
        <span className="vitals__swatch" style={{ background: CLASS_THEME[classId].primary }} />
        <span className="vitals__name">{model.localPlayer.displayName}</span>
        <span className="vitals__class">{CLASS_INFO[classId].name}</span>
      </div>
      <div className="vitals__bar">
        <div className="vitals__fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="vitals__read">
        <span className="vitals__label">{down ? 'Down' : 'Integrity'}</span>
        <span className="vitals__num">{hud ? Math.round(hp) : '—'}<small>/{hud ? maxHp : '—'}</small></span>
      </div>
      <StatusChips model={model} />
    </div>
  );
}

/**
 * A24. The two timed states the simulation applies to an operative, where they can see them:
 * the `clear_surge` haste and a slow. One tiny chip each, only while it is running.
 */
export function StatusChips({ model }: { model: UiModel }) {
  const hud = model.hud;
  const chips = [
    { key: 'quick', label: 'Quickened', ms: hud?.hasteMs ?? 0 },
    { key: 'slow', label: 'Slowed', ms: hud?.slowMs ?? 0 },
  ].filter((chip) => chip.ms > 0);
  if (chips.length === 0) return null;
  return (
    <ul className="vitals__chips">
      {chips.map((chip) => (
        <li key={chip.key} className={`status-chip status-chip--${chip.key}`}>
          <span className="status-chip__label">{chip.label}</span>
          <span className="status-chip__time">{(chip.ms / 1000).toFixed(1)}s</span>
        </li>
      ))}
    </ul>
  );
}

/** Run rail: where you are, what is left to do, who is with you. Secondary information only. */
export function RunStatus({ model }: { model: UiModel }) {
  const hud = model.hud;
  const room = model.room;
  const training = model.phase === 'training';
  // Floors runs count rooms of the current BIOME against its budget; legacy worlds count the
  // world's planned rooms. `plannedRoomCount` is 1 in a floors world, so never show it there.
  const floor = training ? null : model.floor ?? null;
  const planned = model.world?.plannedRoomCount ?? 0;
  const hostiles = hud?.enemiesRemaining ?? 0;
  const cleared = !training && hostiles === 0;
  const anchor = hud?.anchor ?? null;
  return (
    <>
      <div className="rail-top">
        <MinimapSlot />
        <dl className="rail-stats">
          <div className={`rail-stat ${cleared ? 'rail-stat--ok' : 'rail-stat--hostile'}`}>
            <dt>Hostiles</dt>
            <dd>{cleared ? 'Clear' : hostiles}</dd>
          </div>
          {floor && (
            <>
              <div className="rail-stat">
                <dt>Rooms</dt>
                <dd>{floor.roomsVisited}<small>/{floor.roomCount}</small></dd>
              </div>
              <div className="rail-stat">
                <dt>Biome</dt>
                <dd>{floor.depth}<small>/{floor.depthCount}</small></dd>
              </div>
            </>
          )}
          {!floor && !training && room && planned > 0 && (
            <div className="rail-stat">
              <dt>Room</dt>
              <dd>{room.index + 1}<small>/{planned}</small></dd>
            </div>
          )}
          {anchor && (
            <div className="rail-stat rail-stat--lamp">
              <dt>Anchor</dt>
              <dd>{anchor.state === 'planted' ? 'Set' : anchor.state === 'planting' ? `${Math.floor(anchor.progress * 100)}%` : 'Idle'}</dd>
            </div>
          )}
        </dl>
      </div>
      <section className="panel rail-status" aria-label="Expedition status">
        <p className="eyebrow">{training ? 'Training range' : floor ? floor.biomeName : room?.isFinal ? 'Final room' : 'Expedition'}</p>
        <h2 className="panel__title">{room?.name ?? (training ? 'Proving chamber' : 'Unknown room')}</h2>
        {floor && (
          <ol className="rail-progress" aria-label={`Biome ${floor.depth} of ${floor.depthCount}`}>
            {Array.from({ length: floor.depthCount }, (_, i) => (
              <li key={i} className={i < floor.depth - 1 ? 'is-done' : i === floor.depth - 1 ? 'is-here' : ''} />
            ))}
          </ol>
        )}
        {!floor && !training && planned > 0 && room && (
          <ol className="rail-progress" aria-label={`Room ${room.index + 1} of ${planned}`}>
            {Array.from({ length: planned }, (_, i) => (
              <li key={i} className={i < room.index ? 'is-done' : i === room.index ? 'is-here' : ''} />
            ))}
          </ol>
        )}
        <Crew model={model} />
      </section>
    </>
  );
}

export function Crew({ model }: { model: UiModel }) {
  const players = model.players.length > 0 ? model.players : [model.localPlayer];
  return (
    <div className="rail-crew">
      <p className="rail-label">Crew · {players.length}/4</p>
      <ul className="rail-crew__list">
        {players.map((p) => (
          <li key={p.id} className={`rail-crew__row ${p.isLocal ? 'is-local' : ''} ${p.connected === false ? 'is-offline' : ''}`}>
            <span className="vitals__swatch" style={{ background: CLASS_THEME[p.classId].primary }} />
            <span className="rail-crew__name">{p.displayName}</span>
            <span className="rail-crew__class">
              {CLASS_INFO[p.classId].name}{p.isLocal ? ' · you' : ''}{p.connected === false ? ' · offline' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
