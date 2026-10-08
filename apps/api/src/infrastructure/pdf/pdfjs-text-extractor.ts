import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { documentErrors } from '../../domain/documents/document-errors.js';
import { AppError } from '../../errors/index.js';
import { logger } from '../logger.js';
import type { PdfPageExtractor } from './pdf-page-extractor.js';

/** The two shapes pdfjs returns for text content items; only text items carry `str`. */
interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/** Joins pdfjs text items into page text: item text as-is, a newline where pdfjs reports end-of-line. */
export function textItemsToString(items: readonly TextItemLike[]): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out;
}

/** Converts a pdfjs failure into a user-facing DocumentError. Only the error NAME is inspected. */
export function mapPdfError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return documentErrors.pdfPasswordProtected();
  // InvalidPDFException, FormatError, MissingPDFException, truncated files and anything unknown.
  return documentErrors.pdfUnreadable();
}

/**
 * Extracts the text layer of a PDF page by page with pdfjs-dist. Page boundaries come from the PDF's
 * own page tree, so page i of the result is physical page i of the file.
 *
 * Known limits: pdfjs parses on the main thread, so a pathological file can briefly block the
 * server; the byte and page limits bound that. Reading order follows the PDF's content stream,
 * which can interleave columns in multi-column layouts.
 */
export class PdfJsTextExtractor implements PdfPageExtractor {
  readonly name = 'pdfjs-text-layer';

  async extract(data: Buffer, options: { maxPages: number }): Promise<string[]> {
    const task = getDocument({
      data: new Uint8Array(data), // pdfjs wants a plain Uint8Array (and may take ownership of it)
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });

    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      logger.warn('pdf open failed', { extractor: this.name, errorName: errorName(error) });
      await task.destroy().catch(() => undefined);
      throw mapPdfError(error);
    }

    try {
      if (doc.numPages > options.maxPages) {
        throw documentErrors.pdfTooManyPages(options.maxPages, doc.numPages);
      }
      const pages: string[] = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        const page = await doc.getPage(number);
        try {
          const content = await page.getTextContent();
          pages.push(textItemsToString(content.items as TextItemLike[]));
        } finally {
          page.cleanup();
        }
      }
      return pages;
    } catch (error) {
      if (!(error instanceof AppError)) {
        logger.warn('pdf page extraction failed', {
          extractor: this.name,
          errorName: errorName(error),
        });
      }
      throw mapPdfError(error);
    } finally {
      // In pdfjs-dist 6 resources are released through the loading task, not the document proxy.
      await task.destroy().catch(() => undefined);
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
