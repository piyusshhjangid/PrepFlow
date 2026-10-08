/**
 * Tunable constants of the planning model. Every number that shapes a plan lives here (or in
 * priority.ts for the score) so it can be reviewed, documented and tested in one place.
 */
export const PLAN_TUNING = {
  /** All planned minutes are multiples of this. */
  granularity: 5,
  /** The longest single sitting on one topic. Longer topics continue on the next study day. */
  maxSessionMinutes: 60,
  /** The smallest piece of a topic worth scheduling (unless the whole remainder is smaller). */
  minChunkMinutes: 15,
  /** Defaults used when a setting is missing. */
  defaultBufferPct: 10,
  maxBufferPct: 50,
  maxRevisionReservePct: 50,
  maxRevisionIntervals: 6,
  maxIntervalDays: 60,
  maxDaysAhead: 400,
  maxTopics: 600,
  maxTasks: 6000,
  /** Tier bands, as the share of study capacity consumed when a topic (and its prerequisites) is added. */
  tierBands: { MUST: 0.5, SHOULD: 0.8, IF_TIME: 1 },
  /** A plan using more than this share of its study capacity is reported as TIGHT. */
  tightShare: 0.9,
} as const;

/** Revision session length as a share of the topic's first-time study time, by revision number. */
export const REVISION_FRACTIONS = [0.35, 0.25, 0.2] as const;
export const MIN_REVISION_MINUTES = 10;
