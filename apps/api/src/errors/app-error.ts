/**
 * One error hierarchy for the whole backend. Services throw these; a single error
 * middleware turns them into HTTP responses. Controllers contain no try/catch.
 *
 * `message` is ALWAYS safe to show to a user. Internal detail goes in `cause`
 * and is logged server-side only.
 */
export type ErrorCategory =
  'validation' | 'not_found' | 'ai_provider' | 'infrastructure' | 'unexpected';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly category: ErrorCategory,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.details = options?.details;
  }

  /** Optional structured, user-safe detail (e.g. which field failed). */
  public readonly details?: unknown;
}

export class ValidationError extends AppError {
  constructor(message: string, options?: { code?: string; details?: unknown; cause?: unknown }) {
    super(options?.code ?? 'VALIDATION_ERROR', message, 400, 'validation', options);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'We couldn’t find what you were looking for.', code = 'NOT_FOUND') {
    super(code, message, 404, 'not_found');
  }
}

/**
 * Problems with an uploaded or pasted document that the user can fix (wrong file, scanned PDF,
 * too large...). `code` is stable and machine-readable; `message` says what happened and what to do.
 */
export class DocumentError extends AppError {
  constructor(code: string, message: string, status = 422) {
    super(code, message, status, 'validation');
  }
}

/** Failures of the AI layer: provider down, timeout, unusable output. Detailed in Checkpoint C. */
export class AiProviderError extends AppError {
  constructor(
    code: string,
    message: string,
    options?: { status?: number; cause?: unknown; details?: unknown },
  ) {
    super(code, message, options?.status ?? 502, 'ai_provider', options);
  }
}

/** Database or other infrastructure failures. */
export class InfrastructureError extends AppError {
  constructor(
    message = 'PrepFlow is having trouble right now. Please try again in a moment.',
    options?: { code?: string; cause?: unknown },
  ) {
    super(options?.code ?? 'INFRASTRUCTURE_ERROR', message, 503, 'infrastructure', options);
  }
}
