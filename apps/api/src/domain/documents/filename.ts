const MAX_LENGTH = 120;

/**
 * Makes a user-supplied filename safe for DISPLAY. It is never used as a filesystem path
 * (uploads are processed in memory), but we still strip directories and control characters so
 * it can't inject anything into logs or the UI.
 */
export function sanitizeFilename(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH);
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : 'document.pdf';
}

/** True when the buffer starts with the PDF magic bytes (allowing a little leading junk, as readers do). */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes('%PDF-');
}
