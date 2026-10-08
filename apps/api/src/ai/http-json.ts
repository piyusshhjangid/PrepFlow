import { AiProviderFailure } from './provider.js';

/** Maps an HTTP status to a retry decision. 429 and 5xx are transient; other 4xx are permanent. */
export function failureFromStatus(status: number, provider: string): AiProviderFailure {
  if (status === 401 || status === 403)
    return new AiProviderFailure(
      'permanent',
      'AI_AUTH_FAILED',
      `The ${provider} AI provider rejected the credentials. Check the API key in apps/api/.env.`,
      status,
    );
  if (status === 404)
    return new AiProviderFailure(
      'permanent',
      'AI_MODEL_NOT_FOUND',
      `The ${provider} AI provider could not find the configured model. Check the model name (and, for Ollama, run "ollama pull <model>").`,
      status,
    );
  if (status === 429)
    return new AiProviderFailure(
      'transient',
      'AI_RATE_LIMITED',
      `The ${provider} AI provider is rate limiting requests.`,
      status,
    );
  if (status >= 500)
    return new AiProviderFailure(
      'transient',
      'AI_PROVIDER_UNAVAILABLE',
      `The ${provider} AI provider is temporarily unavailable.`,
      status,
    );
  return new AiProviderFailure(
    'permanent',
    'AI_BAD_REQUEST',
    `The ${provider} AI provider rejected the request (HTTP ${status}).`,
    status,
  );
}

export type FetchLike = typeof fetch;

/** POSTs JSON with a timeout; converts network errors and timeouts to AiProviderFailure. Never logs bodies. */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
  options: {
    provider: string;
    timeoutMs: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (timeout.aborted)
      throw new AiProviderFailure(
        'transient',
        'AI_TIMEOUT',
        `The ${options.provider} AI provider did not answer in time.`,
      );
    if (options.signal?.aborted) throw error;
    throw new AiProviderFailure(
      'transient',
      'AI_UNREACHABLE',
      `Could not reach the ${options.provider} AI provider. ${options.provider === 'ollama' ? 'Is Ollama running?' : 'Check your network connection.'}`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw failureFromStatus(response.status, options.provider);
  }
  try {
    return await response.json();
  } catch {
    throw new AiProviderFailure(
      'transient',
      'AI_BAD_RESPONSE',
      `The ${options.provider} AI provider returned an unreadable response.`,
    );
  }
}
