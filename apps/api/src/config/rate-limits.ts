export interface RateLimitConfig {
  windowMs: number;
  limit: number;
}

/** Defaults are generous enough for a live demo and still stop scripted abuse. */
export const DEFAULT_RATE_LIMITS = {
  /** Anything that parses an upload or stores study text. */
  uploads: { windowMs: 15 * 60 * 1000, limit: 30 } satisfies RateLimitConfig,
  /** Creating new workspaces. */
  profiles: { windowMs: 60 * 60 * 1000, limit: 20 } satisfies RateLimitConfig,
  /** Starting an AI analysis. Overridden from ANALYSIS_RATE_* by the composition root. */
  analysis: { windowMs: 60 * 60 * 1000, limit: 10 } satisfies RateLimitConfig,
  /** Generating or rebalancing a plan (cheap, in-memory, but writes a new version each time). */
  planning: { windowMs: 15 * 60 * 1000, limit: 60 } satisfies RateLimitConfig,
};

export type RateLimits = typeof DEFAULT_RATE_LIMITS;
