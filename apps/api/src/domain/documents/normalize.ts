import { createHash } from 'node:crypto';

/**
 * Cleans text so it is safe to store and cheap to feed to a model:
 * - Unicode NFC, unified line endings
 * - control characters removed (NUL would make PostgreSQL reject the row; this also strips form feed, so
 *   stored page separators (see pages.ts) can never appear inside page content)
 * - zero-width characters removed, runs of spaces collapsed, trailing spaces trimmed
 * - 3+ blank lines collapsed to one blank line
 * Content is never reworded or reordered.
 */
export function normalizeText(raw: string): string {
  return (
    raw
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ')
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[ \u00A0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Number of non-whitespace characters (separators and whitespace do not count as content). */
export function countUsableChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
