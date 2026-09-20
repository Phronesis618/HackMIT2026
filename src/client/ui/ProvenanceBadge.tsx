import type { GenerationProvenance } from '../../shared/contracts';

/** Always-visible honesty marker: fixture vs live vs fallback. */
export function ProvenanceBadge({ provenance, compact = false }: { provenance: GenerationProvenance; compact?: boolean }) {
  const tone = provenance.source === 'live' ? 'live' : provenance.source === 'procedural' ? 'procedural' : provenance.source === 'live_fallback_fixture' ? 'fallback' : 'fixture';
  const label = compact ? provenance.label.split(' (')[0]! : provenance.label;
  // Live labels already read "LIVE · <model>"; only append the model when the label omits it.
  const model = provenance.model && !label.includes(provenance.model) ? ` · ${provenance.model}` : '';
  return (
    <span className={`badge badge--${tone}`} title={provenance.notes.join('\n')}>
      {label}
      {model}
    </span>
  );
}
