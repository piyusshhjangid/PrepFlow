/**
 * Rates how directly a verified quote supports the topic name. This is a conservative explanation
 * signal for students, not a topic-quality score and never a reason to discard verified evidence.
 */
export type EvidenceSupport = 'direct' | 'nearby' | 'weak';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'basic',
  'basics',
  'introduction',
  'intro',
  'overview',
  'part',
  'other',
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
  'using',
  'use',
  'how',
  'what',
  'why',
]);
const BLOCK_START =
  /^(?:(?:week|unit|chapter|module|lecture|lesson|section|part|topic|session|day|block)\s*\d+[a-z]?|\d+(?:\.\d+)*[.)])\s*[:.\-–—)]*\s*.+|[-*•●]\s+.+|#{1,6}\s+.+$/i;

function words(text: string): string[] {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function similarWord(a: string, b: string): boolean {
  if (a === b) return true;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= Math.max(4, Math.min(a.length, b.length) - 2);
}

function coverage(topicWords: string[], text: string): number {
  if (topicWords.length === 0) return 0;
  const passageWords = words(text);
  return (
    topicWords.filter((word) => passageWords.some((candidate) => similarWord(word, candidate)))
      .length / topicWords.length
  );
}

function paragraphAround(source: string, start: number, end: number): string {
  const lineStart = (at: number) =>
    Math.max(source.lastIndexOf('\n', at - 1), source.lastIndexOf('\f', at - 1)) + 1;
  const lineEnd = (at: number) => {
    const stops = [source.indexOf('\n', at), source.indexOf('\f', at)].filter(
      (index) => index !== -1,
    );
    return stops.length ? Math.min(...stops) : source.length;
  };
  const line = (from: number) => source.slice(from, lineEnd(from)).trim();
  let from = lineStart(start);
  while (from > 0 && !BLOCK_START.test(line(from))) {
    const previous = lineStart(from - 1);
    if (!line(previous)) break;
    from = previous;
  }
  let to = lineEnd(Math.max(start, end - 1));
  while (to < source.length && source[to] !== '\f') {
    const next = to + 1;
    if (next >= source.length || !line(next) || BLOCK_START.test(line(next))) break;
    to = lineEnd(next);
  }
  if (to - from > 1200) {
    from = Math.max(from, start - 400);
    to = Math.min(to, end + 400);
  }
  return source.slice(from, to);
}

const IMPORTANCE_CUES = [
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

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('. ', index), text.lastIndexOf('\n', index)) + 1;
  const endMatch = text.slice(index).search(/[.!?](?:\s|$)|\n/);
  const end = endMatch === -1 ? text.length : index + endMatch + 1;
  const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

export function extractImportanceSentences(source: string): string[] {
  return source
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => IMPORTANCE_CUES.some((cue) => cue.test(sentence)));
}

/** Returns a short, verbatim source sentence that explicitly signals exam importance, if one exists. */
export function findImportanceCue(
  source: string,
  start: number,
  end: number,
  topicName: string,
  importanceSentences = extractImportanceSentences(source),
): string | null {
  const paragraph = paragraphAround(source, start, end);
  const topicWords = words(topicName);
  for (const cue of IMPORTANCE_CUES) {
    const match = cue.exec(paragraph);
    if (match && coverage(topicWords, paragraph) >= 0.5)
      return sentenceAround(paragraph, match.index);
  }
  if (topicWords.length === 0) return null;
  for (const sentence of importanceSentences) {
    if (coverage(topicWords, sentence) >= 0.5) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      return clean.length > 200 ? `${clean.slice(0, 197)}…` : clean;
    }
  }
  return null;
}

/** Offsets are UTF-16 offsets into the original, extracted material. */
export function classifyEvidenceSupport(
  topicName: string,
  quote: string,
  source: string,
  start: number,
  end: number,
): EvidenceSupport {
  const topicWords = words(topicName);
  if (topicWords.length === 0) return 'nearby';
  if (coverage(topicWords, quote) >= 0.5) return 'direct';
  if (coverage(topicWords, paragraphAround(source, start, end)) >= 0.5) return 'nearby';
  return 'weak';
}

export const EVIDENCE_SUPPORT_TEXT: Record<EvidenceSupport, string> = {
  direct: 'The quote itself uses the topic’s words.',
  nearby: 'The topic’s words appear in the same paragraph as the quote.',
  weak: 'The quote is verified in your material, but it does not clearly connect to this topic. Review it before relying on the topic.',
};
