import { startsBlock } from './lines';
import { normalizeName } from './topics';
import type { Level, Support } from './types';

/** Words that say nothing about which topic a passage is about. */
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'basics',
  'basic',
  'introduction',
  'intro',
  'overview',
  'more',
  'part',
  'other',
  'misc',
  'general',
  'notes',
  'week',
  'unit',
  'chapter',
  'section',
  'topic',
  'topics',
  'review',
  'summary',
  'some',
  'how',
  'what',
  'why',
  'using',
  'use',
]);

/** Lower-case content words of a topic name or passage (3+ letters, no filler words). */
export function contentWords(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/**
 * Loose stem match: the words share a long common prefix. "joins" matches "join", "normalization"
 * matches "normal", "aggregate" matches "aggregation". It is deliberately generous because it only
 * decides whether to show a warning, never whether to hide a topic.
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= Math.max(4, Math.min(a.length, b.length) - 2);
}

const MAX_BLOCK = 1200;

/**
 * The item of the material that a passage belongs to: the lines from the previous blank line or item start
 * ("Week 4 - …", a bullet, a heading) to the next one. In a list of weekly entries that is the single entry;
 * in wrapped prose (such as extracted PDF text) it is the whole paragraph.
 */
export function paragraphAround(
  source: string,
  start: number,
  end: number,
): { text: string; offset: number } {
  // A page break (form feed) ends a line like a newline does, and a block never continues across one.
  const lineStart = (i: number) =>
    Math.max(source.lastIndexOf('\n', i - 1), source.lastIndexOf('\f', i - 1)) + 1;
  const lineEnd = (i: number) => {
    const ends = [source.indexOf('\n', i), source.indexOf('\f', i)].filter((n) => n !== -1);
    return ends.length === 0 ? source.length : Math.min(...ends);
  };
  const lineText = (from: number) => source.slice(from, lineEnd(from)).trim();

  let from = lineStart(start);
  while (from > 0 && !startsBlock(lineText(from)) && source[from - 1] !== '\f') {
    const prev = lineStart(from - 1);
    if (lineText(prev) === '') break;
    from = prev;
  }
  let to = lineEnd(Math.max(start, end - 1));
  while (to < source.length && source[to] !== '\f') {
    const next = to + 1;
    if (next >= source.length) break;
    const text = lineText(next);
    if (!text || startsBlock(text)) break;
    to = lineEnd(next);
  }
  if (to - from > MAX_BLOCK) {
    from = Math.max(from, start - MAX_BLOCK / 3);
    to = Math.min(to, end + MAX_BLOCK / 3);
  }
  return { text: source.slice(from, to), offset: from };
}

function coverage(words: string[], haystack: string[]): number {
  if (words.length === 0) return 0;
  const hit = words.filter((w) => haystack.some((h) => wordsMatch(w, h))).length;
  return hit / words.length;
}

/**
 * `direct`: at least half of the topic name's content words occur in the quote itself.
 * `nearby`: they occur elsewhere in the same paragraph. `weak`: they occur in neither, so the quote is
 * genuinely in the material but does not obviously talk about this topic.
 */
export function supportOf(
  name: string,
  quote: string,
  source: string,
  start: number,
  end: number,
): Support {
  const words = contentWords(name);
  if (words.length === 0) return 'nearby';
  if (coverage(words, contentWords(quote)) >= 0.5) return 'direct';
  const para = paragraphAround(source, start, end).text;
  if (coverage(words, contentWords(para)) >= 0.5) return 'nearby';
  return 'weak';
}

export const SUPPORT_TEXT: Record<Support, string> = {
  direct: 'The quote itself uses the topic’s words.',
  nearby: 'The topic’s words appear in the same paragraph as the quote, not in the quote itself.',
  weak: 'The quote is in your material, but neither it nor its paragraph uses the topic’s words. Read it before trusting this topic.',
};

const CUES: RegExp[] = [
  /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent\b|per cent\b)/i,
  /\b\d{1,3}\s+marks?\b/i,
  /\bweight(?:ed|ing|s)?\b/i,
  /\bworth\b/i,
  /\b(?:very |most |highly |particularly )?important\b/i,
  /\bfrequently (?:examined|tested|asked|assessed)\b/i,
  /\bwill (?:be )?(?:examined|tested|assessed|on the exam)\b/i,
  /\bmust (?:know|be able)\b/i,
  /\bessential\b/i,
  /\bkey (?:topic|concept|idea|skill)s?\b/i,
  /\(core\)|\bcore (?:topic|item|material|concept)s?\b/i,
  /\b(?:most|often|always|usually) (?:often )?(?:examined|tested|assessed)\b/i,
];

function sentenceAround(text: string, i: number): string {
  const from = Math.max(text.lastIndexOf('. ', i), text.lastIndexOf('\n', i)) + 1;
  const nextStop = text.slice(i).search(/[.!?](?:\s|$)|\n/);
  const to = nextStop === -1 ? text.length : i + nextStop + 1;
  const sentence = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

/**
 * Looks for wording that signals the topic matters (marks, weighting, "important", "(core)"…), first in the
 * item the evidence belongs to, then, if a topic name is given, in any sentence of the material that both
 * signals importance and uses the topic's words (so "Cache and virtual memory are most often examined" counts
 * for those two topics wherever it appears). Returns the sentence copied from the source, or null. This is
 * what lets code check the rule given to the model: "importance is high only if the material says so".
 */
export function findImportanceCue(
  source: string,
  start: number,
  end: number,
  topicName?: string,
): string | null {
  const { text } = paragraphAround(source, start, end);
  for (const re of CUES) {
    const m = re.exec(text);
    if (m) return sentenceAround(text, m.index);
  }
  const words = topicName ? contentWords(topicName) : [];
  if (words.length === 0) return null;
  for (const sentence of source.split(/(?<=[.!?])\s+|\n+/)) {
    if (!CUES.some((re) => re.test(sentence))) continue;
    if (coverage(words, contentWords(sentence)) >= 0.5) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      return clean.length > 200 ? `${clean.slice(0, 197)}…` : clean;
    }
  }
  return null;
}

export interface ImportanceDecision {
  level: Level;
  basis: 'material' | 'model' | 'default';
  cue?: string;
  downgraded: boolean;
}

/** The model may say "high"; code keeps it only when the material backs it up. */
export function decideImportance(
  suggested: Level,
  source: string,
  start: number,
  end: number,
  topicName?: string,
): ImportanceDecision {
  const cue = findImportanceCue(source, start, end, topicName);
  if (suggested === 'high') {
    return cue
      ? { level: 'high', basis: 'material', cue, downgraded: false }
      : { level: 'medium', basis: 'default', downgraded: true };
  }
  return cue
    ? { level: suggested, basis: 'model', cue, downgraded: false }
    : { level: suggested, basis: suggested === 'medium' ? 'default' : 'model', downgraded: false };
}
