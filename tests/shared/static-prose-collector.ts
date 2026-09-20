/**
 * Collects every player-facing STATIC string (typed by us, not written by the model) so
 * tests/shared/static-prose.test.ts can hold them to docs/WRITING.md with the same linter the
 * live pipeline uses. Registries are read as data; UI text is pulled from the .tsx sources
 * with a regex pass, because those strings live inside components and cannot be imported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { WorldFixtureSchema } from '../../src/shared/contracts';
import { CUSTODIAN_PATTERNS, DEFAULT_CUSTODIAN_TITLE, DEFAULT_PHASE_TITLES } from '../../src/shared/custodian';
import { createFloorRuntime, deriveBiomeBriefs, planWorldRoute } from '../../src/shared/floorgen';
import { DEFAULT_BIOME_BRIEFS } from '../../src/shared/floorgen/route';
import { HEADQUARTERS_STATIONS } from '../../src/shared/headquarters';
import { CUSTODIAN_PATTERN_INFO, LAW_INFO, WORLD_LAW_IDS } from '../../src/shared/laws';
import type { ProseKind } from '../../src/shared/prose';
import { ABILITY_DETAILS, ATTUNEMENT_EFFECT_INFO, CLASS_IDS, CLASS_INFO, CLASS_THEME, ENEMY_INFO, TERRAIN_CAPTION } from '../../src/shared/registry';
import { buildSkillTree } from '../../src/shared/skills';
import { HUB_CUES, HUB_CUE_LINES, renderCueLine } from '../../src/client/chronicle/hubCues';

export interface StaticString {
  source: string;
  kind: ProseKind;
  text: string;
}

const root = path.resolve(__dirname, '../..');

/** Values that make a cue template read as the sentence a player would see. */
const CUE_SAMPLE: Record<string, string> = {
  enemyName: 'Sentinel', deepestRoomIndex: '2', worldTitle: 'Halloran Deep', downs: '3', durationMin: '14',
  damageTaken: '212', revivesReceived: '2', roomsCleared: '5', deepestTier: '3', biomesCleared: '2',
};

