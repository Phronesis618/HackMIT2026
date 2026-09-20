/**
 * Prose linter for RELAY. Enforces docs/WRITING.md on every string a player reads,
 * whether a human typed it or the model wrote it at runtime.
 *
 * Pure functions, no I/O, no dependencies. Safe to import from server, client and tests.
 *
 *   lintProse(text, { kind, bible? })  -> ProseLintResult
 *   lintRecipeText(recipeLike, opts?)  -> RecipeLintResult   (walks the known text fields)
 *   formatRepairFeedback(result)       -> string[]           (lines to hand back to the model)
 *
 * Two severities. `hard` is reserved for patterns with no innocent reading (stock phrases,
 * "not X but Y", telling the player what they feel, the abstract one-line closer, a lore
 * fragment that names nothing from its world). Everything else adds points to `score`.
 * A text fails when it has a hard issue or when `score >= failScore` (default 30).
 *
 * The slop part of the score follows the EQ-Bench slop score weighting
 * (https://eqbench.com/slop-score.html): 60% slop words, 25% not-x-but-y, 15% stock
 * phrases, each as a rate per 100 words. Structural and specificity rules add on top.
 */
import {
  ABSTRACT_NOUNS,
  CONCRETE_NOUNS,
  MENTAL_VERBS,
  NUMBER_WORDS,
  PERSON_NOUNS,
  SLOP_NAMES,
  SLOP_PHRASES,
  SLOP_WORDS_STRONG,
  SLOP_WORDS_WEAK,
} from './prose-data';

export type ProseKind =
  | 'worldTitle'
  | 'tagline'
  | 'themeSummary'
  | 'biomeName'
  | 'biomeTagline'
  | 'roomName'
  | 'roomLine'
  | 'loreTitle'
  | 'loreSource'
  | 'relic'
  | 'remains'
  | 'boonName'
  | 'boonDescription'
  | 'itemName'
  | 'itemBlurb'
  | 'enemyName'
  | 'enemyBlurb'
  | 'bossName'
  | 'bossCallout'
  | 'skillNode'
  | 'uiLabel'
  | 'receiptLine'
  | 'debriefLine'
  | 'npcLine'
  | 'generic';

export type ProseRule =
  | 'stock-phrase'
  | 'slop-word'
  | 'slop-name'
  | 'not-x-but-y'
  | 'no-player-feelings'
  | 'no-player-actions'
  | 'no-ominous-closer'
  | 'personified-abstraction'
  | 'copula-avoidance'
  | 'trailing-ing'
  | 'triad'
  | 'em-dash'
  | 'hedge'
  | 'simile'
  | 'aphorism'
  | 'abstract-heavy'
  | 'needs-bible-noun'
  | 'needs-specific'
  | 'too-long'
  | 'over-target';

export type ProseSeverity = 'hard' | 'warn';

export interface ProseIssue {
  rule: ProseRule;
  severity: ProseSeverity;
  /** The offending span, trimmed to 80 characters. */
  excerpt: string;
  /** One sentence, written to be pasted into a repair prompt as-is. */
  advice: string;
  /** Points this issue adds to `score` (0 for hard issues; they fail on their own). */
  points: number;
}

export interface ProseLintResult {
  /** 0..100. Slop score plus structural points. Lower is better. */
  score: number;
  /** The EQ-Bench-style component alone, 0..100. */
  slopScore: number;
  hardFail: boolean;
  issues: ProseIssue[];
  words: number;
}

/**
 * The world bible, or anything shaped roughly like it. The linter only needs the proper
 * nouns, so it walks the value and collects every string stored under `name`, plus string
 * arrays under `names`, `people`, `places`, `objects`. A plain string[] also works.
 */
export type ProseBible = unknown;

export interface ProseLintOptions {
  kind: ProseKind;
  bible?: ProseBible;
  /** Fail when score reaches this. Default 30. */
  failScore?: number;
  /** Turn the hard rules into 25-point warnings (for reporting on legacy text). */
  lenient?: boolean;
}

export const DEFAULT_FAIL_SCORE = 30;

