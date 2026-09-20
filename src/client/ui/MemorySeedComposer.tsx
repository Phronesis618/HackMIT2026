import { useId, useState } from 'react';
import type { MemoryRecord } from '../../shared/contracts';
import type { UiActions } from '../../shared/ui';
import { MEMORY_SOURCE_LABELS } from '../chronicle/memoryArchive';
import { createMemorySeed, memorySeedBlockReason, SEED_DIRECTIONS, validMemorySeed, type MemorySeedContext, type SeedDirection } from '../chronicle/memorySeeds';

export function MemorySeedComposer({ memory, context, actions, onClose, onSubmit }: {
  memory: MemoryRecord;
  context: MemorySeedContext;
  actions: UiActions;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<SeedDirection, string>>(() => ({
    carry: createMemorySeed(memory, 'carry'),
    before: createMemorySeed(memory, 'before'),
    after: createMemorySeed(memory, 'after'),
  }));
  const [direction, setDirection] = useState<SeedDirection>('carry');
  const draft = drafts[direction];
  const helpId = useId();
  const reason = memorySeedBlockReason(context);
  const contribution = validMemorySeed(draft);

  return (
    <form className="memory-seed" aria-label="Carry a memory into a new world" onSubmit={(event) => {
      event.preventDefault();
      if (reason || !contribution) return;
      actions.submitContribution(contribution);
      onSubmit();
    }}>
      <div className="panel__row">
        <h3 className="panel__subtitle">Carry a memory into a new world</h3>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel memory idea</button>
      </div>
      <p className="hint">{memory.worldTitle} · {MEMORY_SOURCE_LABELS[memory.provenanceSource]}</p>
      <blockquote className="memory-seed__source">{memory.summary}</blockquote>
      <p className="hint">Use this record as a starting point. Edit the idea before contributing as {context.localPlayer.displayName}. The saved record stays unchanged.</p>
      <div className="memory-seed__directions" aria-label="Idea direction">
        {(Object.keys(SEED_DIRECTIONS) as SeedDirection[]).map((id) => (
          <button type="button" className={`chip ${direction === id ? 'chip--active' : ''}`} key={id} aria-pressed={direction === id} onClick={() => setDirection(id)}>{SEED_DIRECTIONS[id].label}</button>
        ))}
      </div>
      <label className="field">
        <span className="field__label">Idea from this memory</span>
        <textarea className="input input--area" rows={3} maxLength={200} value={draft} autoFocus aria-describedby={helpId} onChange={(event) => setDrafts((current) => ({ ...current, [direction]: event.target.value }))} />
      </label>
      <div className="memory-seed__footer">
        <span className="hint">{draft.length}/200</span>
        <button type="submit" className="btn btn--primary" disabled={reason !== null || contribution === null}>Contribute memory idea</button>
      </div>
      <p className="hint" id={helpId}>{reason ?? 'Adds one idea to the HQ console. Prepare another world there when your ideas are ready.'}</p>
      {!context.liveGenerationAvailable && <p className="hint">Live generation is off. Your idea will be recorded, but offline fixtures do not change to match it.</p>}
    </form>
  );
}
