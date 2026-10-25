/** Shared line patterns: how study material marks the start of a new item. */

export const LABELLED =
  /^(?:(?:week|unit|chapter|module|lecture|lesson|section|part|topic|session|day|block)\s*\d+[a-z]?|\d+(?:\.\d+)*[.)])\s*[:.\-–—)]*\s*(.+)$/i;
export const BULLET = /^[-*•●]\s+(.+)$/;
export const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/;

/** A line that begins a new item (a "Week 4 - …" line, a bullet, a heading) rather than continuing one. */
export const startsBlock = (line: string): boolean =>
  LABELLED.test(line) || BULLET.test(line) || MARKDOWN_HEADING.test(line);
