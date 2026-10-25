import { MIN_MATERIAL_CHARS } from '../ai/chunk';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;

export type PdfErrorCode =
  'NOT_PDF' | 'TOO_LARGE' | 'TOO_MANY_PAGES' | 'NO_TEXT' | 'ENCRYPTED' | 'UNREADABLE';

const MESSAGES: Record<PdfErrorCode, string> = {
  NOT_PDF: 'That file is not a PDF. Choose a .pdf file, or paste the text instead.',
  TOO_LARGE: `That PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB. Split it, or paste the chapters you need.`,
  TOO_MANY_PAGES: `That PDF has more than ${MAX_PDF_PAGES} pages. Split it, or paste the chapters you need.`,
  NO_TEXT:
    'No readable text was found. This PDF may be scanned images, which this app cannot read. Paste the text instead.',
  ENCRYPTED: 'That PDF is password-protected. Remove the password, or paste the text instead.',
  UNREADABLE: 'That PDF could not be read. It may be damaged. Paste the text instead.',
};

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PdfError';
    this.code = code;
  }
}

/** The small part of pdf.js this app uses, so the extractor can be tested without a browser. */
export interface PdfLib {
  getDocument(source: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
      }>;
      destroy?(): Promise<void>;
    }>;
  };
}

export interface ExtractedPdf {
  /** Pages joined by a form feed (\f), so a page number can be derived from a character offset. */
  text: string;
  pageCount: number;
  lowTextPages: number;
}

export async function extractPdfText(data: ArrayBuffer, lib: PdfLib): Promise<ExtractedPdf> {
  if (data.byteLength > MAX_PDF_BYTES) throw new PdfError('TOO_LARGE');
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(5, data.byteLength)));
  if (head !== '%PDF-') throw new PdfError('NOT_PDF');

  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  } catch (error) {
    throw new PdfError(
      (error as { name?: string })?.name === 'PasswordException' ? 'ENCRYPTED' : 'UNREADABLE',
    );
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new PdfError('TOO_MANY_PAGES');
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items
          .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ' '))
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/ {2,}/g, ' ')
          .trim(),
      );
    }
    const text = pages.join('\f');
    if (text.replace(/\s/g, '').length < MIN_MATERIAL_CHARS / 2) throw new PdfError('NO_TEXT');
    return {
      text,
      pageCount: pages.length,
      lowTextPages: pages.filter((p) => p.length < 20).length,
    };
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError('UNREADABLE');
  } finally {
    await doc.destroy?.().catch(() => undefined);
  }
}