export function collectRegistryStrings(): StaticString[] {
  const out: StaticString[] = [];
  const add = (source: string, kind: ProseKind, text: string | undefined): void => {
    if (text && text.trim()) out.push({ source, kind, text });
  };

  for (const id of CLASS_IDS) {
    add(`registry.CLASS_INFO.${id}.role`, 'uiLabel', CLASS_INFO[id].role);
    add(`registry.CLASS_THEME.${id}.weapon`, 'itemName', CLASS_THEME[id].weapon);
  }
  for (const [id, ability] of Object.entries(ABILITY_DETAILS)) {
    add(`registry.ABILITY_DETAILS.${id}.name`, 'itemName', ability.name);
    add(`registry.ABILITY_DETAILS.${id}.description`, 'skillNode', ability.description);
    add(`registry.ABILITY_DETAILS.${id}.stats`, 'skillNode', ability.stats);
  }
  for (const [id, enemy] of Object.entries(ENEMY_INFO)) add(`registry.ENEMY_INFO.${id}.name`, 'enemyName', enemy.name);
  for (const [id, caption] of Object.entries(TERRAIN_CAPTION)) add(`registry.TERRAIN_CAPTION.${id}`, 'uiLabel', caption);
  for (const [id, info] of Object.entries(ATTUNEMENT_EFFECT_INFO)) add(`registry.ATTUNEMENT_EFFECT_INFO.${id}`, 'skillNode', info.summary);

  for (const classId of CLASS_IDS) {
    const tree = buildSkillTree(classId, null);
    add(`skills.${classId}.title`, 'uiLabel', tree.title);
    add(`skills.${classId}.subtitle`, 'uiLabel', tree.subtitle);
    for (const node of tree.nodes) {
      if (node.kind === 'core' && classId !== CLASS_IDS[0]) continue;
      add(`skills.${node.id}.name`, 'itemName', node.name);
      add(`skills.${node.id}.description`, 'skillNode', node.description);
    }
  }

  for (const id of WORLD_LAW_IDS) add(`laws.LAW_INFO.${id}`, 'generic', LAW_INFO[id].summary);
  for (const [id, info] of Object.entries(CUSTODIAN_PATTERN_INFO)) add(`laws.CUSTODIAN_PATTERN_INFO.${id}`, 'generic', info.summary);
  for (const [id, pattern] of Object.entries(CUSTODIAN_PATTERNS)) {
    add(`custodian.${id}.defaultName`, 'itemName', pattern.defaultName);
    add(`custodian.${id}.defaultTell`, 'bossCallout', pattern.defaultTell);
  }
  add('custodian.DEFAULT_CUSTODIAN_TITLE', 'bossName', DEFAULT_CUSTODIAN_TITLE);
  DEFAULT_PHASE_TITLES.forEach((title, i) => add(`custodian.DEFAULT_PHASE_TITLES.${i}`, 'bossName', title));

  for (const station of HEADQUARTERS_STATIONS) {
    add(`headquarters.${station.id}.name`, 'roomName', station.name);
    add(`headquarters.${station.id}.wing`, 'roomName', station.wing);
    add(`headquarters.${station.id}.description`, 'roomLine', station.description);
    add(`headquarters.${station.id}.action`, 'uiLabel', station.action);
  }

  for (const cue of HUB_CUES) {
    (HUB_CUE_LINES[cue.id] ?? []).forEach((line, i) => add(`hubCues.${cue.id}.${i}`, 'npcLine', renderCueLine(cue, line, CUE_SAMPLE)));
  }

  for (const brief of DEFAULT_BIOME_BRIEFS) {
    add(`floorgen.DEFAULT_BIOME_BRIEFS.${brief.id}.name`, 'biomeName', brief.name);
    add(`floorgen.DEFAULT_BIOME_BRIEFS.${brief.id}.tagline`, 'biomeTagline', brief.tagline);
  }
  out.push(...collectDerivedFloorStrings());
  return out;
}

