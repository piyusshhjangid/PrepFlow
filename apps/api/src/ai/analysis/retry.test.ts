import { describe, expect, it } from 'vitest';
import { AiProviderFailure } from '../provider.js';
import { withRetry } from './retry.js';

const transient = () => new AiProviderFailure('transient', 'AI_TIMEOUT', 'x');
const permanent = () => new AiProviderFailure('permanent', 'AI_AUTH_FAILED', 'x');

describe('withRetry', () => {
  it('retries transient failures with exponential backoff and then succeeds', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw transient();
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 100 },
      { sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toEqual({ value: 'ok', retries: 2 });
    expect(delays).toEqual([100, 200]);
  });
  it('gives up after maxAttempts (bounded, never infinite)', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw transient();
        },
        { maxAttempts: 3, baseDelayMs: 0 },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
  it('does not retry permanent failures or unknown errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw permanent();
        },
        { maxAttempts: 5, baseDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('bug');
        },
        { maxAttempts: 5, baseDelayMs: 0 },
      ),
    ).rejects.toThrow('bug');
    expect(calls).toBe(2);
  });
  it('stops retrying when asked to', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw transient();
        },
        { maxAttempts: 5, baseDelayMs: 0 },
        { shouldStop: () => true },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
