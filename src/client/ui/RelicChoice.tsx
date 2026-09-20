import type { UiModel } from '../../shared/ui';

/**
 * The extraction: three pedestals, one thing carried out. Every card comes from something the
 * run actually produced — a relic read, remains recovered, or the Custodian's own log — and the
 * choice is made by standing on the pedestal, not by clicking (docs/design/BOSS_FINALE.md §8).
 *
 * Owner: Agent B1. This panel only reports what the simulation already decided.
 */
export function RelicChoice({ model }: { model: UiModel }) {
  const collapse = model.hud?.collapse;
  if (!collapse || (collapse.stage !== 'extraction' && collapse.stage !== 'complete')) return null;
  if (collapse.offer.length === 0) return null;
  const crew = model.players.length;
  return (
    <div className="relic-choice" role="group" aria-label="Carry one thing out">
      <p className="relic-choice__head">
        {collapse.chosenKey === null
          ? crew > 1
            ? 'Stand on a pedestal. Most of the crew on one locks it.'
            : 'Stand on a pedestal to carry it out.'
          : 'Carried out.'}
      </p>
      <ul className="relic-choice__list">
        {collapse.offer.map((card) => {
          const chosen = collapse.chosenKey === card.key;
          const names = card.votes
            .map((id) => model.players.find((player) => player.id === id)?.displayName ?? id);
          return (
            <li
              key={card.key}
              className={`relic-card${chosen ? ' relic-card--chosen' : ''}${names.length > 0 ? ' relic-card--held' : ''}`}
            >
              <span className="relic-card__title">{card.title}</span>
              <span className="relic-card__kind">
                {card.key.startsWith('relic:') ? 'Relic you read' : card.key.startsWith('remains:') ? 'Remains you recovered' : 'Log of the fight'}
              </span>
              {names.length > 0 && <span className="relic-card__votes">{names.join(', ')}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
