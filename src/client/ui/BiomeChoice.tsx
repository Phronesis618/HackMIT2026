/**
 * Biome choice screen (agent F3). Shown while `floor.biomeChoice` is open and unresolved.
 * Two doors, Dead Cells style; each states checkable facts about the biome behind it.
 *  - Solo / co-op host: 1 or 2, or ← → then Enter, or click.
 *  - Co-op guest: sees the same doors, cannot pick, sees which one the host has marked.
 *  - One option (the finale): a confirm, not a choice.
 * Copy follows docs/WRITING.md: facts, counts, plain verbs.
 */
import { useEffect, useState } from 'react';
import type { UiBiomeChoice, UiBiomeOption } from '../../shared/ui';

export interface BiomeChoiceProps {
  choice: UiBiomeChoice;
  fromBiomeName: string;
  localPlayerId: string;
  onChoose: (biomeId: string) => void;
}

export type ChoiceKeyResult = { choose: string } | { highlight: number } | null;

/** What a key press means on the choice screen. Pure: guests (`canPick` false) always get null. */
export function choiceKeyAction(choice: Pick<UiBiomeChoice, 'canPick' | 'options'>, code: string, highlight: number): ChoiceKeyResult {
  if (!choice.canPick) return null;
  const last = choice.options.length - 1;
  const direct = code === 'Digit1' || code === 'Numpad1' ? 0 : code === 'Digit2' || code === 'Numpad2' ? 1 : -1;
  if (direct >= 0) return choice.options[direct] ? { choose: choice.options[direct].biomeId } : null;
  if (code === 'ArrowLeft') return { highlight: 0 };
  if (code === 'ArrowRight') return { highlight: Math.max(0, last) };
  if (code === 'Enter' || code === 'NumpadEnter') {
    const option = choice.options[Math.min(Math.max(0, highlight), last)];
    return option ? { choose: option.biomeId } : null;
  }
  return null;
}

/** The only path to `onChoose`: refuses guests and ids that are not on offer. */
export function pickBiome(choice: Pick<UiBiomeChoice, 'canPick' | 'options'>, biomeId: string, onChoose: (biomeId: string) => void): boolean {
  if (!choice.canPick || !choice.options.some((option) => option.biomeId === biomeId)) return false;
  onChoose(biomeId);
  return true;
}

function Door({ option, index, choice, highlighted, onHighlight, onChoose }: {
  option: UiBiomeOption;
  index: number;
  choice: UiBiomeChoice;
  highlighted: boolean;
  onHighlight: () => void;
  onChoose: () => void;
}) {
  const voters = choice.votes.filter((vote) => vote.biomeId === option.biomeId);
  const hostPick = choice.hostPlayerId !== null && voters.some((vote) => vote.playerId === choice.hostPlayerId);
  const className = `biome-door${highlighted && choice.canPick ? ' is-highlighted' : ''}${hostPick ? ' is-host-pick' : ''}${choice.canPick ? '' : ' is-locked'}`;
  return (
    <button
      type="button" className={className} disabled={!choice.canPick} onClick={onChoose} onMouseEnter={onHighlight} onFocus={onHighlight}
      data-biome={option.biomeId} aria-label={`${option.name}: ${option.roomCount} rooms. ${option.layout}`}
    >
      <span className="biome-door__arch" aria-hidden="true"><span className="biome-door__key">{choice.confirmOnly ? 'Enter' : index + 1}</span></span>
      <span className="biome-door__depth">Biome {option.depth}/{option.depthCount}{option.depth === option.depthCount ? ' · final' : ''}</span>
      <span className="biome-door__name">{option.name}</span>
      <span className="biome-door__tagline">{option.tagline}</span>
      <dl className="biome-door__facts">
        <div><dt>Rooms</dt><dd>{option.roomCount}</dd></div>
        <div><dt>Layout</dt><dd>{option.layout}</dd></div>
        <div><dt>Hostiles</dt><dd>{option.enemies.join(', ')}</dd></div>
        <div><dt>Built from</dt><dd>{option.motifs.join(', ')}</dd></div>
        <div><dt>Floor hazards</dt><dd className={option.hazards ? 'is-warn' : ''}>{option.hazards ? 'Yes' : 'None'}</dd></div>
      </dl>
      {voters.length > 0 && (
        <span className="biome-door__votes">
          {voters.map((vote) => (
            <span key={vote.playerId} className={vote.playerId === choice.hostPlayerId ? 'is-host' : ''}>
              {vote.displayName}{vote.playerId === choice.hostPlayerId ? ' · host' : ''}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

export function BiomeChoice({ choice, fromBiomeName, onChoose }: BiomeChoiceProps) {
  const [highlight, setHighlight] = useState(0);
  const { canPick, options } = choice;

  useEffect(() => {
    if (!canPick) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      const action = choiceKeyAction(choice, event.code, highlight);
      if (!action) return;
      if ('choose' in action) pickBiome(choice, action.choose, onChoose);
      else setHighlight(action.highlight);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canPick, choice, highlight, onChoose]);

  const hostLabel = choice.hostName ?? 'the host';
  return (
    <div className="biome-choice" role="dialog" aria-label="Choose the next biome">
      <header className="biome-choice__head">
        <p className="biome-choice__from">{fromBiomeName} is clear</p>
        <h2>{choice.confirmOnly ? 'One way on' : 'Two ways on. Pick one.'}</h2>
      </header>
      <div className={`biome-choice__doors${choice.confirmOnly ? ' is-single' : ''}`}>
        {options.map((option, index) => (
          <Door
            key={option.biomeId} option={option} index={index} choice={choice} highlighted={index === Math.min(highlight, options.length - 1)}
            onHighlight={() => setHighlight(index)} onChoose={() => { pickBiome(choice, option.biomeId, onChoose); }}
          />
        ))}
      </div>
      <p className="biome-choice__foot" role="status">
        {canPick
          ? choice.confirmOnly ? 'Enter or click to go in. The crew moves together.' : '1 or 2, or click a door. The crew moves together and cannot come back.'
          : `Waiting for ${hostLabel} to choose. The host's pick moves the whole crew.`}
      </p>
    </div>
  );
}
