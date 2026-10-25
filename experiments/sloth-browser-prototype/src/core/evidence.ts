import type { Evidence } from './types';

export const QUOTE_MIN_CHARS = 20;
export const QUOTE_MIN_WORDS = 3;
export const QUOTE_MAX_CHARS = 600;

export interface NormalizedText {
  /** Lower-cased text with whitespace collapsed, typographic quotes/dashes flattened, hyphenated line breaks joined. */
  norm: string;
  /** `map[i]` is the index in the original text of `norm[i]`. */
  map: number[];
}

const QUOTE_FLATTEN: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u00a0': ' ',
};

const isLetter = (ch: string | undefined) => !!ch && /\p{L}/u.test(ch);

/**
 * Conservative normalization used to compare a model's quote with the source. It only ignores differences that
 * PDF extraction and typing introduce (case, whitespace, curly quotes, line-break hyphenation). It does not
 * ignore words, so approximate similarity is never accepted as proof.
 */
export function normalizeWithMap(source: string): NormalizedText {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i++) {
    let ch = source[i]!;
    if (ch === '\u00ad' || ch === '\u200b' || ch === '\ufeff') continue;
    if (ch === '-' && isLetter(source[i - 1])) {
      let j = i + 1;
      while (j < source.length && /[ \t\r]/.test(source[j]!)) j++;
      if (source[j] === '\n') {
        let k = j + 1;
        while (k < source.length && /[ \t\r]/.test(source[k]!)) k++;
        if (isLetter(source[k])) {
          i = k - 1;
          continue;
        }
      }
    }
    ch = QUOTE_FLATTEN[ch] ?? ch;
    if (/\s/.test(ch)) {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      norm += ' ';
      map.push(i);
      pendingSpace = false;
    }
    for (const c of ch.toLowerCase()) {
      norm += c;
      map.push(i);
    }
  }
  return { norm, map };
}

export type EvidenceFailure = 'empty' | 'too-short' | 'too-long' | 'ellipsis' | 'not-found';

export type EvidenceResult =
  { ok: true; evidence: Evidence } | { ok: false; reason: EvidenceFailure };

export function pageOf(source: string, index: number): number | null {
  if (!source.includes('\f')) return null;
  let page = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\f') page++;
  return page;
}

/** Strips the quotation marks a model often wraps around a quote. */
function unwrap(quote: string): string {
  return quote
    .trim()
    .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
    .trim();
}

export function verifyQuote(
  quote: string,
  source: string,
  prepared?: NormalizedText,
): EvidenceResult {
  const cleaned = unwrap(quote);
  if (!cleaned) return { ok: false, reason: 'empty' };
  if (/\u2026|\.{3}/.test(cleaned)) return { ok: false, reason: 'ellipsis' };
  const q = normalizeWithMap(cleaned).norm;
  const words = q.split(' ').filter(Boolean).length;
  if (q.length < QUOTE_MIN_CHARS || words < QUOTE_MIN_WORDS)
    return { ok: false, reason: 'too-short' };
  if (q.length > QUOTE_MAX_CHARS) return { ok: false, reason: 'too-long' };
  const { norm, map } = prepared ?? normalizeWithMap(source);
  const at = norm.indexOf(q);
  if (at === -1) return { ok: false, reason: 'not-found' };
  const start = map[at]!;
  const lastIndex = map[at + q.length - 1]!;
  let end = lastIndex + 1;
  // A surrogate pair maps to two indices; keep the whole pair.
  if (end < source.length && /[\ud800-\udbff]/.test(source[lastIndex]!)) end++;
  return {
    ok: true,
    evidence: { quote: source.slice(start, end), start, end, page: pageOf(source, start) },
  };
}

export const EVIDENCE_FAILURE_TEXT: Record<EvidenceFailure, string> = {
  empty: 'the model gave no source quote',
  'too-short': 'the quote was too short to prove anything',
  'too-long': 'the quote was too long',
  ellipsis: 'the quote contained an ellipsis, so it is not one contiguous passage',
  'not-found': 'the quote does not appear in your material',
};
