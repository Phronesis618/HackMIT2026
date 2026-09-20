import type { MemoryRecord } from '../../shared/contracts';

export const MEMORY_KIND_LABELS: Record<MemoryRecord['kind'], string> = {
  creation_receipt: 'Receipt',
  arrival_keepsake: 'Arrival',
  milestone: 'Milestone',
  anchor: 'Anchor',
  run_summary: 'Expedition',
  lore: 'Lore',
};

export const MEMORY_SOURCE_LABELS: Record<MemoryRecord['provenanceSource'], string> = {
  live: 'Live generation',
  fixture: 'Offline fixture',
  live_fallback_fixture: 'Fallback fixture',
};

export interface MemoryFilters {
  query: string;
  worldId: string;
  kind: string;
}

export function filterMemories(memories: readonly MemoryRecord[], filters: MemoryFilters): MemoryRecord[] {
  const terms = normalize(filters.query).split(' ').filter(Boolean);
  return memories.filter((memory) => {
    if (filters.worldId && memory.worldId !== filters.worldId) return false;
    if (filters.kind && memory.kind !== filters.kind) return false;
    const text = normalize([
      memory.title, memory.summary, memory.worldTitle, MEMORY_KIND_LABELS[memory.kind],
      MEMORY_SOURCE_LABELS[memory.provenanceSource],
      ...memory.participants.map((player) => player.displayName),
    ].join(' '));
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function memoryWorlds(memories: readonly MemoryRecord[]): { id: string; title: string }[] {
  const worlds = new Map<string, string>();
  for (const memory of filterMemories(memories, { query: '', worldId: '', kind: '' })) {
    if (!worlds.has(memory.worldId)) worlds.set(memory.worldId, memory.worldTitle);
  }
  return [...worlds].map(([id, title]) => ({ id, title }));
}

export function createFieldReport(memories: readonly MemoryRecord[]): string {
  const ordered = filterMemories(memories, { query: '', worldId: '', kind: '' }).reverse();
  const lines = [
    'RELAY / FIELD REPORT',
    `${ordered.length} saved records from this browser.`,
    'Only the records included below are represented. Missing records do not establish an outcome.',
    'Fixture records describe offline play. They do not prove that ideas shaped a generated world.',
    'This text file is a keepsake; it cannot restore game progress.',
    '',
  ];
  for (const memory of ordered) {
    lines.push(
      `${MEMORY_KIND_LABELS[memory.kind].toUpperCase()} / ${memory.title}`,
      `World: ${memory.worldTitle} (${memory.worldId})`,
      `Source: ${MEMORY_SOURCE_LABELS[memory.provenanceSource]}`,
      `Recorded: ${new Date(memory.createdAt).toISOString()}`,
      `Participants: ${memory.participants.map((player) => player.displayName).join(', ')}`,
      memory.summary,
      `Evidence: ${memory.sourceEventIds.join(', ')}`,
      `Record: ${memory.id}`,
      '',
    );
  }
  return lines.join('\n');
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
