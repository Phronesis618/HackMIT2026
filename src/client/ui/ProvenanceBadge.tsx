import type { GenerationProvenance } from '../../shared/contracts';

/** Always-visible honesty marker: fixture vs live vs fallback. */
export function ProvenanceBadge({ provenance, compact = false }: { provenance: GenerationProvenance; compact?: boolean }) {
  const tone = provenance.source === 'live' ? 'live' : provenance.source === 'live_fallback_fixture' ? 'fallback' : 'fixture';
  return (
    <span className={`badge badge--${tone}`} title={provenance.notes.join('\n')}>
      {compact ? provenance.label.split(' (')[0] : provenance.label}
      {provenance.model ? ` · ${provenance.model}` : ''}
    </span>
  );
}
