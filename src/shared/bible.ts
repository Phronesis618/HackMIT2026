/**
 * World bible — structured facts written BEFORE any prose, never shown to players.
 *
 * Owner: agent W2 (writing pipeline). Spec: docs/WRITING.md sections 2 and 3.
 * Every player-facing string of a generated world is derived from this: each lore
 * fragment is BY one of the three authors ABOUT one event (`authorIndex`, `eventIndex`),
 * and the prose linter (`src/shared/prose.ts`) hard-fails lore that names nothing in it.
 *
 * Pure Zod + types, no server imports. Every key is required (nullable where needed) so
 * the same shapes can be sent to a provider's strict structured-output mode.
 */
import { z } from 'zod';
import { ENEMY_IDS } from './registry';
import { ROOM_KINDS } from './floors';

const line = (max: number) => z.string().trim().min(1).max(max);

export const BIBLE_AUTHOR_COUNT = 3;
export const BIBLE_MAX_EVENTS = 7;

export const BiblePersonSchema = z.object({
  name: line(40),
  job: line(60),
  /** A concrete want: a transfer, a balanced count, a letter back. */
  want: line(120),
});
export type BiblePerson = z.infer<typeof BiblePersonSchema>;

export const BibleEventSchema = z.object({
  /** In-world date or time in the world's own format: "Day 11", "14 March, 22:10". */
  date: line(40),
  /** One flat past-tense sentence with a name and a number in it. */
  fact: line(200),
});
export type BibleEvent = z.infer<typeof BibleEventSchema>;

export const BibleAuthorSchema = z.object({
  /** Must be one of `people[].name` (checked by WorldBibleSchema). */
  name: line(40),
  /** The physical thing they write in: "stores ledger", "letters to Aunt Dessa". */
  document: line(60),
  /** Three or four observable habits: what they count, sentence length, a verbal tic. */
  register: line(200),
  /** What this person would never write. */
  never: line(120),
});
export type BibleAuthor = z.infer<typeof BibleAuthorSchema>;

export const BibleEnemySchema = z.object({
  enemyId: z.enum(ENEMY_IDS),
  /** What this creature's job was before the collapse: "Deck 4 loaders in cargo frames". */
  formerJob: line(100),
});

export const WorldBibleSchema = z
  .object({
    /** One flat sentence: what this place was for. */
    premise: line(200),
    /** One cause: a named person, a decision, a date. No mystery forces. */
    collapse: line(400),
    people: z.array(BiblePersonSchema).min(3).max(4),
    places: z.array(line(40)).min(2).max(5),
    objects: z.array(line(40)).min(2).max(5),
    events: z.array(BibleEventSchema).min(5).max(BIBLE_MAX_EVENTS),
    authors: z.array(BibleAuthorSchema).length(BIBLE_AUTHOR_COUNT),
    enemies: z.array(BibleEnemySchema).max(ENEMY_IDS.length),
  })
  .superRefine((bible, ctx) => {
    const people = new Set(bible.people.map((person) => person.name.toLowerCase()));
    bible.authors.forEach((author, index) => {
      // The controller/machine author of a world must also be listed under people.
      if (!people.has(author.name.toLowerCase())) {
        ctx.addIssue({ code: 'custom', path: ['authors', index, 'name'], message: 'author must be one of people[].name' });
      }
    });
    if (new Set(bible.authors.map((author) => author.name.toLowerCase())).size !== bible.authors.length) {
      ctx.addIssue({ code: 'custom', path: ['authors'], message: 'the three authors must be different people' });
    }
    if (new Set(bible.enemies.map((enemy) => enemy.enemyId)).size !== bible.enemies.length) {
      ctx.addIssue({ code: 'custom', path: ['enemies'], message: 'one entry per enemy kind' });
    }
  });
export type WorldBible = z.infer<typeof WorldBibleSchema>;

/** Optional, additive fields on a lore fragment: who wrote it and which event it reports. */
export const LoreRefsShape = {
  /** Index into `bible.authors` (0..2). Null/absent on legacy fragments. */
  authorIndex: z.number().int().min(0).max(BIBLE_AUTHOR_COUNT - 1).nullable().optional(),
  /** Index into `bible.events` (0..6). Null/absent on legacy fragments. */
  eventIndex: z.number().int().min(0).max(BIBLE_MAX_EVENTS - 1).nullable().optional(),
};

/**
 * Per-biome room lines: one short line per room kind, shown when a room of that kind is
 * entered in that biome. PROPOSED SLOT (additive): `BiomeBrief` has no text beyond name and
 * tagline, so these ride beside the briefs in `WorldRecipe.biomeRoomLines`, keyed by biome id.
 * `shop` is reserved and never requested from the model.
 */
export const BIOME_LINE_KINDS = ROOM_KINDS.filter((kind) => kind !== 'shop');
export const BiomeRoomLineSchema = z.object({
  kind: z.enum(ROOM_KINDS),
  text: z.string().trim().min(1).max(140),
});
export const BiomeRoomLinesSchema = z.object({
  biomeId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/),
  lines: z.array(BiomeRoomLineSchema).max(ROOM_KINDS.length),
});
export type BiomeRoomLines = z.infer<typeof BiomeRoomLinesSchema>;
export const BiomeRoomLinesListSchema = z.array(BiomeRoomLinesSchema).max(8);

/** References must point inside the bible; out-of-range refs are cleared, never fatal. */
export function clampLoreRefs<T extends { authorIndex?: number | null; eventIndex?: number | null }>(fragment: T, bible: WorldBible | undefined): T {
  if (!bible) return fragment;
  const authorIndex = fragment.authorIndex != null && fragment.authorIndex < bible.authors.length ? fragment.authorIndex : null;
  const eventIndex = fragment.eventIndex != null && fragment.eventIndex < bible.events.length ? fragment.eventIndex : null;
  return { ...fragment, authorIndex, eventIndex };
}
