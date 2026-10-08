import type { Env } from '../../config/env.js';

/** Bump when the chunking algorithm changes: it is part of the analysis fingerprint. */
export const CHUNKER_VERSION = 'chunker-v1';
/** Bump when prompts change in a way that affects output. */
export const PROMPT_VERSION = 'prompt-v1';
/** Bump when the structured-output schema or post-processing (merge, effort) changes. */
export const ANALYSIS_SCHEMA_VERSION = 'analysis-v1';

export interface ChunkConfig {
  /** Chunks are packed up to roughly this many characters. */
  targetChars: number;
  /** No chunk is ever larger than this. */
  maxChars: number;
  /** An analysis needing more chunks than this is rejected up front (bounds AI cost). */
  maxChunks: number;
}

/** Defaults follow the design: hosted 20k/25k, local E4B 12k/15k; always overridable by env. */
export function chunkConfigFromEnv(env: Env): ChunkConfig {
  const hosted = env.AI_PROVIDER === 'gemini';
  const targetChars = env.AI_CHUNK_TARGET_CHARS ?? (hosted ? 20_000 : 12_000);
  const maxChars = Math.max(env.AI_CHUNK_MAX_CHARS ?? (hosted ? 25_000 : 15_000), targetChars);
  return { targetChars, maxChars, maxChunks: env.AI_MAX_CHUNKS };
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}
