/**
 * THE canonical page serializer/parser. This is the only module that knows how pages are laid out
 * inside StudyMaterial.extractedText (pages joined by a form feed). Everything else works with
 * `NormalizedPage[]` and calls these functions; never split or join on the separator elsewhere.
 *
 * Pages are 1-based PHYSICAL PDF pages (the n-th page of the file), which can differ from the page
 * number printed on the page. The UI labels them "PDF page n". Pasted text has no pages (number = null).
 */
export type SourceKind = 'PDF' | 'TEXT';

export interface NormalizedPage {
  /** 1-based physical PDF page, or null for pasted text. */
  number: number | null;
  /** Normalized text. May be empty for a PDF page without selectable text. */
  text: string;
}

const SEPARATOR = '\f';

/** Joins page texts for storage. Pages must already be normalized (which strips form feeds). */
export function serializePages(pageTexts: readonly string[]): string {
  if (pageTexts.some((text) => text.includes(SEPARATOR))) {
    throw new Error(
      'Page text must be normalized before serialization (contains a page separator).',
    );
  }
  return pageTexts.join(SEPARATOR);
}

/** Inverse of serializePages for PDFs: the raw page texts in physical order. */
export function parsePageTexts(stored: string): string[] {
  return stored.split(SEPARATOR);
}

/** Turns stored text back into pages. Pasted text becomes a single page with number = null. */
export function toNormalizedPages(stored: string, sourceType: SourceKind): NormalizedPage[] {
  if (sourceType === 'TEXT') return [{ number: null, text: stored }];
  return parsePageTexts(stored).map((text, index) => ({ number: index + 1, text }));
}

/** Human label used in the UI and in evidence references. */
export function describePage(page: NormalizedPage): string {
  return page.number === null ? 'Detected in uploaded material' : `PDF page ${page.number}`;
}
