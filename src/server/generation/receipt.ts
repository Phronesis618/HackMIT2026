/**
 * Creation receipt builder. Shared by fixture and (future) live generation so the
 * honesty rules live in one place:
 *  - a line is `used: true` ONLY when a real attribution/mapping exists for it
 *  - fixture worlds never claim to have used a contribution
 */
import { ATTRIBUTING_SOURCES, type Contribution, type ContributionMapping, type CreationReceipt, type GenerationSource } from '../../shared/contracts';

export function buildReceipt(params: {
  worldTitle: string;
  source: GenerationSource;
  contributions: Contribution[];
  mappings: ContributionMapping[];
}): CreationReceipt {
  const { worldTitle, source, contributions, mappings } = params;
  const byContribution = new Map(mappings.map((m) => [m.contributionId, m]));

  const lines = contributions.slice(0, 24).map((c) => {
    const mapping = ATTRIBUTING_SOURCES.has(source) ? byContribution.get(c.id) : undefined;
    return {
      contributionId: c.id,
      playerId: c.playerId,
      playerName: c.playerName,
      text: c.text,
      used: mapping !== undefined,
      featureDescription: mapping?.featureDescription ?? null,
    };
  });

  const n = contributions.length;
  const ideas = `${n} idea${n === 1 ? '' : 's'}`;
  const were = n === 1 ? 'was' : 'were';
  let headline: string;
  if (source === 'fixture') {
    headline =
      n > 0
        ? `Offline fixture “${worldTitle}”. Your ${ideas} ${were} recorded but did not shape this world.`
        : `Offline fixture “${worldTitle}”. No contributions were submitted.`;
  } else if (source === 'live_fallback_fixture') {
    headline = `Live generation failed. Offline fixture “${worldTitle}” instead. Your ${ideas} ${were} recorded but did not shape this world.`;
  } else if (source === 'procedural') {
    const used = lines.filter((l) => l.used).length;
    headline = `“${worldTitle}” was composed from your ${ideas} by the offline composer, with no model call; ${used} shaped observable features.`;
  } else {
    const used = lines.filter((l) => l.used).length;
    headline = `“${worldTitle}” was generated from your ${ideas}; ${used} shaped observable features.`;
  }

  return { worldTitle: clip(worldTitle, 40), source, headline: clip(headline, 160), lines };
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
