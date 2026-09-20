/**
 * Every player-facing STATIC string is held to docs/WRITING.md by the same linter the live
 * pipeline uses: zero hard fails. The linter only catches patterns; the strings were also read
 * by an editor (docs/design/VISION_AUDIT.md). This test keeps new UI text from regressing.
 */
import { describe, expect, it } from 'vitest';
import { lintProse } from '../../src/shared/prose';
import { collectRegistryStrings, collectSourceStrings, extractSourceStrings, UI_SOURCE_FILES } from './static-prose-collector';

const failures = (strings: ReturnType<typeof collectRegistryStrings>): string[] =>
  strings
    .map((s) => ({ s, result: lintProse(s.text, { kind: s.kind }) }))
    .filter(({ result }) => result.hardFail)
    .map(({ s, result }) => `${s.source}: "${s.text}" -> ${result.issues.filter((i) => i.severity === 'hard').map((i) => i.rule).join(', ') || `score ${result.score}`}`);

describe('static player-facing prose', () => {
  it('registries, hub cues and engine-derived floor text have zero hard fails', () => {
    const strings = collectRegistryStrings();
    expect(strings.length).toBeGreaterThan(250);
    expect(failures(strings)).toEqual([]);
  });

  it('UI literals and chronicle memory templates have zero hard fails', () => {
    const strings = collectSourceStrings();
    expect(strings.length).toBeGreaterThan(200);
    expect(failures(strings)).toEqual([]);
  });

  it('the source scan finds real UI text and skips code', () => {
    const all = UI_SOURCE_FILES.flatMap((file) => extractSourceStrings(file));
    expect(all).toContain('Prepare world');
    expect(all).toContain('Buy a node and its effect applies at once, for you only. Attunements are written by the world you are in. Nodes marked planned are not in the game yet.');
    expect(all.filter((text) => /=>|className|^export /.test(text))).toEqual([]);
  });

  it('static text carries no em dashes and none of the lines the audit removed', () => {
    const all = [...collectRegistryStrings(), ...collectSourceStrings()].map((s) => s.text);
    expect(all.filter((text) => /—/.test(text))).toEqual([]);
    expect(all.filter((text) => /who you will be next|sanctuary between worlds|signal that remains|promise of a way back/i.test(text))).toEqual([]);
  });
});
