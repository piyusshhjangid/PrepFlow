import { DocumentError } from '../../errors/index.js';

/**
 * All user-facing copy for document problems lives here, next to its stable error code.
 * Each message says what happened and what the user can do about it.
 */
const mb = (bytes: number): string => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export const documentErrors = {
  noFile: () => new DocumentError('NO_FILE', 'Choose a PDF file to upload.', 400),

  notAPdf: () =>
    new DocumentError(
      'PDF_INVALID',
      'That file doesn’t look like a valid PDF. Make sure you’re uploading a .pdf file, or paste the text instead.',
      415,
    ),

  pdfUnreadable: () =>
    new DocumentError(
      'PDF_UNREADABLE',
      'We couldn’t read this PDF. It may be damaged. Try exporting it again, or paste the text instead.',
    ),

  pdfPasswordProtected: () =>
    new DocumentError(
      'PDF_PASSWORD_PROTECTED',
      'This PDF is password-protected. Remove the password and upload it again, or paste the text instead.',
    ),

  pdfNoText: () =>
    new DocumentError(
      'PDF_NO_TEXT',
      'We couldn’t analyze this document. Check that the PDF contains selectable text and try again. You can also paste the text instead.',
    ),

  pdfTooLarge: (maxBytes: number) =>
    new DocumentError(
      'PDF_TOO_LARGE',
      `That PDF is larger than ${mb(maxBytes)}. Upload fewer pages at a time, or paste the text instead.`,
      413,
    ),

  pdfTooManyPages: (maxPages: number, actual?: number) =>
    new DocumentError(
      'PDF_TOO_MANY_PAGES',
      actual === undefined
        ? `That PDF has more than ${maxPages} pages. Split it into smaller files.`
        : `That PDF has ${actual} pages, but PrepFlow handles up to ${maxPages}. Split it into smaller files.`,
    ),

  textTooShort: () =>
    new DocumentError(
      'TEXT_TOO_SHORT',
      'There isn’t enough text to build a study plan from. Add more of your syllabus or notes.',
    ),

  documentTooLong: (maxChars: number) =>
    new DocumentError(
      'DOCUMENT_TOO_LONG',
      `That’s more text than PrepFlow can process at once (limit: ${maxChars.toLocaleString('en-US')} characters). Split it into smaller parts and add them separately.`,
    ),

  materialLimitReached: (max: number) =>
    new DocumentError(
      'MATERIAL_LIMIT_REACHED',
      `You’ve reached the limit of ${max} materials for this exam. Remove one to add another.`,
      409,
    ),
};
