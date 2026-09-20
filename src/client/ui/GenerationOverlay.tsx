/**
 * The world-forming moment. Covers the stage while a world is being requested and then
 * reveals what was made: title, tagline, palette, rooms, and how many of the crew's ideas
 * shaped it. Purely presentational — every number comes from the model; the only thing it
 * adds is pacing (a short minimum "forming" beat so an instant composer still reads as an
 * event, and a reveal card that auto-dismisses). Logic lives in generationOverlayState.ts.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { UiActions, UiModel, UiWorldSummary } from '../../shared/ui';
import { dismissOverlay, INITIAL_OVERLAY_STATE, stepOverlay, type OverlayState } from './generationOverlayState';
import { ProvenanceBadge } from './ProvenanceBadge';

const BUSY_PHASES = new Set(['queued', 'generating', 'validating']);

export function GenerationOverlay({ model, actions }: { model: UiModel; actions: UiActions }) {
  const [state, setState] = useState<OverlayState>(INITIAL_OVERLAY_STATE);
  const [, tick] = useState(0);
  const input = {
    busy: model.phase === 'preparing' || BUSY_PHASES.has(model.generation.phase),
    worldId: model.world?.worldId ?? null,
    inRun: model.phase === 'expedition' || model.phase === 'training',
    now: Date.now(),
  };
  const next = stepOverlay(state, input);
  useEffect(() => {
    if (next !== state) setState(next);
  }, [next, state]);
  // While anything is on screen, re-evaluate on a short clock (elapsed timer, beats, timeouts).
  useEffect(() => {
    if (next.kind === 'idle') return;
    const timer = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [next.kind]);

  if (next.kind === 'idle') return null;

  if (next.kind === 'forming') {
    const elapsed = Math.max(model.generation.elapsedMs, input.now - next.since);
    const ideas = model.contributions.slice(0, 8);
    return (
      <div className="forming" role="status" aria-live="polite" data-testid="generation-forming">
        <div className="forming__ring" aria-hidden="true">
          <span className="forming__core" />
        </div>
        <div className="forming__ideas" aria-hidden="true">
          {ideas.map((c, i) => (
            <span
              key={c.id}
              className="forming__idea"
              style={{ animationDelay: `${i * 0.35}s`, ['--angle' as string]: `${(i / Math.max(1, ideas.length)) * 360}deg` } as CSSProperties}
            >
              {c.text}
            </span>
          ))}
        </div>
        <div className="forming__text">
          <div className="forming__eyebrow">Forming world</div>
          <div className="forming__phase">{phaseLabel(model.generation.phase, model.generation.message)}</div>
          <div className="forming__elapsed">{(elapsed / 1000).toFixed(1)} s</div>
        </div>
      </div>
    );
  }

  const world = model.world;
  if (!world || world.worldId !== next.revealedWorldId) return null;
  return (
    <RevealCard
      world={world}
      onEnter={() => { setState(dismissOverlay(next, Date.now())); actions.enterPortal(); }}
      onDismiss={() => setState(dismissOverlay(next, Date.now()))}
    />
  );
}

function phaseLabel(phase: string, message: string): string {
  switch (phase) {
    case 'queued': return 'Gathering the crew\'s ideas…';
    case 'generating': return message || 'Shaping structures, encounters and lore…';
    case 'validating': return 'Validating and compiling rooms…';
    case 'ready':
    case 'fallback': return 'Committing the first room…';
    default: return message || 'Working…';
  }
}

export function RevealCard({ world, onEnter, onDismiss }: { world: UiWorldSummary; onEnter: () => void; onDismiss: () => void }) {
  const palette = world.palette;
  const used = world.receipt.lines.filter((l) => l.used).length;
  const total = world.receipt.lines.length;
  const style = palette
    ? ({ ['--reveal-accent' as string]: palette.accent, ['--reveal-soft' as string]: palette.accentSoft, ['--reveal-bg' as string]: palette.background, ['--reveal-wall' as string]: palette.wall } as CSSProperties)
    : undefined;
  return (
    <div className="reveal" style={style} data-testid="generation-reveal" onClick={onDismiss} role="dialog" aria-label={`World ready: ${world.title}`}>
      <div className="reveal__card" onClick={(e) => e.stopPropagation()}>
        <div className="reveal__eyebrow">
          <span>World formed</span>
          <ProvenanceBadge provenance={world.provenance} compact />
        </div>
        <h2 className="reveal__title">{world.title}</h2>
        <p className="reveal__tagline">{world.tagline}</p>
        {palette && (
          <div className="reveal__swatches" aria-hidden="true">
            {[palette.background, palette.floor, palette.wall, palette.wallEdge, palette.accent, palette.accentSoft, palette.hazard].map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
        )}
        {world.biomes && world.biomes.length > 1 ? (
          <ol className="reveal__biomes">
            {world.biomes.map((biome, i) => (
              <li key={i} style={{ ['--biome-accent' as string]: biome.palette.accent, ['--biome-floor' as string]: biome.palette.floor } as CSSProperties}>
                <span className="reveal__biomeno">{['I', 'II', 'III'][i] ?? i + 1}</span>
                <span className="reveal__biomename">{biome.name}</span>
                <span className="reveal__biomerooms">{biome.roomNames.join(' · ')}</span>
              </li>
            ))}
          </ol>
        ) : world.roomNames && world.roomNames.length > 0 && (
          <ol className="reveal__rooms">
            {world.roomNames.map((name, i) => <li key={i}><span className="reveal__roomno">{i + 1}</span>{name}</li>)}
          </ol>
        )}
        {world.laws && world.laws.length > 0 && (
          <ul className="rules" aria-label="Laws of this world">
            {world.laws.map((law) => (
              <li key={law.lawId} className="rules__chip" title={law.effect}>
                <b>{law.name}</b><span>{law.effect}</span>
              </li>
            ))}
          </ul>
        )}
        {world.provenance.source === 'procedural' && world.receipt.lines[0] && (
          <p className="reveal__inscription">“{world.receipt.lines[0].text}” is cut into the wall of the arrival room, in {world.receipt.lines[0].playerName}'s hand.</p>
        )}
        <p className="reveal__receipt">
          {total > 0
            ? `${used} of ${total} idea${total === 1 ? '' : 's'} shaped this world · ${world.lore.length} lore fragments to find`
            : `${world.lore.length} lore fragments to find`}
          {' · '}{formatDuration(world.provenance.durationMs)}
        </p>
        <div className="reveal__actions">
          <button type="button" className="btn btn--primary" onClick={onEnter}>Enter portal</button>
          <button type="button" className="btn btn--ghost" onClick={onDismiss}>Stay in the sanctuary</button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(1, Math.round(ms))} ms`;
}
