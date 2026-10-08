import { describe, expect, it } from 'vitest';
import { AppError, DocumentError } from '../../errors/index.js';
import { makePdf } from '../../test/make-pdf.js';
import { PdfJsTextExtractor, mapPdfError, textItemsToString } from './pdfjs-text-extractor.js';

const extractor = new PdfJsTextExtractor();
const options = { maxPages: 100 };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('PdfJsTextExtractor (real pdfjs-dist on generated PDFs)', () => {
  it('returns one entry per physical page, in order, with each page’s own text', async () => {
    const pdf = makePdf([
      ['UNIT ONE', 'Normalization removes redundancy.'],
      ['UNIT TWO', 'Deadlocks need four conditions.'],
      ['UNIT THREE', 'Greedy algorithms pick locally.'],
    ]);
    const pages = await extractor.extract(pdf, options);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('Normalization removes redundancy.');
    expect(pages[1]).toContain('Deadlocks need four conditions.');
    expect(pages[2]).toContain('Greedy algorithms pick locally.');
    // Page boundaries are real: text never leaks across pages.
    expect(pages[0]).not.toContain('Deadlocks');
    expect(pages[1]).not.toContain('Greedy');
  });

  it('keeps a page without text as an empty entry so numbering stays correct', async () => {
    const pdf = makePdf([['Page one has text'], [], ['Page three has text']]);
    const pages = await extractor.extract(pdf, options);
    expect(pages).toHaveLength(3);
    expect(pages[1]?.trim()).toBe('');
    expect(pages[2]).toContain('Page three has text');
  });

  it('keeps line structure (one newline per text line)', async () => {
    const pages = await extractor.extract(makePdf([['first line', 'second line']]), options);
    expect(pages[0]?.trim().split('\n')).toEqual(['first line', 'second line']);
  });

  it('extracts special characters that are escaped inside PDF strings', async () => {
    const pages = await extractor.extract(makePdf([['f(x) = (a + b) \\ c']]), options);
    expect(pages[0]).toContain('f(x) = (a + b) \\ c');
  });

  it('scenario 7: rejects bytes that are not a PDF at all as PDF_UNREADABLE', async () => {
    expect(
      await codeOf(extractor.extract(Buffer.from('this is plain text, not a pdf'), options)),
    ).toBe('PDF_UNREADABLE');
  });

  it('scenario 7: rejects random binary garbage', async () => {
    const junk = Buffer.alloc(2048);
    for (let i = 0; i < junk.length; i += 1) junk[i] = (i * 31 + 7) % 256;
    expect(await codeOf(extractor.extract(junk, options))).toBe('PDF_UNREADABLE');
  });

  it('scenario 7: rejects a truncated PDF with a clear error rather than crashing', async () => {
    const pdf = makePdf([['some text on a page'], ['more text']]);
    const code = await codeOf(
      extractor.extract(pdf.subarray(0, Math.floor(pdf.length / 3)), options),
    );
    expect(code).toBe('PDF_UNREADABLE');
  });

  it('enforces the page limit before extracting text', async () => {
    const pdf = makePdf([['a'], ['b'], ['c']]);
    expect(await codeOf(extractor.extract(pdf, { maxPages: 2 }))).toBe('PDF_TOO_MANY_PAGES');
  });

  it('does not modify or retain the input buffer', async () => {
    const pdf = makePdf([['stays intact']]);
    const before = Buffer.from(pdf);
    await extractor.extract(pdf, options);
    expect(pdf.equals(before)).toBe(true);
  });
});

describe('mapPdfError', () => {
  it('maps a pdfjs PasswordException to PDF_PASSWORD_PROTECTED', () => {
    const error = new Error('No password given');
    error.name = 'PasswordException';
    expect(mapPdfError(error)).toMatchObject({ code: 'PDF_PASSWORD_PROTECTED' });
  });

  it('maps any other failure to PDF_UNREADABLE without leaking internals', () => {
    const mapped = mapPdfError(new Error('Invalid PDF structure at /secret/path'));
    expect(mapped).toMatchObject({ code: 'PDF_UNREADABLE' });
    expect(mapped.message).not.toContain('secret');
  });

  it('passes user-facing AppErrors through unchanged', () => {
    const original = new DocumentError('PDF_NO_TEXT', 'x');
    expect(mapPdfError(original)).toBe(original);
    expect(mapPdfError(original)).toBeInstanceOf(AppError);
  });
});

describe('textItemsToString', () => {
  it('concatenates items and adds a newline only at reported end-of-line', () => {
    expect(
      textItemsToString([{ str: 'Hello ' }, { str: 'world', hasEOL: true }, { str: 'Next' }, {}]),
    ).toBe('Hello world\nNext');
  });
});
