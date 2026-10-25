import { describe, expect, it } from 'vitest';
import { normalizeWithMap, verifyQuote } from './evidence';

const source = [
  'Unit 3: Thermodynamics\n',
  'The first law states that energy can be neither created nor de-\nstroyed, only converted.\n',
  'It’s “conserved” in every closed system.\f',
  'Page two begins here with the second law of thermodynamics.',
].join('');

describe('verifyQuote', () => {
  it('accepts an exact passage and returns the SOURCE text, not the model’s', () => {
    const r = verifyQuote('the first law states that energy can be neither created', source);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evidence.quote).toBe('The first law states that energy can be neither created');
      expect(source.slice(r.evidence.start, r.evidence.end)).toBe(r.evidence.quote);
      expect(r.evidence.page).toBe(1);
    }
  });
  it('tolerates line-break hyphenation, curly quotes and whitespace', () => {
    expect(verifyQuote('neither created nor destroyed, only converted.', source).ok).toBe(true);
    expect(verifyQuote('It\'s "conserved" in every closed system.', source).ok).toBe(true);
    expect(verifyQuote('first   law\nstates that energy can', source).ok).toBe(true);
  });
  it('derives the page from the text, never from the model', () => {
    const r = verifyQuote('Page two begins here with the second law', source);
    expect(r.ok && r.evidence.page).toBe(2);
  });
  it('strips wrapping quotation marks', () => {
    expect(verifyQuote('"The first law states that energy can be"', source).ok).toBe(true);
  });
  it('rejects text that is not in the source, even if it is close', () => {
    expect(verifyQuote('The first law states that energy can be freely created', source)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(verifyQuote('the second law states that entropy always increases', source)).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });
  it('rejects empty, short, long and ellipsis quotes', () => {
    expect(verifyQuote('   ', source)).toEqual({ ok: false, reason: 'empty' });
    expect(verifyQuote('first law', source)).toEqual({ ok: false, reason: 'too-short' });
    expect(verifyQuote('energy ... destroyed, only converted', source)).toEqual({
      ok: false,
      reason: 'ellipsis',
    });
    expect(verifyQuote('energy… destroyed, only converted', source)).toEqual({
      ok: false,
      reason: 'ellipsis',
    });
    expect(verifyQuote('word '.repeat(200), 'word '.repeat(300))).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });
  it('does not treat unrelated words that merely share letters as a match', () => {
    expect(verifyQuote('the law of the first states energy', source).ok).toBe(false);
  });
  it('keeps an index map consistent with the original text', () => {
    const { norm, map } = normalizeWithMap('A  b\nc');
    expect(norm).toBe('a b c');
    expect(map).toHaveLength(norm.length);
  });
  it('is case-insensitive', () => {
    expect(verifyQuote('UNIT 3: THERMODYNAMICS', source).ok).toBe(true);
  });
});
