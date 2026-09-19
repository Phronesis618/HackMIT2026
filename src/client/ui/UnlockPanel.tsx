import type { UiActions, UiModel } from '../../shared/ui';

/**
 * Headquarters shop: spend shards on permanent unlocks. Minimal A-built panel — Agent C owns
 * the finished presentation. Reads UiModel.profile/unlockOffers; calls actions.purchaseUnlock.
 */
export function UnlockPanel({ model, actions }: { model: UiModel; actions: UiActions }) {
  const offers = model.unlockOffers.filter((o) => o.applicable);
  return (
    <div className="panel panel--shop">
      <div className="panel__row">
        <h2 className="panel__title">Armory</h2>
        <span className="badge badge--kind">{model.profile.shards} shards</span>
      </div>
      {offers.length === 0 && <p className="muted">No unlocks available for this class yet.</p>}
      {offers.map((o) => (
        <div key={o.abilityId} className={`offer ${o.owned ? 'offer--owned' : ''}`}>
          <div className="offer__body">
            <div className="offer__name">
              <span className="ability__key">{o.slot.toUpperCase()}</span> {o.name}
            </div>
            <div className="offer__desc">{o.description}</div>
          </div>
          {o.owned ? (
            <span className="badge badge--live">UNLOCKED</span>
          ) : (
            <button type="button" className="btn btn--primary" disabled={!o.affordable} onClick={() => actions.purchaseUnlock(o.abilityId)}>
              Unlock · {o.cost}
            </button>
          )}
        </div>
      ))}
      <p className="hint">
        Shards come from defeated enemies and cleared rooms; they bank when a run ends. Runs played: {model.profile.runsPlayed}. Saved on this
        device only.
      </p>
    </div>
  );
}
