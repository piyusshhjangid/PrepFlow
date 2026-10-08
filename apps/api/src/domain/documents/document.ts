import { TEXT_QUALITY, type MaterialLimits } from '@prepflow/shared';
import { documentErrors } from './document-errors.js';
import { countUsableChars, hashText, normalizeText } from './normalize.js';
import { serializePages, type NormalizedPage, type SourceKind } from './pages.js';

/**
 * The canonical result of ingestion, whatever the source. Pure data: building it involves no I/O
 * and no AI. Persisting it is the repository's job; analyzing it comes later.
 */
export interface NormalizedDocument {
  sourceType: SourceKind;
  filename: string | null;
  pages: NormalizedPage[];
  /** Pages serialized for storage (see pages.ts). */
  storedText: string;
  /** Characters of content, excluding page separators. */
  charCount: number;
  /** Physical PDF page count; null for pasted text. */
  pageCount: number | null;
  /** PDF pages with little or no selectable text; null for pasted text. */
  lowTextPageCount: number | null;
  /** SHA-256 of storedText: identical content gives an identical hash. */
  contentHash: string;
}

function finish(
  sourceType: SourceKind,
  filename: string | null,
  pages: NormalizedPage[],
  lowTextPageCount: number | null,
): NormalizedDocument {
  const storedText = serializePages(pages.map((page) => page.text));
  return {
    sourceType,
    filename,
    pages,
    storedText,
    charCount: pages.reduce((sum, page) => sum + page.text.length, 0),
    pageCount: sourceType === 'PDF' ? pages.length : null,
    lowTextPageCount,
    contentHash: hashText(storedText),
  };
}

export function buildTextDocument(raw: string, limits: MaterialLimits): NormalizedDocument {
  const text = normalizeText(raw);
  if (countUsableChars(text) < TEXT_QUALITY.minUsableChars) throw documentErrors.textTooShort();
  if (text.length > limits.maxChars) throw documentErrors.documentTooLong(limits.maxChars);
  return finish('TEXT', null, [{ number: null, text }], null);
}

/**
 * Builds a document from per-page raw text produced by ANY extractor (text layer today, OCR later).
 * It decides "does this PDF have usable text?" from the text itself, with fixed thresholds, so the
 * answer never depends on how the text was obtained.
 */
export function buildPdfDocument(
  rawPages: readonly string[],
  filename: string,
  limits: MaterialLimits,
): NormalizedDocument {
  if (rawPages.length > limits.maxPdfPages) {
    throw documentErrors.pdfTooManyPages(limits.maxPdfPages, rawPages.length);
  }
  const pages: NormalizedPage[] = rawPages.map((raw, index) => ({
    number: index + 1,
    text: normalizeText(raw),
  }));

  const usablePerPage = pages.map((page) => countUsableChars(page.text));
  const textPages = usablePerPage.filter(
    (count) => count >= TEXT_QUALITY.minUsableCharsPerPage,
  ).length;
  const totalUsable = usablePerPage.reduce((sum, count) => sum + count, 0);
  if (textPages === 0 || totalUsable < TEXT_QUALITY.minUsableChars)
    throw documentErrors.pdfNoText();

  const charCount = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (charCount > limits.maxChars) throw documentErrors.documentTooLong(limits.maxChars);

  return finish('PDF', filename, pages, pages.length - textPages);
}