interface KindSpec {
  /** Contract maximum (hard). */
  max: number;
  /** House target (warn). */
  target: number;
  /** Narrative prose: structural rules apply in full. */
  prose: boolean;
  /** Must name a bible noun (when a bible is supplied) and carry a number or object. */
  lore: boolean;
  /** Must carry a number, a physical object or a bible noun. */
  needsSpecific: boolean;
  /** Second person is normal here ("you move 40% faster"). */
  allowsYou: boolean;
}

const K = (max: number, target: number, prose: boolean, lore: boolean, needsSpecific: boolean, allowsYou: boolean): KindSpec => ({
  max, target, prose, lore, needsSpecific, allowsYou,
});

/** Length limits come from src/shared/contracts.ts; targets from docs/WRITING.md. */
export const KIND_SPECS: Record<ProseKind, KindSpec> = {
  worldTitle: K(40, 28, false, false, false, false),
  tagline: K(80, 70, true, false, true, false),
  themeSummary: K(240, 160, true, false, true, false),
  biomeName: K(40, 28, false, false, false, false),
  biomeTagline: K(80, 70, true, false, true, false),
  roomName: K(40, 28, false, false, false, false),
  roomLine: K(300, 100, true, false, true, false),
  loreTitle: K(40, 32, false, false, false, false),
  loreSource: K(60, 60, false, false, false, false),
  relic: K(520, 400, true, true, true, false),
  remains: K(520, 320, true, true, true, false),
  boonName: K(40, 28, false, false, false, false),
  boonDescription: K(160, 120, true, true, true, true),
  itemName: K(40, 28, false, false, false, false),
  itemBlurb: K(160, 140, true, false, true, true),
  enemyName: K(40, 24, false, false, false, false),
  enemyBlurb: K(160, 120, true, false, true, false),
  bossName: K(40, 32, false, false, false, false),
  bossCallout: K(60, 52, true, false, true, true),
  skillNode: K(160, 110, false, false, false, true),
  uiLabel: K(120, 60, false, false, false, true),
  receiptLine: K(200, 140, true, false, false, false),
  debriefLine: K(200, 120, true, false, true, false),
  npcLine: K(160, 110, true, false, false, true),
  generic: K(2000, 2000, true, false, false, true),
};

// ---------------------------------------------------------------------------
// Precompiled tables
// ---------------------------------------------------------------------------

