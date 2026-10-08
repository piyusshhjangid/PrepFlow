import { describe, expect, it } from 'vitest';
import { describePage, parsePageTexts, serializePages, toNormalizedPages } from './pages.js';

describe('page serializer/parser', () => {
  it('round-trips pages, including empty ones, preserving order and count', () => {
    const pages = ['First page', '', 'Third page\nwith two lines'];
    expect(parsePageTexts(serializePages(pages))).toEqual(pages);
  });

  it('round-trips a single page', () => {
    expect(parsePageTexts(serializePages(['only']))).toEqual(['only']);
  });

  it('refuses to serialize text that still contains the separator (would corrupt page numbers)', () => {
    expect(() => serializePages(['bad\fpage'])).toThrow(/normalized/);
  });

  it('numbers PDF pages from 1 as physical pages', () => {
    const pages = toNormalizedPages(serializePages(['a', '', 'c']), 'PDF');
    expect(pages.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(pages[1]?.text).toBe('');
  });

  it('treats pasted text as one page without a number', () => {
    expect(toNormalizedPages('some pasted notes', 'TEXT')).toEqual([
      { number: null, text: 'some pasted notes' },
    ]);
  });

  it('labels pages honestly: "PDF page n" for PDFs, no fake page for pasted text', () => {
    expect(describePage({ number: 14, text: '' })).toBe('PDF page 14');
    expect(describePage({ number: null, text: '' })).toBe('Detected in uploaded material');
  });
});