/** Engine-derived brief names/taglines and room names/descriptions for a world with no authored biomes. */
export function collectDerivedFloorStrings(): StaticString[] {
  const out: StaticString[] = [];
  const seen = new Set<string>();
  const add = (source: string, kind: ProseKind, text: string): void => {
    // Room numbers differ per room; lint each sentence shape once.
    const shape = text.replace(/\d+/g, 'N').replace(/Hostiles: .*/, 'Hostiles').replace(/^.*(?= (?:cell|hall|great hall|entrance|gate)\b)/, 'B');
    if (seen.has(`${kind}:${shape}`)) return;
    seen.add(`${kind}:${shape}`);
    out.push({ source, kind, text });
  };
  const dir = path.join(root, 'fixtures/worlds');
  const file = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()[0]!;
  const fixture = WorldFixtureSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  const recipe = { ...fixture.recipe, biomes: undefined };
  const seed = 'static-prose';
  const briefs = deriveBiomeBriefs(recipe, seed);
  for (const brief of briefs) {
    add(`floorgen.derived.${brief.id}.name`, 'biomeName', brief.name);
    add(`floorgen.derived.${brief.id}.tagline`, 'biomeTagline', brief.tagline);
  }
  const runtime = createFloorRuntime({ seed, briefs, route: planWorldRoute(seed, briefs.map((brief) => brief.id)) });
  for (const brief of briefs) {
    for (const planRoom of runtime.plan(brief.id).rooms) {
      const room = runtime.getRoom({ biomeId: brief.id, roomId: planRoom.id });
      add(`floorgen.derived.${brief.id}.${planRoom.id}.name`, 'roomName', room.name);
      add(`floorgen.derived.${brief.id}.${planRoom.id}.description`, 'roomLine', room.description);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source scan: UI components and the chronicle memory templates
// ---------------------------------------------------------------------------

/** Literals that are not prose: keys, ids, CSS, event names, test text. Matched on the whole literal. */
const IGNORE_LITERAL: readonly RegExp[] = [
  /^[a-z0-9_.:\-/ #%(),]+$/, // class lists, ids, css values, import paths
  /^[A-Za-z]+$/, // single identifiers ("Escape", "Shift") are labels only when rendered as JSX text
  /^(?:M|m)\s?-?\d[\d\s.,\-a-zA-Z]*$/, // svg paths
  /^(?:rgba?|hsla?|translate|scale|rotate|calc|var)\(/,
  /^(?:use strict|Content-Type|application\/json)$/,
  /^\s*$/,
];
/** Substrings that mark a literal as code rather than text. */
const CODE_MARKERS = /=>|\|\||&&|===|\bconst\b|\breturn\b|;\s*$|^\.\/|^@|^data-|^aria-|px\b|^#[0-9a-f]{3,8}$|[{}]|__|\?\s*$|[(=]\s*$|^[),:?]|\bas\s+[A-Z]\w+$|\w\(\w*$|^export |^function |\$$|^`|` : `/i;

const clean = (text: string): string =>
  text
    .replace(/\$\{[^}]*\}/g, 'N')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&apos;|&rsquo;/g, "'")
    .replace(/\\n/g, ' ').replace(/\\'/g, "'").replace(/\\u2019/g, "'")
    .replace(/\s+/g, ' ').trim();

const looksLikeProse = (text: string): boolean => {
  if (text.length < 4 || !/[A-Za-z]{3,}/.test(text)) return false;
  if (IGNORE_LITERAL.some((re) => re.test(text)) || CODE_MARKERS.test(text)) return false;
  // Two or more words, or one capitalised word with punctuation.
  return /\s/.test(text) && /[A-Z]/.test(text.replace(/\bN\b/g, ''));
};

/** Strip comments so commented-out code and doc text are not linted as UI. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

export function extractSourceStrings(file: string): string[] {
  const source = stripComments(fs.readFileSync(path.join(root, file), 'utf8'));
  const found = new Set<string>();
  const push = (raw: string): void => {
    const text = clean(raw);
    if (looksLikeProse(text)) found.add(text);
  };
  // JSX text between tags.
  // Text runs between tags and/or `{expr}` holes; code between braces is dropped by looksLikeProse.
  for (const match of source.matchAll(/(?<=[>}])([^<>{}=;()]*[A-Za-z]{3,}[^<>{}=;()]*)(?=[<{])/g)) push(match[1]!);
  // Quoted literals and template literals.
  for (const match of source.matchAll(/'((?:[^'\\\n]|\\.){4,})'/g)) push(match[1]!);
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.){4,})"/g)) push(match[1]!);
  for (const match of source.matchAll(/`((?:[^`\\]|\\.){4,})`/g)) push(match[1]!);
  return [...found];
}

export const UI_SOURCE_FILES: readonly string[] = [
  ...fs.readdirSync(path.join(root, 'src/client/ui')).filter((name) => /\.tsx?$/.test(name)).sort().map((name) => `src/client/ui/${name}`),
  'src/client/chronicle/memorySeeds.ts',
];
export const MEMORY_TEMPLATE_FILES: readonly string[] = ['src/chronicle/reducer.ts'];

export function collectSourceStrings(): StaticString[] {
  const out: StaticString[] = [];
  for (const file of UI_SOURCE_FILES) {
    for (const text of extractSourceStrings(file)) out.push({ source: file, kind: text.length > 120 ? 'generic' : 'uiLabel', text });
  }
  for (const file of MEMORY_TEMPLATE_FILES) {
    // Titles are labels; sentences are memory lines. `N` holes become a number so the line reads as it would in play.
    for (const text of extractSourceStrings(file)) out.push({ source: file, kind: /[.!?]$/.test(text) ? 'receiptLine' : 'uiLabel', text: text.replace(/\bN\b/g, '3') });
  }
  return out;
}

export function collectStaticStrings(): StaticString[] {
  return [...collectRegistryStrings(), ...collectSourceStrings()];
}
