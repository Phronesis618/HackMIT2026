import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAIL_SCORE,
  KIND_SPECS,
  collectBibleNames,
  formatRepairFeedback,
  lintProse,
  lintRecipeText,
  type ProseKind,
  type ProseRule,
} from '../../src/shared/prose';

const ROOT = join(__dirname, '..', '..');
const WRITING = readFileSync(join(ROOT, 'docs', 'WRITING.md'), 'utf8');

interface DocExample {
  verdict: 'DO' | "DON'T";
  kind: ProseKind;
  rule?: ProseRule;
  text: string;
}

function parseDocExamples(md: string): DocExample[] {
  const out: DocExample[] = [];
  const re = /^(DO|DON'T) · kind=(\w+)(?: · rule=([\w-]+))?\n> (.+)$/gm;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    out.push({ verdict: m[1] as DocExample['verdict'], kind: m[2] as ProseKind, rule: m[3] as ProseRule | undefined, text: m[4]! });
  }
  return out;
}

const DOC_BIBLE: unknown = JSON.parse(/```json bible\n([\s\S]+?)\n```/.exec(WRITING)![1]!);
const DOC_EXAMPLES = parseDocExamples(WRITING);

interface Exemplar {
  id: string;
  kind: ProseKind;
  world: string;
  author?: string;
  bibleRefs: string[];
  title?: string;
  source?: string;
  name?: string;
  text: string;
}
interface ExemplarFile {
  world: string;
  bible: unknown;
  exemplars: Exemplar[];
}

const EXEMPLAR_DIR = join(ROOT, 'prompts', 'exemplars');
const EXEMPLAR_FILES: ExemplarFile[] = readdirSync(EXEMPLAR_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(EXEMPLAR_DIR, f), 'utf8')) as ExemplarFile);

describe('docs/WRITING.md examples', () => {
  it('has a DO and a DON\'T for every player-facing text type', () => {
    const kinds: ProseKind[] = [
      'worldTitle', 'tagline', 'biomeName', 'biomeTagline', 'roomLine', 'relic', 'remains', 'boonName',
      'boonDescription', 'itemBlurb', 'enemyBlurb', 'bossCallout', 'skillNode', 'uiLabel', 'receiptLine',
      'debriefLine', 'npcLine',
    ];
    for (const kind of kinds) {
      expect(DOC_EXAMPLES.some((e) => e.kind === kind && e.verdict === 'DO'), `DO for ${kind}`).toBe(true);
    }
    expect(DOC_EXAMPLES.filter((e) => e.verdict === "DON'T").length).toBeGreaterThanOrEqual(28);
    for (const e of DOC_EXAMPLES) expect(KIND_SPECS[e.kind], e.kind).toBeDefined();
  });

  for (const e of DOC_EXAMPLES.filter((x) => x.verdict === "DON'T")) {
    it(`DON'T fails on ${e.rule}: ${e.text.slice(0, 50)}`, () => {
      const r = lintProse(e.text, { kind: e.kind, bible: DOC_BIBLE });
      expect(r.hardFail).toBe(true);
      expect(r.issues.map((i) => i.rule)).toContain(e.rule);
    });
  }

  for (const e of DOC_EXAMPLES.filter((x) => x.verdict === 'DO')) {
    it(`DO passes (${e.kind}): ${e.text.slice(0, 50)}`, () => {
      const r = lintProse(e.text, { kind: e.kind, bible: DOC_BIBLE });
      expect(r.issues.filter((i) => i.severity === 'hard'), JSON.stringify(r.issues)).toEqual([]);
      expect(r.score, JSON.stringify(r.issues)).toBeLessThan(DEFAULT_FAIL_SCORE);
    });
  }
});

