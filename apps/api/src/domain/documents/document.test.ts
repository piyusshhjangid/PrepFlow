import { DEFAULT_MATERIAL_LIMITS, type MaterialLimits } from '@prepflow/shared';
import { describe, expect, it } from 'vitest';
import { buildPdfDocument, buildTextDocument } from './document.js';
import { parsePageTexts } from './pages.js';

const limits: MaterialLimits = DEFAULT_MATERIAL_LIMITS;
const para = (word: string, n = 12) => Array.from({ length: n }, () => word).join(' ');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('buildTextDocument', () => {
  it('normalizes and builds a single-page document', () => {
    const doc = buildTextDocument(`Unit 1\r\n\r\n\r\n${para('normalization')}`, limits);
    expect(doc.sourceType).toBe('TEXT');
    expect(doc.pageCount).toBeNull();
    expect(doc.lowTextPageCount).toBeNull();
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.number).toBeNull();
    expect(doc.storedText).not.toContain('\r');
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scenario 4: rejects empty or near-empty input', () => {
    expect(codeOf(() => buildTextDocument('', limits))).toBe('TEXT_TOO_SHORT');
    expect(codeOf(() => buildTextDocument('   \n\n  ', limits))).toBe('TEXT_TOO_SHORT');
    expect(codeOf(() => buildTextDocument('too short', limits))).toBe('TEXT_TOO_SHORT');
  });

  it('enforces the configured character limit', () => {
    const small: MaterialLimits = { ...limits, maxChars: 100 };
    expect(codeOf(() => buildTextDocument(para('abcdefgh', 30), small))).toBe('DOCUMENT_TOO_LONG');
    expect(codeOf(() => buildTextDocument(para('abcdefgh', 8), small))).toBeUndefined();
  });

  it('gives identical content an identical hash regardless of formatting noise', () => {
    const a = buildTextDocument(para('deadlock'), limits);
    const b = buildTextDocument(`  ${para('deadlock').replace(/ /g, '   ')}\r\n\r\n\r\n`, limits);
    expect(b.contentHash).toBe(a.contentHash);
  });
});

describe('buildPdfDocument', () => {
  const pages = [para('alpha'), para('beta'), para('gamma')];

  it('builds a page-aware document with physical page numbers', () => {
    const doc = buildPdfDocument(pages, 'notes.pdf', limits);
    expect(doc.sourceType).toBe('PDF');
    expect(doc.filename).toBe('notes.pdf');
    expect(doc.pageCount).toBe(3);
    expect(doc.lowTextPageCount).toBe(0);
    expect(doc.pages.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(parsePageTexts(doc.storedText)).toEqual(pages);
  });

  it('keeps pages with little text but counts and reports them', () => {
    const doc = buildPdfDocument([para('alpha'), '14', '', para('gamma')], 'notes.pdf', limits);
    expect(doc.pageCount).toBe(4);
    expect(doc.lowTextPageCount).toBe(2);
    expect(parsePageTexts(doc.storedText)).toHaveLength(4); // nothing dropped, numbering intact
  });

  it('rejects a PDF with no usable text as PDF_NO_TEXT (not "scanned")', () => {
    expect(codeOf(() => buildPdfDocument(['', '', ''], 'x.pdf', limits))).toBe('PDF_NO_TEXT');
    // Page numbers only: every page is below the per-page threshold, so still no usable text.
    const numbersOnly = Array.from({ length: 30 }, (_, i) => String(i + 1));
    expect(codeOf(() => buildPdfDocument(numbersOnly, 'x.pdf', limits))).toBe('PDF_NO_TEXT');
  });

  it('enforces page and character limits', () => {
    expect(codeOf(() => buildPdfDocument(pages, 'x.pdf', { ...limits, maxPdfPages: 2 }))).toBe(
      'PDF_TOO_MANY_PAGES',
    );
    expect(codeOf(() => buildPdfDocument(pages, 'x.pdf', { ...limits, maxChars: 50 }))).toBe(
      'DOCUMENT_TOO_LONG',
    );
  });
});
