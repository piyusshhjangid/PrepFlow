import { describe, expect, it } from 'vitest';
import { serializePages } from '../../domain/documents/pages.js';
import { chunkMaterials } from './chunker.js';
import { normalizeWithMap, prepareChunk, verifyQuote } from './evidence.js';

const config = { targetChars: 20_000, maxChars: 25_000, maxChunks: 40 };

function chunkOf(pages: string[]) {
  const [chunk] = chunkMaterials(
    [{ id: 'm1', contentHash: 'h', sourceType: 'PDF', extractedText: serializePages(pages) }],
    config,
  );
  if (!chunk) throw new Error('no chunk');
  return chunk;
}
const check = (pages: string[], quote: string) => {
  const chunk = chunkOf(pages);
  return verifyQuote(chunk, prepareChunk(chunk), quote);
};

describe('verifyQuote', () => {
  const page1 =
    'Introduction to algorithms and data structures.\n\nA stack is a last in first out collection of elements.';
  const page2 = 'A queue is a first in first out collection of elements used in scheduling.';

  it('accepts an exact quote and derives the page itself', () => {
    const r = check([page1, page2], 'A queue is a first in first out collection');
    expect(r).toMatchObject({ ok: true, evidence: { page: 2, pageEnd: null, materialId: 'm1' } });
  });

  it('returns the canonical source text, not the model rendering', () => {
    const r = check([page1], 'a STACK is a last in first out collection');
    expect(r.ok && r.evidence.snippet).toBe('A stack is a last in first out collection');
  });

  it('is tolerant to whitespace, case, curly quotes and dashes', () => {
    const r = check(
      ['The “critical-section” problem — mutual exclusion  between   processes.'],
      'the "critical-section" problem - mutual exclusion between processes',
    );
    expect(r.ok).toBe(true);
  });

  it('matches across line-break hyphenation (algo-\\nrithm)', () => {
    const r = check(
      ['An algo-\nrithm is a finite sequence of well defined steps.'],
      'An algorithm is a finite sequence of well defined steps',
    );
    expect(r.ok).toBe(true);
    // The stored snippet is real source text
    expect(r.ok && r.evidence.snippet).toContain('algo-\nrithm');
  });

  it('matches letter-to-letter hyphenation and soft hyphens', () => {
    expect(
      check(
        ['Data struc\u00ADtures are ways of organi-zing information efficiently.'],
        'Data structures are ways of organizing information efficiently',
      ).ok,
    ).toBe(true);
  });

  it('does not treat a spaced dash as hyphenation', () => {
    expect(
      check(
        ['alpha - beta gamma delta epsilon zeta eta theta'],
        'alphabeta gamma delta epsilon zeta eta',
      ).ok,
    ).toBe(false);
  });

  it('reports a page span when the quote crosses a page break', () => {
    const r = check(
      [
        'The scheduler selects the next process from the',
        'ready queue according to the chosen policy.',
      ],
      'selects the next process from the ready queue according to the chosen policy',
    );
    expect(r).toMatchObject({ ok: true, evidence: { page: 1, pageEnd: 2 } });
  });

  it('rejects invented text', () => {
    expect(check([page1], 'A heap is a complete binary tree used for priority queues')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('rejects fake ellipsis, short quotes and long quotes', () => {
    expect(check([page1], 'A stack is ... a collection of elements')).toEqual({
      ok: false,
      reason: 'ELLIPSIS',
    });
    expect(check([page1], 'A stack is a last…first out')).toEqual({
      ok: false,
      reason: 'ELLIPSIS',
    });
    expect(check([page1], 'A stack is')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(check([page1], 'x'.repeat(700))).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('does not match unrelated text just because words are shared', () => {
    expect(check([page1], 'last in first out stack elements collection of a')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});

describe('normalizeWithMap', () => {
  it('maps normalized characters back to original offsets', () => {
    const text = 'Ab\u00AD  Cd';
    const norm = normalizeWithMap(text);
    expect(norm.map((c) => c.ch).join('')).toBe('ab cd');
    expect(text.slice(norm[0]?.start, norm.at(-1)?.end)).toBe(text);
  });
  it('expands ligatures through NFKC', () => {
    expect(
      normalizeWithMap('ﬁnite ﬂow')
        .map((c) => c.ch)
        .join(''),
    ).toBe('finite flow');
  });
});
