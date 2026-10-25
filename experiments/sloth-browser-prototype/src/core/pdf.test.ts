import { describe, expect, it } from 'vitest';
import { makePdf } from '../test/pdf-fixture';
import { extractPdfText, PdfError, type PdfLib } from './pdf';

async function lib(): Promise<PdfLib> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLib;
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof PdfError ? e.code : 'other'),
  );

describe('extractPdfText (real pdf.js, generated fixture PDFs)', () => {
  it('extracts text page by page, joined with form feeds', async () => {
    const result = await extractPdfText(
      makePdf([
        'Unit 1 Kinematics describes motion using displacement and velocity.',
        'Unit 2 Dynamics relates force, mass and acceleration in closed systems.',
      ]),
      await lib(),
    );
    expect(result.pageCount).toBe(2);
    const pages = result.text.split('\f');
    expect(pages[0]).toContain('Kinematics describes motion');
    expect(pages[1]).toContain('Dynamics relates force');
    expect(result.lowTextPages).toBe(0);
  });
  it('rejects non-PDF data before parsing', async () => {
    expect(
      await code(
        extractPdfText(
          new TextEncoder().encode('hello world, not a pdf').buffer as ArrayBuffer,
          await lib(),
        ),
      ),
    ).toBe('NOT_PDF');
  });
  it('rejects oversized files', async () => {
    expect(await code(extractPdfText(new ArrayBuffer(11 * 1024 * 1024), await lib()))).toBe(
      'TOO_LARGE',
    );
  });
  it('rejects a PDF header on a broken file as unreadable', async () => {
    expect(
      await code(
        extractPdfText(
          new TextEncoder().encode('%PDF-1.4 garbage garbage').buffer as ArrayBuffer,
          await lib(),
        ),
      ),
    ).toBe('UNREADABLE');
  });
  it('reports a PDF with no text layer clearly', async () => {
    expect(await code(extractPdfText(makePdf(['', '']), await lib()))).toBe('NO_TEXT');
  });
  it('rejects too many pages', async () => {
    const many = Array.from(
      { length: 61 },
      (_, i) => `Page ${i} has some words on it for the test.`,
    );
    expect(await code(extractPdfText(makePdf(many), await lib()))).toBe('TOO_MANY_PAGES');
  });
});
