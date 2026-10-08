import type { MaterialLimits } from '@prepflow/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { documentErrors } from '../domain/documents/document-errors.js';
import { DocumentError } from '../errors/index.js';

/** Browsers send application/pdf; some systems send octet-stream for .pdf files. Magic bytes are checked later. */
function acceptsPdf(file: { mimetype: string; originalname: string }): boolean {
  const type = file.mimetype.toLowerCase();
  if (type === 'application/pdf') return true;
  const generic = type === '' || type === 'application/octet-stream';
  return generic && file.originalname.toLowerCase().endsWith('.pdf');
}

function mapUploadError(error: unknown, limits: MaterialLimits): unknown {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return documentErrors.pdfTooLarge(limits.maxPdfBytes);
      case 'LIMIT_UNEXPECTED_FILE':
      case 'LIMIT_FILE_COUNT':
        return new DocumentError(
          'UPLOAD_INVALID',
          'Upload a single PDF file in the "file" field.',
          400,
        );
      default:
        return new DocumentError(
          'UPLOAD_INVALID',
          'That upload couldn’t be read. Try again with a single PDF file.',
          400,
        );
    }
  }
  return error;
}

/**
 * Accepts exactly one PDF in the multipart field "file", held IN MEMORY only: nothing is written to
 * disk, so there is no temp file to clean up and no path to traverse. Size is enforced while streaming.
 */
export function createPdfUpload(limits: MaterialLimits): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxPdfBytes, files: 1, fields: 2, parts: 4 },
    fileFilter: (_req, file, cb) => {
      if (acceptsPdf(file)) cb(null, true);
      else cb(documentErrors.notAPdf());
    },
  }).single('file');

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (error: unknown) => (error ? next(mapUploadError(error, limits)) : next()));
  };
}
