import { errorResponseSchema } from '@prepflow/shared';
import type { ZodType } from 'zod';

/** An error with a stable `code` and a message that is safe and useful to show to the user as-is. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Base URL of the API. Empty (the default) means same-origin `/api/...` requests, which is what the
 * Vite dev proxy and a reverse-proxied production setup use. Set VITE_API_BASE_URL at build time when
 * the API is hosted on another origin. Only a public URL belongs here; this value ships in the bundle.
 */
export function resolveApiBase(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL);

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
  form?: FormData;
  /** Validates the response body; the UI never trusts the shape of a response. */
  schema?: ZodType<T>;
}

export async function apiRequest<T = void>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const { method = 'GET', json, form, schema } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: json === undefined ? form : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'PrepFlow can’t reach the server. Check your connection and that the API is running, then try again.',
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page): handled below.
  }

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, response.status, details);
    }
    throw new ApiError(
      'SERVER_ERROR',
      'The server returned an unexpected response. Please try again in a moment.',
      response.status,
    );
  }

  if (!schema) return payload as T;
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(
      'BAD_RESPONSE',
      'The server sent something PrepFlow didn’t understand. Please try again.',
      response.status,
    );
  }
  return result.data;
}
