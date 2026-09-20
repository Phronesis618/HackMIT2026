/**
 * Every string the onboarding layer can author passes the house linter and George Fan's
 * eight-word budget (docs/WRITING.md, docs/design/ONBOARDING.md §3).
 *
 * World-written halves — a terrain skin's name, a law's name and the engine's law effect —
 * are linted where they are produced (`lintRecipeText` in the generation pipeline), not here.
 * What is tested here is that joining them cannot overflow the band.
 */
import { describe, expect, it } from 'vitest';
import { lintProse } from '../../src/shared/prose';
import { allAuthoredStrings, lawLine, terrainLine } from '../../src/client/onboarding';
import { HUB_TEXT, NOTE_TEXT, ROOM_KIND_TEXT, RUN_TEXT, MAX_LINE } from '../../src/client/onboarding/text';
import { LESSONS } from '../../src/client/onboarding/lessons';

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

describe('onboarding prose', () => {
  it('passes lintProse as a UI label, with no hard issue and no score', () => {
    for (const line of allAuthoredStrings()) {
      const result = lintProse(line, { kind: 'uiLabel' });
      expect(result.hardFail, `${line} -> ${result.issues.map((i) => i.rule).join(', ')}`).toBe(false);
      expect(result.score, line).toBe(0);
    }
  });

  it('keeps every prompt inside the eight-to-ten word budget', () => {
    const prompts = [
      ...Object.values(HUB_TEXT), ...Object.values(RUN_TEXT),
      ...Object.values(NOTE_TEXT), ...Object.values(ROOM_KIND_TEXT),
    ];
    for (const line of prompts) expect(wordCount(line), line).toBeLessThanOrEqual(10);
  });

  it('never tells the player what they feel and never uses a slop name', () => {
    for (const line of allAuthoredStrings()) {
      expect(line.toLowerCase()).not.toMatch(/\byou (?:feel|sense|realise|realize)\b/);
      expect(line).not.toMatch(/whisper|echo|ancient|forgotten|mysterious/i);
    }
  });

  it('takes the world\'s own name for a terrain feature when it has one', () => {
    expect(terrainLine('hazard_floor', 'Deck plating')).toBe('Deck plating: the burn ramps while you stand in it');
    expect(terrainLine('hazard_floor')).toBe('Scalding floor: the burn ramps while you stand in it');
    expect(terrainLine('hazard_floor', '   ')).toBe('Scalding floor: the burn ramps while you stand in it');
  });

  it('falls back to the engine name when the world\'s name would overflow the band', () => {
    const long = terrainLine('hazard_floor', 'The Twenty Eight Character Name Of A Very Long Plate');
    expect(long.length).toBeLessThanOrEqual(MAX_LINE);
    expect(long.startsWith('Scalding floor')).toBe(true);
  });

  it('keeps one rule per law line, and clips on a word boundary if even that is long', () => {
    // The engine states several numbers in separate sentences; the band takes the first.
    expect(lawLine('Rated for 400', 'Enemy groups 1.8x size, up to 12 per room. Enemy health 1.15x.'))
      .toBe('Rated for 400: Enemy groups 1.8x size, up to 12 per room.');
    expect(lawLine('Long Echo', 'Attacks reach 15% further.')).toBe('Long Echo: Attacks reach 15% further.');
    const long = lawLine('Thin Air', 'Movement speed 200 to 260 and dash cooldown 900 ms to 720 ms across the whole floor');
    expect(long.length).toBeLessThanOrEqual(MAX_LINE);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('Thin Air: Movement speed')).toBe(true);
  });

  it('gives every lesson an id, a group and a priority, and no duplicate ids', () => {
    const ids = LESSONS.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const lesson of LESSONS) {
      expect(lesson.id).toMatch(/^[a-z]+\.[a-z_.]+$/);
      expect(lesson.priority).toBeGreaterThan(0);
      expect(lesson.holdMs).toBeGreaterThanOrEqual(0);
    }
  });
});
