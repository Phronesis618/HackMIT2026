/**
 * Runtime prompt builder (agent W2). Prompts live in prompts/runtime/*.md:
 *   common.md      framing, injection guard, the house rules as positive instructions
 *   foundation.md  call 1: the bible, then title/tagline/summary/motifs/palette
 *   rooms.md, relics.md, remains.md, biomes.md   call 2 (run in parallel, conditioned on the bible)
 *   polish.md      linter-driven rewrite of specific rejected lines
 *   world-recipe.md  the whole recipe in one call (operator inbox, custom providers)
 * Ban lists are deliberately absent (they prime the words; see docs/WRITING.md section 7):
 * the validator owns them and the polish call gets only the advice for what failed.
 */
import fs from 'node:fs';
import { custodianRegistry, lawsAndLookRegistry } from '../../shared/laws';
import {
  ATTUNEMENT_EFFECT_IDS, ATTUNEMENT_EFFECT_INFO, ENEMY_IDS, MOTIF_IDS, PROP_IDS,
  TERRAIN_DENSITIES, TERRAIN_FEATURE_INFO, TERRAIN_LAYOUT_IDS, type EnemyId,
} from '../../shared/registry';
import { exemplarBible, exemplarSection, seededInt, type ExemplarKind } from './exemplars';

export type PromptStage = 'foundation' | 'rooms' | 'laws' | 'relics' | 'remains' | 'biomes' | 'polish' | 'full';

const read = (name: string): string => fs.readFileSync(new URL(`../../../prompts/runtime/${name}`, import.meta.url), 'utf8').trim();
const files = new Map<string, string>();
const file = (name: string): string => {
  if (!files.has(name)) files.set(name, read(name));
  return files.get(name)!;
};

/** How each enemy kind fights, so the model can cast former jobs that fit. */
const ENEMY_BEHAVIOUR: Record<EnemyId, string> = {
  husk: 'slow melee swing after a windup; common',
  sentinel: 'holds a post and fires a straight volley of bolts',
  lurker: 'charges in a straight line, then scatters a ring of spores',
  guardian: 'the final boss; only in the final room or the finale biome',
  spewer: 'spits a spread of three slow bolts',
  swarmling: 'small, fast, weak; comes in numbers',
  warden: 'heavy; launches one slow homing bolt',
  channeler: 'stands still and channels a rotating spiral of bolts',
};

export function registryText(stage: PromptStage): string {
  const ids = { motifIds: MOTIF_IDS, propIds: PROP_IDS, enemyIds: Object.fromEntries(ENEMY_IDS.map((id) => [id, ENEMY_BEHAVIOUR[id]])) };
  const terrain = { terrainFeatures: TERRAIN_FEATURE_INFO, terrainLayouts: TERRAIN_LAYOUT_IDS, terrainDensities: TERRAIN_DENSITIES };
  const attunements = { attunementEffects: Object.fromEntries(ATTUNEMENT_EFFECT_IDS.map((id) => [id, ATTUNEMENT_EFFECT_INFO[id].summary])) };
  if (stage === 'foundation') return JSON.stringify(ids);
  if (stage === 'rooms') return JSON.stringify({ ...ids, ...terrain });
  if (stage === 'laws') return JSON.stringify({ ...lawsAndLookRegistry(), terrainFeatures: TERRAIN_FEATURE_INFO, custodianPatterns: custodianRegistry() });
  if (stage === 'biomes') return JSON.stringify(ids);
  if (stage === 'remains') return JSON.stringify({ enemyIds: ids.enemyIds, ...attunements });
  if (stage === 'full') return JSON.stringify({ ...ids, ...terrain, ...attunements, ...lawsAndLookRegistry(), custodianPatterns: custodianRegistry() });
  return '';
}

const STAGE_EXEMPLARS: Record<PromptStage, ExemplarKind[]> = {
  foundation: [],
  rooms: ['roomLine'],
  laws: ['boonDescription', 'bossCallout'],
  relics: ['relic'],
  remains: ['remains', 'boonDescription'],
  biomes: ['biomeTagline', 'roomLine'],
  polish: [],
  full: ['relic', 'remains', 'roomLine', 'boonDescription'],
};
const STAGE_EXEMPLAR_COUNT: Partial<Record<PromptStage, number>> = { relics: 4, full: 3 };

export interface PromptOptions {
  stage: PromptStage;
  seed: number;
  ideas: readonly string[];
  /** Test hook: skip exemplars. */
  exemplars?: boolean;
}

/** System prompt for one stage. Deterministic for (stage, seed, ideas). */
export function buildSystemPrompt(options: PromptOptions): string {
  const { stage } = options;
  const briefRules = file('brief-rules.md');
  const section = (name: string): string => file(name).replaceAll('{{briefRules}}', briefRules);
  const exemplars = options.exemplars === false ? '' : exemplarSection({
    kinds: STAGE_EXEMPLARS[stage], count: STAGE_EXEMPLAR_COUNT[stage] ?? 3, seed: options.seed, ideas: options.ideas,
  });
  if (stage === 'full') {
    return file('world-recipe.md')
      .replace('{{common}}', file('common.md'))
      .replace('{{foundation}}', section('foundation.md'))
      .replace('{{rooms}}', section('rooms.md'))
      .replace('{{laws}}', section('laws.md'))
      .replace('{{relics}}', section('relics.md'))
      .replace('{{remains}}', section('remains.md'))
      .replace('{{biomes}}', section('biomes.md'))
      .replace('{{registry}}', registryText('full'))
      .replace('{{exemplars}}', exemplars);
  }
  const registry = registryText(stage);
  const bibleExample = stage === 'foundation' && options.exemplars !== false ? exemplarBible(options.seed, options.ideas) : '';
  return [
    file('common.md'),
    section(`${stage}.md`),
    registry ? `Use only the allowed registry IDs below:\n${registry}` : '',
    bibleExample,
    exemplars,
  ].filter(Boolean).join('\n\n');
}

/** A seeded handful of plain names, offered so the model does not reach for its favourites. */
export function namePool(seed: number, count = 10): string[] {
  const pool = JSON.parse(file('names.json')) as { given: string[]; surname: string[] };
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const given = pool.given[seededInt(seed, `given:${i}`) % pool.given.length]!;
    const surname = pool.surname[seededInt(seed, `surname:${i}`) % pool.surname.length]!;
    const name = `${given} ${surname}`;
    if (!out.some((existing) => existing.startsWith(`${given} `) || existing.endsWith(` ${surname}`))) out.push(name);
  }
  return out;
}

/** Seeded nudges against sameness between worlds: what kind of mistake ended the place, what its people wrote in, how they dated things. */
export function worldSeeds(seed: number): { collapseKind: string; documentKinds: string[]; calendar: string } {
  const pool = JSON.parse(file('names.json')) as { collapseKinds: string[]; documentKinds: string[]; calendars: string[] };
  const documentKinds: string[] = [];
  for (let i = 0; documentKinds.length < 2 && i < 16; i++) {
    const kind = pool.documentKinds[seededInt(seed, `document:${i}`) % pool.documentKinds.length]!;
    if (!documentKinds.includes(kind)) documentKinds.push(kind);
  }
  return {
    collapseKind: pool.collapseKinds[seededInt(seed, 'collapse') % pool.collapseKinds.length]!,
    documentKinds,
    calendar: pool.calendars[seededInt(seed, 'calendar') % pool.calendars.length]!,
  };
}
