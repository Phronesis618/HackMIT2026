/**
 * Exemplar bank loader and per-request rotation (agent W2). See prompts/exemplars/README.md.
 *
 *  - 3 to 4 exemplars per text type per call: more barely helps (Wang et al., arXiv 2509.14543).
 *  - Rotated deterministically by the request seed, so a retry sees the same set and a new
 *    world sees a different one; drawn from at least two exemplar worlds.
 *  - Exemplar worlds are ranked by keyword overlap with the players' ideas and the most
 *    similar world is skipped, so the model cannot lift names or objects that fit.
 *  - Each exemplar is shown WITH the bible facts it used: the step from fact to text is
 *    the thing to imitate.
 */
import fs from 'node:fs';
import { z } from 'zod';
import { hashString } from '../../shared/ids';

const ExemplarSchema = z.object({
  id: z.string(),
  kind: z.string(),
  author: z.string().optional(),
  bibleRefs: z.array(z.string()).default([]),
  title: z.string().optional(),
  source: z.string().optional(),
  name: z.string().optional(),
  effectId: z.string().optional(),
  enemyId: z.string().optional(),
  text: z.string(),
});
export type Exemplar = z.infer<typeof ExemplarSchema>;

const ExemplarWorldSchema = z.object({
  world: z.string(),
  bible: z.object({
    premise: z.string(),
    collapse: z.string(),
    people: z.array(z.object({ name: z.string(), job: z.string(), want: z.string() })),
    places: z.array(z.string()),
    objects: z.array(z.string()),
    events: z.array(z.object({ id: z.string(), date: z.string(), fact: z.string() })),
    authors: z.array(z.object({ name: z.string(), document: z.string(), register: z.string(), never: z.string() })),
    enemies: z.record(z.string(), z.string()).default({}),
  }),
  exemplars: z.array(ExemplarSchema),
});
export type ExemplarWorld = z.infer<typeof ExemplarWorldSchema>;

export type ExemplarKind = 'relic' | 'remains' | 'roomLine' | 'boonDescription' | 'itemBlurb' | 'biomeTagline' | 'bossCallout';

const DEFAULT_DIR = new URL('../../../prompts/exemplars/', import.meta.url);
let cached: ExemplarWorld[] | undefined;

export function loadExemplarBank(dir: URL | string = DEFAULT_DIR): ExemplarWorld[] {
  const useCache = dir === DEFAULT_DIR;
  if (useCache && cached) return cached;
  const base = typeof dir === 'string' ? dir : dir;
  const names = fs.readdirSync(base).filter((name) => name.endsWith('.json')).sort();
  const worlds = names.map((name) => ExemplarWorldSchema.parse(
    JSON.parse(fs.readFileSync(typeof base === 'string' ? `${base.replace(/\/$/, '')}/${name}` : new URL(name, base), 'utf8')),
  ));
  if (useCache) cached = worlds;
  return worlds;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'was', 'were', 'has', 'had', 'its', 'one', 'all', 'not', 'are', 'but', 'his', 'her', 'she', 'him', 'out', 'who', 'into', 'over', 'day']);
function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** Shared-keyword count between the ideas and everything written for an exemplar world. */
export function ideaOverlap(world: ExemplarWorld, ideas: readonly string[]): number {
  const idea = keywords(ideas.join(' '));
  if (idea.size === 0) return 0;
  const corpus = keywords(JSON.stringify([world.world, world.bible, world.exemplars.map((e) => [e.text, e.name, e.title])]));
  let hits = 0;
  for (const word of idea) if (corpus.has(word)) hits++;
  return hits;
}

export interface ExemplarSelection {
  world: ExemplarWorld;
  exemplar: Exemplar;
}

/**
 * Deterministic pick of `count` exemplars of one kind. Worlds are ordered by ascending
 * overlap with the ideas (seeded tie-break); the most similar world is dropped when at
 * least three are available; picks alternate between the remaining worlds. For relics the
 * pick keeps a spread of lengths (shortest and longest of each world's rotated window).
 */
export function selectExemplars(options: {
  kind: ExemplarKind;
  count: number;
  seed: number;
  ideas: readonly string[];
  bank?: ExemplarWorld[];
}): ExemplarSelection[] {
  const bank = options.bank ?? loadExemplarBank();
  const ranked = bank
    .map((world) => ({ world, overlap: ideaOverlap(world, options.ideas), tie: hashString(`${options.seed}:${world.world}`) }))
    .sort((a, b) => a.overlap - b.overlap || a.tie - b.tie);
  const worlds = (ranked.length >= 3 ? ranked.slice(0, -1) : ranked).map((entry) => entry.world);
  const pools = worlds.map((world) => {
    const all = world.exemplars.filter((exemplar) => exemplar.kind === options.kind);
    const start = all.length ? hashString(`${options.seed}:${options.kind}:${world.world}`) % all.length : 0;
    const rotated = all.map((_, index) => all[(start + index) % all.length]!);
    if (options.kind === 'relic' || options.kind === 'remains') {
      // keep a length spread: alternate shortest / longest of the rotated window
      const window = rotated.slice(0, Math.min(rotated.length, 4)).sort((a, b) => a.text.length - b.text.length);
      const spread: Exemplar[] = [];
      while (window.length) {
        spread.push(window.shift()!);
        if (window.length) spread.push(window.pop()!);
      }
      return { world, list: spread };
    }
    return { world, list: rotated };
  }).filter((pool) => pool.list.length > 0);
  const out: ExemplarSelection[] = [];
  for (let round = 0; out.length < options.count && pools.some((pool) => pool.list.length > round); round++) {
    for (const pool of pools) {
      const exemplar = pool.list[round];
      if (exemplar && out.length < options.count) out.push({ world: pool.world, exemplar });
    }
  }
  return out;
}

