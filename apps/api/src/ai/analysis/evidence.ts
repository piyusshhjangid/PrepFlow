import type { Chunk } from './chunker.js';

/**
 * Evidence verification. The model returns `{ chunkId, quote }`. The application decides whether the
 * quote really occurs in that chunk, finds where, derives the page(s) itself, and keeps the
 * canonical source text. Nothing the model says about pages or locations is ever used.
 */

export const EVIDENCE_LIMITS = {
  /** Minimum length of a quote after normalization. Short quotes match too easily. */
  minQuoteChars: 20,
  /** Minimum number of word-like tokens. */
  minQuoteWords: 3,
  maxQuoteChars: 600,
  /** Stored snippet length cap. */
  maxSnippetChars: 500,
} as const;

interface NormChar {
  ch: string;
  /** Offsets of the original code units this character came from: [start, end). */
  start: number;
  end: number;
  /** Space that came from whitespace containing a line break. */
  newline: boolean;
}

const QUOTE_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u2032': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2033': '"',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
};
const INVISIBLE_CHARS = new Set(['\u00AD', '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);
const LETTER = /^\p{L}$/u;

/**
 * Conservative normalization used for BOTH the source and the quote, keeping a map back to the
 * original text. Handles Unicode forms (NFKC), soft hyphens and zero-width characters, typographic
 * quotes/dashes, case, whitespace runs, and hyphenation: a hyphen between two letters is removed when
 * it is directly attached to both letters ("algo-rithm") or when it ends a line and the word
 * continues on the next ("algo-\nrithm"). A spaced dash ("a - b") is untouched.
 */
export function normalizeWithMap(text: string): NormChar[] {
  // Pass 1: per-character canonicalization with a map to original offsets.
  const pass1: NormChar[] = [];
  let index = 0;
  for (const original of text) {
    const start = index;
    index += original.length;
    if (INVISIBLE_CHARS.has(original)) continue;
    const mapped = QUOTE_MAP[original] ?? original;
    for (const piece of mapped.normalize('NFKC')) {
      const lowered = piece.toLowerCase();
      if (/^\s$/u.test(lowered))
        pass1.push({
          ch: ' ',
          start,
          end: index,
          newline: /[\n\r\f\v\u2028\u2029]/.test(original),
        });
      else for (const c of lowered) pass1.push({ ch: c, start, end: index, newline: false });
    }
  }
  // Pass 2: collapse whitespace runs (remember if the run contained a line break).
  const pass2: NormChar[] = [];
  for (const item of pass1) {
    const last = pass2.at(-1);
    if (item.ch === ' ' && last?.ch === ' ') {
      last.end = item.end;
      last.newline = last.newline || item.newline;
    } else pass2.push({ ...item });
  }
  // Pass 3: remove line-break and in-word hyphenation.
  const out: NormChar[] = [];
  for (let i = 0; i < pass2.length; i++) {
    const item = pass2[i] as NormChar;
    const prev = out.at(-1);
    if (item.ch === '-' && prev && LETTER.test(prev.ch)) {
      const next = pass2[i + 1];
      if (next && LETTER.test(next.ch)) continue; // algo-rithm
      const afterSpace = pass2[i + 2];
      if (next?.ch === ' ' && next.newline && afterSpace && LETTER.test(afterSpace.ch)) {
        i += 1; // algo-\nrithm: drop the hyphen and the line break
        continue;
      }
    }
    out.push(item);
  }
  while (out[0]?.ch === ' ') out.shift();
  while (out.at(-1)?.ch === ' ') out.pop();
  return out;
}

export type EvidenceRejection =
  'UNKNOWN_CHUNK' | 'TOO_SHORT' | 'TOO_LONG' | 'ELLIPSIS' | 'NOT_FOUND';

export interface VerifiedEvidence {
  chunkId: string;
  materialId: string;
  /** First PDF page the quote touches (1-based), or null for pasted text. */
  page: number | null;
  /** Last page, when the quote spans a page break. */
  pageEnd: number | null;
  /** Canonical text taken from the source, not the model's rendering of it. */
  snippet: string;
}

export type EvidenceResult =
  { ok: true; evidence: VerifiedEvidence } | { ok: false; reason: EvidenceRejection };

const ELLIPSIS = /(\.{2,}|\u2026|\[\s*\.{2,}\s*\]|\[\s*\u2026\s*\])/;

export function verifyQuote(
  chunk: Chunk,
  chunkSource: readonly NormChar[],
  quote: string,
): EvidenceResult {
  if (ELLIPSIS.test(quote)) return { ok: false, reason: 'ELLIPSIS' };
  const normQuote = normalizeWithMap(quote)
    .map((c) => c.ch)
    .join('');
  if (normQuote.length > EVIDENCE_LIMITS.maxQuoteChars) return { ok: false, reason: 'TOO_LONG' };
  const words = normQuote.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    normQuote.length < EVIDENCE_LIMITS.minQuoteChars ||
    words.length < EVIDENCE_LIMITS.minQuoteWords
  )
    return { ok: false, reason: 'TOO_SHORT' };

  const haystack = chunkSource.map((c) => c.ch).join('');
  const at = haystack.indexOf(normQuote);
  if (at === -1) return { ok: false, reason: 'NOT_FOUND' };

  const first = chunkSource[at] as NormChar;
  const last = chunkSource[at + normQuote.length - 1] as NormChar;
  const startOffset = first.start;
  const endOffset = last.end;
  const snippet = chunk.text
    .slice(startOffset, endOffset)
    // Whitespace runs collapse, but a line break is kept as one: it is what makes "algo-\nrithm"
    // recognizable as hyphenation when this snippet is verified again against the full material.
    .replace(/\s+/g, (run) => (/[\n\r\f]/.test(run) ? '\n' : ' '))
    .trim()
    .slice(0, EVIDENCE_LIMITS.maxSnippetChars);

  // Pages come from where the text really is, never from the model.
  const seg = (offset: number) =>
    chunk.segments.find((s) => offset >= s.chunkStart && offset < s.chunkStart + s.text.length) ??
    chunk.segments.reduce(
      (best, s) => (s.chunkStart <= offset ? s : best),
      chunk.segments[0] as Chunk['segments'][number],
    );
  const startPage = seg(startOffset).page;
  const endPage = seg(Math.max(startOffset, endOffset - 1)).page;
  return {
    ok: true,
    evidence: {
      chunkId: chunk.id,
      materialId: chunk.materialId,
      page: startPage,
      pageEnd: endPage !== startPage ? endPage : null,
      snippet,
    },
  };
}

/** Pre-normalizes a chunk once so many quotes can be checked against it cheaply. */
export function prepareChunk(chunk: Chunk): readonly NormChar[] {
  return normalizeWithMap(chunk.text);
}