const STRONG = new Set(SLOP_WORDS_STRONG);
const WEAK = new Set(SLOP_WORDS_WEAK);
const NAMES = new Set(SLOP_NAMES);
const ABSTRACT = new Set(ABSTRACT_NOUNS);
const CONCRETE = new Set(CONCRETE_NOUNS);
const PERSONS = new Set(PERSON_NOUNS);
const MENTAL = new Set(MENTAL_VERBS);
const NUMBERS = new Set(NUMBER_WORDS);

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const DIGIT_RE = /\d/;
const SENTENCE_SPLIT_RE = /(?<=[.!?])["')\]]*\s+(?=["'(\[]?[A-Z0-9])/;

/** Each entry: regex, whether it is unambiguous enough to hard-fail. */
const NXBY_PATTERNS: ReadonlyArray<readonly [RegExp, boolean]> = [
  // "is not X, but Y" / "was not X; it was Y" / "isn't a lamp. It's an argument."
  [/\b(?:is|are|was|were|am|be|been)\s+(?:not|never|no longer)\s+(?:just\s+|only\s+|merely\s+|simply\s+)?[^.;:!?]{2,70}?(?:[,;:]|\.|\s[-–—])\s*(?:but\b|it(?:'s|\s+is|\s+was)\b|they(?:'re|\s+are|\s+were)\b|he(?:'s|\s+is|\s+was)\b|she(?:'s|\s+is|\s+was)\b|this\s+(?:is|was)\b|that\s+(?:is|was)\b)/i, true],
  [/\b(?:isn't|wasn't|aren't|weren't)\s+(?:just\s+|only\s+|merely\s+)?[^.;:!?]{2,70}?(?:[,;:]|\.|\s[-–—])\s*(?:but\b|it(?:'s|\s+is|\s+was)\b|they(?:'re|\s+are|\s+were)\b)/i, true],
  [/\bnot\s+(?:just|only|merely|simply)\b[^.!?]{2,70}?\bbut\b/i, true],
  [/\bno longer\s+(?:just\s+)?an?\b[^.!?]{2,60}?\bbut\b/i, true],
  [/\bstop(?:s|ped)?\s+(?:being\s+)?\w+[^.;!?]{0,40}?\band\s+start(?:s|ed)?\s+(?:being\s+)?\w+/i, true],
  [/\bless\s+an?\s+\w+[^.!?]{0,30}?\bthan\s+an?\s+\w+/i, true],
  [/\bno\s+\w+[,.]\s+no\s+\w+[,.]\s+(?:just|only)\b/i, true],
  // Softer forms: counted, scored, not fatal.
  [/\bnot\s+[^.!?,;]{3,50},?\s+but\s+(?!also\b)/i, false],
  [/\brather than\b/i, false],
  [/\bstop(?:s|ped)?\s+being\b/i, false],
];

const PLAYER_FEELING_RE = /\byou(?:r)?\s+(?:can\s+)?(?:feel|feels|felt|sense|sensed|can't help|cannot help|realise|realize|realised|realized|remember|wonder|shiver|shudder|find yourself|are filled|are struck|know that|know where|know what|understand|suspect|fear)\b|\byour\s+(?:heart|skin|spine|blood|breath|stomach|mind|pulse)\b|\bfills? you with\b|\bmakes? you (?:feel|wonder|uneasy)\b/i;
const PLAYER_ACTION_RE = /\bas you\b|\byou\s+(?:enter|step|walk|approach|arrive|see|notice|spot|find|hear|smell|look|glance|turn|open|reach|descend|climb|emerge|stand)\b/i;

const COPULA_RE = /\b(?:serves?|served|stands?|stood|acts?|acted|functions?|functioned|operates?)\s+as\s+(?:an?|the)\b|\bstands?\s+testament\b|\brepresents\s+(?:an?|the)\b|\bmarks\s+(?:an?|the)\s+(?:end|beginning|moment|turning)\b/i;

const SIGNIFICANCE_ING = 'highlighting|underscoring|reflecting|revealing|reminding|marking|casting|echoing|hinting|suggesting|symbolising|symbolizing|signalling|signaling|proving|showing|leaving|making|turning|trying|waiting|searching|looking|settling|promising|whispering|begging|daring|refusing|drawing|painting|filling|lending|giving|bathing';
const TRAILING_ING_RE = new RegExp(`,\\s+(?:\\w+ly\\s+)?(?:${SIGNIFICANCE_ING})\\b[^.!?]*[.!?]?$`, 'i');

const HEDGE_RE = /\bas if\b|\bas though\b|\bseem(?:s|ed|ing)?\s+to\b|\bappear(?:s|ed)?\s+to\b|\bsomehow\b|\bsomething\b|\bsomeone\b(?=\s+(?:or|else))|\ba kind of\b|\bsort of\b|\bkind of\b|\balmost\s+(?:as|like)\b|\bperhaps\b|\bwhatever\s+(?:it|they|he|she)\b|\bmight\s+(?:have\s+)?be(?:en)?\b|\bin a way\b/gi;
const SIMILE_RE = /\blike\s+(?:an?|the|some|so many)\s+\w+/gi;
const EM_DASH_RE = /—|\s--\s|\s–\s/g;
const TRIAD_RE = /\b([a-z'-]+),\s+([a-z'-]+),?\s+(?:and|or)\s+([a-z'-]+)\b/i;
const TRIPLE_BEAT_RE = /(?:^|[.!?]\s+)([A-Z][\w'-]*(?:\s+[\w'-]+){0,2}[.!?])\s+([A-Z][\w'-]*(?:\s+[\w'-]+){0,2}[.!?])\s+([A-Z][\w'-]*(?:\s+[\w'-]+){0,2}[.!?])/;
const APHORISM_RES: readonly RegExp[] = [
  /\b(?:every|each)\s+[\w'-]+(?:\s+[\w'-]+){0,4}\s+is\s+(?:an?|the)\b/i,
  /\ban?\s+([a-z'-]{3,})\b[^.!?]{0,40}?\bis\s+an?\s+\1\b/i,
  /\bwhat\s+(?:is|was)\s+\w+(?:\s+\w+){0,3}\s+(?:is|was)\s+(?:never\s+)?\w+/i,
  /\bthat is the whole of\b|\bthat was the whole of\b|\bsuch is\b|\bso it goes\b/i,
  /\b(?:some|certain)\s+(?:things|doors|debts|names|roads)\b/i,
];
const CLOSER_VERB_RE = /\b(?:remembers?|waits?|watch(?:es)?|knows?|forgets?|listens?|remains?|endures?|begins?|ends?|returns?|hungers?|sleeps?|wakes?|answers?|persists?)\b/i;
const CLOSER_OPEN_RE = /^(?:and|but|still|yet|soon|always|never|nothing|everything|only|perhaps)\b/i;

const normalise = (text: string): string =>
  text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

const clip = (s: string): string => {
  const t = s.trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
};

const singular = (w: string): string[] => {
  const out = [w];
  if (w.endsWith("'s")) out.push(w.slice(0, -2));
  if (w.endsWith('es') && w.length > 4) out.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
  return out;
};

const inSet = (set: ReadonlySet<string>, w: string): boolean => {
  if (set.has(w)) return true;
  for (const v of singular(w)) if (set.has(v)) return true;
  return false;
};

/** Collect proper nouns from a bible-shaped value. Exported for W2's prompt builder. */
export function collectBibleNames(bible: ProseBible): string[] {
  const out = new Set<string>();
  const push = (s: unknown): void => {
    if (typeof s === 'string' && s.trim().length >= 3) out.add(s.trim());
  };
  const LIST_KEYS = new Set(['names', 'people', 'places', 'objects', 'authors', 'things']);
  const walk = (v: unknown, depth: number, underList: boolean): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') {
      if (underList) push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1, underList);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'name') push(x);
        walk(x, depth + 1, LIST_KEYS.has(k));
      }
    }
  };
  if (Array.isArray(bible) && bible.every((x) => typeof x === 'string')) bible.forEach(push);
  else walk(bible, 0, false);
  return [...out];
}