/** The facts an exemplar drew on, resolved from its world's bible. */
function resolveRefs({ world, exemplar }: ExemplarSelection): string[] {
  const facts: string[] = [];
  for (const ref of exemplar.bibleRefs) {
    const event = world.bible.events.find((candidate) => candidate.id === ref);
    if (event) facts.push(`event (${event.date}): ${event.fact}`);
    else if (world.bible.enemies[ref]) facts.push(`enemy ${ref}: ${world.bible.enemies[ref]}`);
    else facts.push(`noun: ${ref}`);
  }
  const author = world.bible.authors.find((candidate) => candidate.name === exemplar.author);
  if (author) facts.push(`author: ${author.name}, writes in ${author.document}. Register: ${author.register} Never: ${author.never}`);
  return facts;
}

export function formatExemplars(kind: ExemplarKind, picks: ExemplarSelection[]): string {
  if (picks.length === 0) return '';
  const blocks = picks.map((pick, index) => {
    const e = pick.exemplar;
    const head = [e.name && `name: ${e.name}`, e.title && `title: ${e.title}`, e.source && `source: ${e.source}`].filter(Boolean).join(' | ');
    return [`Example ${index + 1} (${kind}, from the world "${pick.world.world}")`, ...resolveRefs(pick).map((fact) => `  fact - ${fact}`), head && `  ${head}`, `  text: ${e.text}`]
      .filter(Boolean).join('\n');
  });
  return blocks.join('\n');
}

const KIND_LABEL: Record<ExemplarKind, string> = {
  relic: 'relic fragments', remains: 'remains fragments', roomLine: 'room lines', boonDescription: 'attunement and law descriptions',
  itemBlurb: 'item blurbs', biomeTagline: 'biome names and taglines', bossCallout: 'boss callouts',
};

/** The exemplar section of a system prompt: `count` examples for each requested kind. */
export function exemplarSection(options: { kinds: ExemplarKind[]; count?: number; seed: number; ideas: readonly string[]; bank?: ExemplarWorld[] }): string {
  const parts = options.kinds.map((kind) => {
    const picks = selectExemplars({ kind, count: options.count ?? 3, seed: options.seed, ideas: options.ideas, bank: options.bank });
    return picks.length ? `## Examples: ${KIND_LABEL[kind]}\n${formatExemplars(kind, picks)}` : '';
  }).filter(Boolean);
  if (parts.length === 0) return '';
  return [
    '# Examples from OTHER worlds',
    'Each example shows the bible facts it used, then the text. Imitate the step from fact to text: the plainness, the counts, the author\'s habits.',
    'These worlds are not yours. Reusing their names, numbers, objects or sentences is an error; an editor checks every noun against your bible.',
    'The examples differ from each other in length and opening on purpose. Yours must too.',
    ...parts,
  ].join('\n');
}

/** One whole bible from the exemplar world least like the ideas, as a model of flatness and brevity. */
export function exemplarBible(seed: number, ideas: readonly string[], bank: ExemplarWorld[] = loadExemplarBank()): string {
  const ranked = bank
    .map((world) => ({ world, overlap: ideaOverlap(world, ideas), tie: hashString(`${seed}:bible:${world.world}`) }))
    .sort((a, b) => a.overlap - b.overlap || a.tie - b.tie);
  const candidates = ranked.length >= 3 ? ranked.slice(0, -1) : ranked;
  const pick = candidates[seed % Math.max(1, candidates.length)]?.world;
  if (!pick) return '';
  const { premise, collapse, people, places, objects, events, authors, enemies } = pick.bible;
  const bible = {
    premise, collapse, people, places, objects,
    events: events.map(({ date, fact }) => ({ date, fact })), authors,
    enemies: Object.entries(enemies).map(([enemyId, formerJob]) => ({ enemyId, formerJob })),
  };
  return [
    `# Example bible from ANOTHER world ("${pick.world}")`,
    'Imitate its flatness, its dated chain of cause and how unlike each other the three authors are. Reusing its names, numbers or objects is an error.',
    JSON.stringify(bible),
  ].join('\n');
}
