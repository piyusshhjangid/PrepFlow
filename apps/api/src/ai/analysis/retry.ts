import { AiProviderFailure } from '../provider.js';
import type { RetryConfig } from './config.js';

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOutcome<T> {
  value: T;
  /** Retries performed (attempts - 1). */
  retries: number;
}

/**
 * Bounded retry for provider calls. Only `transient` failures are retried (exponential backoff,
 * at most `maxAttempts` calls in total). Permanent failures and unknown errors surface immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  options: { sleep?: Sleep; shouldStop?: () => boolean } = {},
): Promise<RetryOutcome<T>> {
  const sleep = options.sleep ?? realSleep;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return { value: await operation(), retries: attempt - 1 };
    } catch (error) {
      const retryable = error instanceof AiProviderFailure && error.kind === 'transient';
      if (!retryable || attempt >= config.maxAttempts || options.shouldStop?.()) throw error;
      await sleep(config.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