const bibleCache = new WeakMap<object, RegExp | null>();
const STOP_NAME_PARTS = new Set(['the', 'and', 'for', 'von', 'van', 'del', 'old', 'new', 'of']);

function bibleRegex(bible: ProseBible): RegExp | null {
  if (bible == null) return null;
  const key = typeof bible === 'object' ? (bible as object) : null;
  if (key && bibleCache.has(key)) return bibleCache.get(key) ?? null;
  const parts = new Set<string>();
  for (const name of collectBibleNames(bible)) {
    parts.add(name.toLowerCase());
    for (const p of name.split(/[\s-]+/)) {
      const t = p.toLowerCase().replace(/[^a-z0-9']/g, '');
      if (t.length >= 4 && !STOP_NAME_PARTS.has(t) && !CONCRETE.has(t) && !NUMBERS.has(t)) parts.add(t);
    }
  }
  const re = parts.size
    ? new RegExp(`\\b(?:${[...parts].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:'s|s)?\\b`, 'i')
    : null;
  if (key) bibleCache.set(key, re);
  return re;
}

// ---------------------------------------------------------------------------
// lintProse
// ---------------------------------------------------------------------------

export function lintProse(rawText: string, options: ProseLintOptions): ProseLintResult {
  const spec = KIND_SPECS[options.kind] ?? KIND_SPECS.generic;
  const failScore = options.failScore ?? DEFAULT_FAIL_SCORE;
  const text = normalise(rawText ?? '');
  const lower = text.toLowerCase();
  const issues: ProseIssue[] = [];
  const add = (rule: ProseRule, severity: ProseSeverity, excerpt: string, advice: string, points: number): void => {
    if (severity === 'hard' && options.lenient) issues.push({ rule, severity: 'warn', excerpt: clip(excerpt), advice, points: 25 });
    else issues.push({ rule, severity, excerpt: clip(excerpt), advice, points: severity === 'hard' ? 0 : points });
  };

  const tokens = (text.match(WORD_RE) ?? []).map((t) => t.toLowerCase());
  const words = tokens.length;
  const denom = Math.max(words, 30) / 100;
  const sentences = text.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);

  // Length -----------------------------------------------------------------
  if (rawText.length > spec.max) {
    add('too-long', 'hard', `${rawText.length} chars`, `Rule too-long: ${rawText.length} characters, the limit for ${options.kind} is ${spec.max}. Cut to the one fact that matters.`, 0);
  } else if (rawText.length > spec.target) {
    add('over-target', 'warn', `${rawText.length} chars`, `Rule over-target: ${rawText.length} characters; ${options.kind} should stay under ${spec.target}. Drop the weakest clause.`, 6);
  }

  // Slop words and names ---------------------------------------------------
  let wordPoints = 0;
  const seenWords = new Set<string>();
  let abstractCount = 0;
  let concreteCount = 0;
  for (const tok of tokens) {
    if (NAMES.has(tok) && new RegExp(`\\b${tok[0]!.toUpperCase()}${tok.slice(1)}\\b`).test(text)) {
      add('slop-name', 'hard', tok, `Rule slop-name: "${tok}" is a name language models overuse. Use a person or place from the world bible.`, 0);
    }
    const strong = STRONG.has(tok);
    if (strong || inSet(WEAK, tok)) {
      wordPoints += strong ? 3 : 1;
      if (!seenWords.has(tok)) {
        seenWords.add(tok);
        add('slop-word', 'warn', tok, `Rule slop-word: replace "${tok}" with the plain name of what is physically there or what it physically does.`, 0);
      }
    }
    if (inSet(ABSTRACT, tok)) abstractCount += 1;
    if (inSet(CONCRETE, tok) || NUMBERS.has(tok)) concreteCount += 1;
  }
  const digitGroups = text.match(/\d+(?:[.,:]\d+)*/g)?.length ?? 0;
  concreteCount += digitGroups;

  // Stock phrases ----------------------------------------------------------
  let phraseHits = 0;
  for (const phrase of SLOP_PHRASES) {
    const at = lower.indexOf(phrase);
    if (at < 0) continue;
    const before = at === 0 ? ' ' : lower[at - 1]!;
    if (/[a-z]/.test(before)) continue;
    phraseHits += 1;
    add('stock-phrase', 'hard', text.slice(at, at + phrase.length), `Rule stock-phrase: "${phrase}" is a stock phrase. Delete it and state the fact it was decorating.`, 0);
  }

  // Not X but Y --------------------------------------------------------------
  let nxbyHits = 0;
  let nxbyHard = false;
  for (const [re, hard] of NXBY_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (!hard && nxbyHard) continue;
    nxbyHits += 1;
    if (hard) nxbyHard = true;
    if (hard && !spec.prose) continue;
    add(
      'not-x-but-y',
      hard ? 'hard' : 'warn',
      m[0],
      `Rule not-x-but-y: "${clip(m[0])}" sets up a thing only to deny it. Say what it is, once, and drop the denied half.`,
      hard ? 0 : 8,
    );
    if (hard) break;
  }

  const slopScore = Math.min(
    100,
    100 * (0.6 * Math.min(1, wordPoints / denom / 8) + 0.25 * Math.min(1, nxbyHits / denom / 3) + 0.15 * Math.min(1, phraseHits / denom / 3)),
  );

  // Second person ----------------------------------------------------------
  const feel = PLAYER_FEELING_RE.exec(text);
  if (feel) {
    add('no-player-feelings', 'hard', feel[0], `Rule no-player-feelings: "${feel[0]}" tells the player what they feel or know. Describe the object; the player decides how to take it.`, 0);
  }
  if (!spec.allowsYou) {
    const act = PLAYER_ACTION_RE.exec(text);
    if (act) {
      const hard = options.kind === 'roomLine' || options.kind === 'biomeTagline' || options.kind === 'tagline';
      add('no-player-actions', hard ? 'hard' : 'warn', act[0], `Rule no-player-actions: "${act[0]}" moves the player for them. Write in third person: name the thing in the room and what it is doing.`, 10);
    }
  }

  if (spec.prose) {
    // Personified abstractions ---------------------------------------------
    const bibleRe = bibleRegex(options.bible);
    let personified: string | null = null;
    let personifiedInLast = false;
    const lastSentence = sentences[sentences.length - 1] ?? '';
    const ARTICLES = /^(?:the|this|that|its|a|an)$/;
    const SKIP = /^(?:that|which|still|only|never|always|has|had|was|is|have|just|already)$/;
    for (let i = 1; i < tokens.length && !personified; i += 1) {
      const verb = tokens[i]!;
      if (!MENTAL.has(verb)) continue;
      let j = i - 1;
      while (j > 0 && SKIP.test(tokens[j]!)) j -= 1;
      const noun = tokens[j]!;
      const hasArticle = (j >= 1 && ARTICLES.test(tokens[j - 1]!)) || (j >= 2 && ARTICLES.test(tokens[j - 2]!));
      if (!hasArticle || ARTICLES.test(noun) || SKIP.test(noun)) continue;
      if (inSet(PERSONS, noun)) continue;
      if (bibleRe && bibleRe.test(noun)) continue;
      if ((verb === 'keeps' || verb === 'takes') && !inSet(ABSTRACT, noun) && !/^(?:sea|spire|tower|archive|city|station|ship|forest|machine|house|place|land|deep)$/.test(noun)) continue;
      personified = `the ${tokens.slice(j, i + 1).join(' ')}`;
      const lastLower = lastSentence.toLowerCase();
      personifiedInLast = lastLower.includes(`${noun} `) && lastLower.includes(verb);
    }
    if (personified && !(personifiedInLast && sentences.length > 1)) {
      add('personified-abstraction', 'warn', personified, `Rule personified-abstraction: "${personified}" gives a mind to a thing. Name the person who did it, or say what the thing physically does.`, 15);
    }

    // The ominous turn -----------------------------------------------------
    if (sentences.length > 1) {
      const lastTokens = (lastSentence.match(WORD_RE) ?? []).map((t) => t.toLowerCase());
      const hasSpecific =
        DIGIT_RE.test(lastSentence) ||
        lastTokens.some((t) => inSet(CONCRETE, t) || NUMBERS.has(t)) ||
        (bibleRe ? bibleRe.test(lastSentence) : false);
      const abstractLast = lastTokens.some((t) => inSet(ABSTRACT, t));
      const short = lastTokens.length <= 8;
      const closerish = abstractLast || CLOSER_VERB_RE.test(lastSentence) || CLOSER_OPEN_RE.test(lastSentence);
      if ((personified && personifiedInLast) || (short && !hasSpecific && closerish)) {
        add('no-ominous-closer', 'hard', lastSentence, `Rule no-ominous-closer: last sentence "${clip(lastSentence)}" is an abstract closer. End on a physical fact, a number or a name, or cut the sentence.`, 0);
      }
    }

    // Copula avoidance -----------------------------------------------------
    const cop = COPULA_RE.exec(text);
    if (cop) add('copula-avoidance', 'warn', cop[0], `Rule copula-avoidance: "${cop[0]}" is a dressed-up "is". Use "is", or better, a verb that says what the thing does.`, 15);

    // Trailing -ing clause -------------------------------------------------
    for (const s of sentences) {
      const m = TRAILING_ING_RE.exec(s);
      if (m) {
        add('trailing-ing', 'warn', m[0], `Rule trailing-ing: "${clip(m[0])}" is a trailing -ing clause that comments on the sentence. End the sentence at the comma, or give the clause its own subject and a finite verb.`, 10);
        break;
      }
    }

    // Triads ---------------------------------------------------------------
    const triad = TRIAD_RE.exec(text);
    const beat = TRIPLE_BEAT_RE.exec(text);
    if (beat) add('triad', 'warn', beat[0], `Rule triad: three short beats in a row ("${clip(beat[0])}"). Keep the one that carries a fact.`, 8);
    else if (triad && options.kind !== 'receiptLine' && options.kind !== 'itemBlurb' && options.kind !== 'npcLine') {
      add('triad', 'warn', triad[0], `Rule triad: "${triad[0]}" is a list of exactly three. Use one item, or two, or the real count.`, 6);
    }

    // Em dashes, hedges, similes, aphorisms --------------------------------
    const dashes = text.match(EM_DASH_RE)?.length ?? 0;
    if (dashes > 1) add('em-dash', 'warn', `${dashes} dashes`, `Rule em-dash: ${dashes} dashes. At most one per text; use a full stop.`, 6 * (dashes - 1));

    const hedges = text.match(HEDGE_RE) ?? [];
    if (hedges.length) {
      add('hedge', 'warn', hedges.join(', '), `Rule hedge: "${hedges[0]}" hedges. Commit: say what happened, or what the writer saw.`, Math.min(30, 10 * hedges.length));
    }

    const similes = text.match(SIMILE_RE) ?? [];
    if (similes.length) add('simile', 'warn', similes[0]!, `Rule simile: "${similes[0]}" compares instead of describing. Give the measurement, the material or the sound itself.`, Math.min(18, 7 * similes.length));

    for (const re of APHORISM_RES) {
      const m = re.exec(text);
      if (m) {
        add('aphorism', 'warn', m[0], `Rule aphorism: "${clip(m[0])}" is a proverb, true of any world. Replace it with a fact true only of this one.`, 12);
        break;
      }
    }

    // Abstract to concrete ratio -------------------------------------------
    const bibleHit = bibleRe ? bibleRe.test(text) : false;
    const concreteTotal = concreteCount + (bibleHit ? 1 : 0);
    if (abstractCount >= 2 && abstractCount > concreteTotal) {
      add('abstract-heavy', 'warn', `${abstractCount} abstract vs ${concreteTotal} concrete`, `Rule abstract-heavy: ${abstractCount} abstract nouns against ${concreteTotal} objects, numbers or names. Swap an abstraction for the object it stands for.`, 10);
    }

    // Specificity ----------------------------------------------------------
    if (spec.lore && bibleRe && !bibleHit) {
      add('needs-bible-noun', 'hard', clip(text), `Rule needs-bible-noun: this ${options.kind} names no person, place or object from the world bible. Name at least one.`, 0);
    }
    if (spec.needsSpecific && concreteTotal === 0) {
      add('needs-specific', spec.lore ? 'hard' : 'warn', clip(text), `Rule needs-specific: no number, date or physical object in this ${options.kind}. Add one the player could point at or count.`, 15);
    }
  }

  // In a line of 16 words or fewer, one tell is most of the line: structural points count double.
  const structural = issues.reduce((sum, i) => sum + i.points, 0) * (spec.prose && words <= 16 ? 2 : 1);
  const score = Math.min(100, Math.round((slopScore + structural) * 10) / 10);
  const hardFail = issues.some((i) => i.severity === 'hard') || score >= failScore;
  return { score, slopScore: Math.round(slopScore * 10) / 10, hardFail, issues, words };
}

// ---------------------------------------------------------------------------
// lintRecipeText
// ---------------------------------------------------------------------------

export interface RecipeFieldLint {
  /** JSON-ish path, e.g. `lore[2].text`. */
  path: string;
  kind: ProseKind;
  text: string;
  result: ProseLintResult;
}

export interface RecipeLintResult {
  /** Word-weighted mean of field scores. */
  score: number;
  hardFail: boolean;
  failedFields: number;
  fields: RecipeFieldLint[];
  /** One line per failing issue, ready for the repair prompt. */
  feedback: string[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);

/**
 * Walks a WorldRecipe-shaped object (today's 3-room recipe or the floors recipe with
 * `biomes[]`) and lints every known player-facing text field. Unknown fields are ignored,
 * so this keeps working while contracts.ts changes underneath it.
 */
export function lintRecipeText(recipeLike: unknown, options: Omit<ProseLintOptions, 'kind'> = {}): RecipeLintResult {
  const fields: RecipeFieldLint[] = [];
  const root = isRec(recipeLike) && isRec(recipeLike.recipe) ? recipeLike.recipe : recipeLike;
  if (!isRec(root)) return { score: 0, hardFail: false, failedFields: 0, fields, feedback: [] };
  const bible = options.bible ?? root.bible ?? (isRec(recipeLike) ? recipeLike.bible : undefined);
  const opts = { ...options, bible };
  const visit = (path: string, kind: ProseKind, v: unknown): void => {
    if (typeof v !== 'string' || !v.trim()) return;
    fields.push({ path, kind, text: v, result: lintProse(v, { ...opts, kind }) });
  };
  const visitRooms = (prefix: string, rooms: unknown): void => {
    arr(rooms).forEach((room, i) => {
      visit(`${prefix}rooms[${i}].name`, 'roomName', room.name);
      visit(`${prefix}rooms[${i}].description`, 'roomLine', room.description);
    });
  };

  visit('title', 'worldTitle', root.title);
  visit('tagline', 'tagline', root.tagline);
  visit('themeSummary', 'themeSummary', root.themeSummary);
  visitRooms('', root.rooms);
  arr(root.biomes).forEach((biome, b) => {
    visit(`biomes[${b}].name`, 'biomeName', biome.name);
    visit(`biomes[${b}].tagline`, 'biomeTagline', biome.tagline);
    visitRooms(`biomes[${b}].`, biome.rooms);
  });
  arr(root.lore).forEach((frag, i) => {
    visit(`lore[${i}].title`, 'loreTitle', frag.title);
    visit(`lore[${i}].source`, 'loreSource', frag.source);
    visit(`lore[${i}].text`, frag.kind === 'remains' ? 'remains' : 'relic', frag.text);
  });
  arr(root.attunements).forEach((att, i) => {
    visit(`attunements[${i}].name`, 'boonName', att.name);
    visit(`attunements[${i}].description`, 'boonDescription', att.description);
  });
  arr(root.items).forEach((item, i) => {
    visit(`items[${i}].name`, 'itemName', item.name);
    visit(`items[${i}].description`, 'itemBlurb', item.description);
  });
  const boss = root.boss;
  if (isRec(boss)) {
    visit('boss.name', 'bossName', boss.name);
    (Array.isArray(boss.callouts) ? boss.callouts : []).forEach((c, i) => visit(`boss.callouts[${i}]`, 'bossCallout', c));
  }

  let weight = 0;
  let total = 0;
  let failedFields = 0;
  const feedback: string[] = [];
  for (const f of fields) {
    const w = Math.max(f.result.words, 3);
    weight += w;
    total += f.result.score * w;
    if (!f.result.hardFail) continue;
    failedFields += 1;
    for (const line of formatRepairFeedback(f.result)) feedback.push(`${f.path}: ${line}`);
  }
  return {
    score: weight ? Math.round((total / weight) * 10) / 10 : 0,
    hardFail: failedFields > 0,
    failedFields,
    fields,
    feedback,
  };
}

/**
 * Advice lines for a failing text, hard issues first, at most `limit` (default 4): a model
 * given twelve complaints fixes none of them.
 */
export function formatRepairFeedback(result: ProseLintResult, limit = 4): string[] {
  const ranked = [...result.issues].sort((a, b) => (a.severity === b.severity ? b.points - a.points : a.severity === 'hard' ? -1 : 1));
  const out: string[] = [];
  for (const issue of ranked) {
    if (out.length >= limit) break;
    if (issue.severity === 'warn' && issue.points === 0 && issue.rule !== 'slop-word') continue;
    if (!out.includes(issue.advice)) out.push(issue.advice);
  }
  return out;
}
