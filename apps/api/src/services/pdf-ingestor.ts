import type { MaterialLimits } from '@prepflow/shared';
import { buildPdfDocument, type NormalizedDocument } from '../domain/documents/document.js';
import { documentErrors } from '../domain/documents/document-errors.js';
import { sanitizeFilename } from '../domain/documents/filename.js';
import { AppError } from '../errors/index.js';
import { logger } from '../infrastructure/logger.js';
import type { PdfPageExtractor } from '../infrastructure/pdf/pdf-page-extractor.js';

/**
 * Turns PDF bytes into a NormalizedDocument by trying extractors in order.
 *
 * Extension point for OCR: append an OCR-based PdfPageExtractor to the list. If an earlier
 * extractor produces no usable text, the next one is tried. Nothing else in ingestion changes,
 * because "usable text?" is judged by buildPdfDocument from the text alone, however it was obtained.
 * With the MVP's single extractor, "no usable text" ends as PDF_NO_TEXT.
 */
export interface PdfIngestResult {
  document: NormalizedDocument;
  /** Which extractor produced the text (logged; useful once more than one exists). */
  extractor: string;
}

export function createPdfIngestor(extractors: readonly PdfPageExtractor[], limits: MaterialLimits) {
  return {
    async ingest(data: Buffer, originalFilename: string | undefined): Promise<PdfIngestResult> {
      const filename = sanitizeFilename(originalFilename);
      for (const extractor of extractors) {
        const rawPages = await extractor.extract(data, { maxPages: limits.maxPdfPages });
        try {
          return {
            document: buildPdfDocument(rawPages, filename, limits),
            extractor: extractor.name,
          };
        } catch (error) {
          if (error instanceof AppError && error.code === 'PDF_NO_TEXT') {
            logger.info('extractor produced no usable text', { extractor: extractor.name });
            continue; // try the next extractor, if any
          }
          throw error;
        }
      }
      throw documentErrors.pdfNoText();
    },
  };
}

export type PdfIngestor = ReturnType<typeof createPdfIngestor>;
