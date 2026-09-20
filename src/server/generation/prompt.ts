/**
 * Runtime prompt builder (agent W2). Prompts live in prompts/runtime/*.md:
 *   common.md      framing, injection guard, the house rules as positive instructions
 *   foundation.md  call 1: bible first, then title/tagline/palette/look/laws/rooms/opener biome
 *   relics.md, remains.md, biomes.md   call 2 (run in parallel, conditioned on the bible)
 *   polish.md      linter-driven rewrite of specific rejected lines
 *   world-recipe.md  the whole recipe in one call (operator inbox, custom providers)
 * Ban lists are deliberately absent (they prime the words; see docs/WRITING.md section 7):
 * the validator owns them and the polish call gets only the advice for what failed.
 */
import fs from 'node:fs';
import { hashString } from '../../shared/ids';
import { lawsAndLookRegistry } from '../../shared/laws';
import {
  ATTUNEMENT_EFFECT_IDS, ATTUNEMENT_EFFECT_INFO, ENEMY_IDS, MOTIF_IDS, PROP_IDS,
  TERRAIN_DENSITIES, TERRAIN_FEATURE_INFO, TERRAIN_LAYOUT_IDS, type EnemyId,
} from '../../shared/registry';
import { exemplarSection, type ExemplarKind } from './exemplars';

export type PromptStage = 'foundation' | 'relics' | 'remains' | 'biomes' | 'polish' | 'full';

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
  if (stage === 'foundation') return JSON.stringify({ ...ids, ...terrain, ...lawsAndLookRegistry() });
  if (stage === 'biomes') return JSON.stringify(ids);
  if (stage === 'remains') return JSON.stringify({ enemyIds: ids.enemyIds, ...attunements });
  if (stage === 'full') return JSON.stringify({ ...ids, ...terrain, ...attunements, ...lawsAndLookRegistry() });
  return '';
}

const STAGE_EXEMPLARS: Record<PromptStage, ExemplarKind[]> = {
  foundation: ['roomLine', 'biomeTagline'],
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
      .replace('{{relics}}', section('relics.md'))
      .replace('{{remains}}', section('remains.md'))
      .replace('{{biomes}}', section('biomes.md'))
      .replace('{{registry}}', registryText('full'))
      .replace('{{exemplars}}', exemplars);
  }
  const registry = registryText(stage);
  return [
    file('common.md'),
    section(`${stage}.md`),
    registry ? `Use only the allowed registry IDs below:\n${registry}` : '',
    exemplars,
  ].filter(Boolean).join('\n\n');
}

/** A seeded handful of plain names, offered so the model does not reach for its favourites. */
export function namePool(seed: number, count = 10): string[] {
  const pool = JSON.parse(file('names.json')) as { given: string[]; surname: string[] };
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 3; i++) {
    const given = pool.given[hashString(`${seed}:given:${i}`) % pool.given.length]!;
    const surname = pool.surname[hashString(`${seed}:surname:${i}`) % pool.surname.length]!;
    const name = `${given} ${surname}`;
    if (!out.some((existing) => existing.startsWith(`${given} `) || existing.endsWith(` ${surname}`))) out.push(name);
  }
  return out;
}
