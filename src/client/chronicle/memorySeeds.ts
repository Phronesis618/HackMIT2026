import { ContributionText, type MemoryRecord } from '../../shared/contracts';
import type { UiModel } from '../../shared/ui';

export type MemorySeedContext = Pick<UiModel, 'phase' | 'connection' | 'generation' | 'contributions' | 'liveGenerationAvailable' | 'localPlayer'>;
export type SeedDirection = 'carry' | 'before' | 'after';

export const SEED_DIRECTIONS: Record<SeedDirection, { label: string; prompt: string }> = {
  carry: { label: 'Carry it forward', prompt: 'Build a new world around this record' },
  before: { label: 'Before this happened', prompt: 'Build a new world set before this record' },
  after: { label: 'What happens next?', prompt: 'Build a new world about what could follow this record' },
};

export function createMemorySeed(memory: MemoryRecord, direction: SeedDirection): string {
  const prefix = `${SEED_DIRECTIONS[direction].prompt} from "${memory.worldTitle}": `;
  const summary = memory.summary.replace(/\s+/g, ' ').trim();
  if (prefix.length + summary.length <= 200) return prefix + summary;
  let excerpt = '';
  for (const character of summary) {
    if (prefix.length + excerpt.length + character.length > 199) break;
    excerpt += character;
  }
  return `${prefix}${excerpt}…`;
}

export function memorySeedBlockReason(context: MemorySeedContext): string | null {
  if (context.phase !== 'headquarters') return 'Return to headquarters to contribute a memory.';
  if (context.connection.status !== 'connected') return 'Reconnect before adding an idea.';
  if (['queued', 'generating', 'validating'].includes(context.generation.phase)) return 'Wait for world preparation to finish.';
  if (context.contributions.length >= 24) return 'All 24 contribution slots are filled.';
  return null;
}

export function validMemorySeed(text: string): string | null {
  const parsed = ContributionText.safeParse(text);
  return parsed.success ? parsed.data : null;
}