describe('prompts/exemplars', () => {
  it('covers at least 3 worlds and 8 exemplars per major text type', () => {
    expect(EXEMPLAR_FILES.length).toBeGreaterThanOrEqual(3);
    const all = EXEMPLAR_FILES.flatMap((f) => f.exemplars);
    for (const kind of ['relic', 'remains', 'roomLine', 'boonDescription', 'itemBlurb', 'biomeTagline', 'bossCallout'] as const) {
      expect(all.filter((e) => e.kind === kind).length, kind).toBeGreaterThanOrEqual(8);
    }
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  for (const file of EXEMPLAR_FILES) {
    for (const ex of file.exemplars) {
      it(`${ex.id} passes`, () => {
        const r = lintProse(ex.text, { kind: ex.kind, bible: file.bible });
        expect(r.hardFail, JSON.stringify(r.issues)).toBe(false);
        expect(ex.bibleRefs.length).toBeGreaterThan(0);
        if (ex.title) expect(lintProse(ex.title, { kind: 'loreTitle' }).hardFail).toBe(false);
        if (ex.source) expect(lintProse(ex.source, { kind: 'loreSource' }).hardFail).toBe(false);
        if (ex.name) {
          const nameKind: ProseKind = ex.kind === 'biomeTagline' ? 'biomeName' : ex.kind === 'itemBlurb' ? 'itemName' : 'boonName';
          expect(lintProse(ex.name, { kind: nameKind }).hardFail).toBe(false);
        }
      });
    }
  }

  it('does not give the relic exemplars a shared rhythm', () => {
    const relics = EXEMPLAR_FILES.flatMap((f) => f.exemplars).filter((e) => e.kind === 'relic');
    const sentenceCounts = new Set(relics.map((e) => e.text.split(/(?<=[.!?])\s+/).length));
    const openers = new Set(relics.map((e) => e.text.split(/\s+/)[0]!.toLowerCase()));
    expect(sentenceCounts.size).toBeGreaterThanOrEqual(4);
    expect(openers.size).toBeGreaterThanOrEqual(Math.ceil(relics.length * 0.6));
  });
});

describe('rules', () => {
  const issueRules = (text: string, kind: ProseKind, bible?: unknown): string[] => lintProse(text, { kind, bible }).issues.map((i) => i.rule);
  const hard = (text: string, kind: ProseKind, bible?: unknown): string[] =>
    lintProse(text, { kind, bible }).issues.filter((i) => i.severity === 'hard').map((i) => i.rule);

  it('stock-phrase is a hard fail', () => {
    expect(hard('The pump is a testament to her stubbornness.', 'relic')).toContain('stock-phrase');
    expect(hard('He could not help but count the crates again.', 'relic')).toContain('stock-phrase');
  });

  it('not-x-but-y: hard forms and the innocent imperative', () => {
    expect(hard('It is not a door, it is a mouth.', 'relic')).toContain('not-x-but-y');
    expect(hard("The valve wasn't broken; it was waiting.", 'relic')).toContain('not-x-but-y');
    expect(hard('Not just a wrench but a key to the pump.', 'relic')).toContain('not-x-but-y');
    expect(issueRules('Do not water the terminals. Do not open crate 4.', 'relic')).not.toContain('not-x-but-y');
    expect(issueRules('Pump 6 is not running. Tarn pulled fuse 12 at 03:10.', 'relic')).not.toContain('not-x-but-y');
  });

  it('no-player-feelings is hard everywhere, mechanical "you" is fine', () => {
    expect(hard('You feel the floor shake.', 'roomLine')).toContain('no-player-feelings');
    expect(hard('Your heart races near the vault.', 'itemBlurb')).toContain('no-player-feelings');
    expect(issueRules('Vanish: enemies lose you and you move 40% faster.', 'skillNode')).toEqual([]);
  });

  it('no-player-actions is hard in a room line', () => {
    expect(hard('As you enter, two loaders turn from the hatch.', 'roomLine')).toContain('no-player-actions');
  });

  it('no-ominous-closer catches the abstract last line and spares the concrete one', () => {
    expect(hard('Nine lanterns on the dry path, lit at 18:00. The dark waits.', 'relic')).toContain('no-ominous-closer');
    expect(hard('The roster lists 41 names. Nothing remains.', 'relic')).toContain('no-ominous-closer');
    expect(hard('The roster lists 41 names. 38 are struck through.', 'relic')).not.toContain('no-ominous-closer');
    expect(hard('Cut trunk 4 first. Then run.', 'relic')).not.toContain('no-ominous-closer');
  });

  it('personified-abstraction ignores people and bible names', () => {
    expect(issueRules('The sea remembers every diver.', 'relic')).toContain('personified-abstraction');
    expect(issueRules('The quartermaster remembers every diver.', 'relic')).not.toContain('personified-abstraction');
    expect(issueRules('The Registrar refused the claim.', 'relic', { people: [{ name: 'The Registrar' }] })).not.toContain('personified-abstraction');
  });

  it('structural warnings: copula, trailing -ing, triad, em dash, hedge, simile, aphorism', () => {
    expect(issueRules('The hatch serves as a door for the night shift.', 'relic')).toContain('copula-avoidance');
    expect(issueRules('The flaps keep turning, revealing nothing at all.', 'relic')).toContain('trailing-ing');
    expect(issueRules('The ward was cold, quiet, and empty of beds.', 'relic')).toContain('triad');
    expect(issueRules('Gone. Lost. Forgotten.', 'relic')).toContain('triad');
    expect(issueRules('Pump 6 — the old one — ran hot — again.', 'relic')).toContain('em-dash');
    expect(issueRules('The lamp blinks as if it expects an answer.', 'relic')).toContain('hedge');
    expect(issueRules('The flaps turn like a mouth practising a word.', 'relic')).toContain('simile');
    expect(issueRules('Every satchel recovered is a delivery owed.', 'boonDescription')).toContain('aphorism');
  });

  it('skips structural rules for mechanical text', () => {
    expect(lintProse('Blast every enemy around you: damage, stun and knockback.', { kind: 'skillNode' }).issues).toEqual([]);
  });

  it('slop-name only fires on capitalised names', () => {
    expect(hard('Elara signed the roster.', 'relic')).toContain('slop-name');
    expect(hard('A nova lamp, 40 watts.', 'relic')).not.toContain('slop-name');
  });

  it('specificity: lore needs a bible noun and a number or object', () => {
    const bible = { people: [{ name: 'Oda Brandt' }], places: ['Stores Cage B'] };
    expect(hard('They left in a hurry and did not come back for their coats.', 'relic', bible)).toContain('needs-bible-noun');
    expect(hard('Brandt left in a hurry and did not come back for her coat.', 'relic', bible)).toEqual([]);
    expect(hard('They left, and all that was good left with them.', 'relic')).toContain('needs-specific');
    expect(hard('They left in a hurry.', 'relic')).not.toContain('needs-bible-noun');
  });

  it('abstract-heavy compares abstractions with objects, numbers and names', () => {
    expect(issueRules('Hope and memory are the price of silence here.', 'relic')).toContain('abstract-heavy');
    expect(issueRules('Hope is 40 gasket kits in a locked cage.', 'relic')).not.toContain('abstract-heavy');
  });

  it('length: contract limit is hard, house target is a warning', () => {
    expect(hard('x'.repeat(81), 'tagline')).toContain('too-long');
    const r = lintProse('Seabed pump station with 260 crew on the roster and 48 accounted for today.', { kind: 'tagline' });
    expect(r.issues.map((i) => i.rule)).toContain('over-target');
    expect(r.hardFail).toBe(false);
  });

  it('failScore is configurable and lenient mode never hard-fails on a pattern alone', () => {
    const text = 'Lanterns glow over the faint outline of nine crates.';
    expect(lintProse(text, { kind: 'roomLine' }).hardFail).toBe(true);
    expect(lintProse(text, { kind: 'roomLine', failScore: 90 }).hardFail).toBe(false);
    const lenient = lintProse('You feel the floor shake under crate 9.', { kind: 'roomLine', lenient: true, failScore: 101 });
    expect(lenient.hardFail).toBe(false);
    expect(lenient.score).toBeGreaterThan(0);
  });

  it('keeps in-world vocabulary legal', () => {
    for (const text of [
      'Beacon marks the relic on the cracked pedestal. Static on the radio since 04:00.',
      'Sentinel frame by the neon sign, armor plate 3 missing. Pulse rifle, 12 rounds.',
    ]) {
      expect(lintProse(text, { kind: 'roomLine' }).issues.filter((i) => i.rule === 'slop-word')).toEqual([]);
    }
  });
});

describe('advice and recipe walking', () => {
  it('advice names the rule and quotes the offending text', () => {
    const r = lintProse('The gauge reads 14 at the low mark. The sea remembers.', { kind: 'relic' });
    const closer = r.issues.find((i) => i.rule === 'no-ominous-closer')!;
    expect(closer.advice).toMatch(/^Rule no-ominous-closer: last sentence "The sea remembers\."/);
    expect(closer.advice.length).toBeLessThan(220);
    expect(formatRepairFeedback(r).length).toBeLessThanOrEqual(4);
    expect(formatRepairFeedback(r)[0]).toContain('Rule ');
  });

  it('collectBibleNames reads names, places and objects', () => {
    const names = collectBibleNames(DOC_BIBLE);
    expect(names).toContain('Oda Brandt');
    expect(names).toContain('Pump 6');
    expect(names).toContain("Tarn's red wrench");
    expect(collectBibleNames(['Varga', 'Gate 2'])).toEqual(['Varga', 'Gate 2']);
  });

  it('lintRecipeText walks a fixture and returns path-prefixed feedback', () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'worlds', 'root-archive.json'), 'utf8')) as unknown;
    const r = lintRecipeText(fixture);
    expect(r.fields.length).toBeGreaterThan(20);
    expect(r.fields.some((f) => f.path === 'lore[0].text' && f.kind === 'relic')).toBe(true);
    expect(r.fields.some((f) => f.kind === 'remains')).toBe(true);
    for (const line of r.feedback) expect(line).toMatch(/^[\w.[\]]+: Rule [\w-]+:/);
  });

  it('lintRecipeText accepts the floors shape and tolerates junk', () => {
    const r = lintRecipeText({
      title: 'Halloran Deep',
      bible: DOC_BIBLE,
      biomes: [{ name: 'Deck 4 Mess', tagline: 'Where the deep keeps its secrets.', rooms: [{ name: 'Galley', description: 'Two loaders by the hatch.' }] }],
      lore: [{ kind: 'relic', title: 'Ledger', source: 'a ledger', text: 'Brandt issued 40 gasket kits on Day 11.' }],
    });
    expect(r.hardFail).toBe(true);
    expect(r.failedFields).toBe(1);
    expect(r.feedback[0]).toMatch(/^biomes\[0\]\.tagline: Rule stock-phrase/);
    expect(lintRecipeText(null).fields).toEqual([]);
    expect(lintRecipeText({ lore: 'nope', rooms: [3] }).fields).toEqual([]);
  });
});

describe('performance', () => {
  it('lints 200 fragments in under 50 ms', () => {
    const fragment =
      'Stores Cage B, Day 11. Issued to Pump 6: gasket kits, 40. Remaining: 0. Tarn signed with grease on the pen again. I asked the Director where the next 40 come from. She asked me to stop writing questions in the ledger.';
    for (let i = 0; i < 20; i += 1) lintProse(fragment, { kind: 'relic', bible: DOC_BIBLE });
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) lintProse(`${fragment} Entry ${i}.`, { kind: 'relic', bible: DOC_BIBLE });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
