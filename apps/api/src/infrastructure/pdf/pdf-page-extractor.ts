/**
 * Contract for anything that can turn a PDF into per-page raw text.
 *
 * Today there is one implementation (the PDF's own text layer, via pdfjs-dist). The ingestion
 * service takes an ORDERED LIST of extractors and uses the first one that yields usable text, so an
 * OCR extractor can later be appended to that list without changing validation, normalization,
 * hashing, persistence, the API or the UI. (OCR is intentionally not part of the MVP.)
 *
 * Implementations must:
 *  - return one string per PHYSICAL page, in order, keeping pages without text as '';
 *  - throw `DocumentError`s from document-errors.ts for problems the user can act on;
 *  - never persist the file anywhere.
 */
export interface PdfPageExtractor {
  /** Stable identifier used in logs, e.g. "pdfjs-text-layer". */
  readonly name: string;
  extract(data: Buffer, options: { maxPages: number }): Promise<string[]>;
}
