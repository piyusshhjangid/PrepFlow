import {
  PRIORITY_LEVEL_THRESHOLDS,
  addDaysIso,
  diffDaysIso,
  type PriorityTier,
} from '@prepflow/shared';
import { MIN_REVISION_MINUTES, PLAN_TUNING, REVISION_FRACTIONS } from './config.js';

/**
 * Deterministic spaced revision.
 *
 * After a topic's last study session, revision is due at the exam's configured intervals (default
 * +1, +3, +7 days), snapped forward to the next day the student can study. Rules:
 *   - never after the last study day before the exam;
 *   - fewer revisions for lower tiers (MUST: all, SHOULD: 2, IF_TIME: 1, DEFER: none);
 *   - when the exam is too close for ANY configured interval, a single compressed "final review"
 *     goes on the last study day, for topics that matter (MUST tier, or priority at the MEDIUM level or above);
 *   - several intervals that land on the same day collapse into one review.
 */

export interface RevisionSlot {
  /** 1-based, in the order the reviews happen. */
  index: number;
  due: string;
  /** True for the single final review that replaces intervals that no longer fit. */
  compressed: boolean;
}

const G = PLAN_TUNING.granularity;

export function revisionMinutes(
  topicMinutes: number,
  revisionWeight: number,
  index: number,
): number {
  const fraction = REVISION_FRACTIONS[
    Math.min(Math.max(index, 1), REVISION_FRACTIONS.length) - 1
  ] as number;
  const raw = topicMinutes * fraction * (0.5 + Math.min(1, Math.max(0, revisionWeight)));
  const rounded = Math.round(raw / G) * G;
  return Math.min(
    Math.max(MIN_REVISION_MINUTES, rounded),
    Math.max(MIN_REVISION_MINUTES, topicMinutes),
  );
}

export function maxRevisionsFor(tier: PriorityTier, configured: number): number {
  switch (tier) {
    case 'MUST':
      return configured;
    case 'SHOULD':
      return Math.min(2, configured);
    case 'IF_TIME':
      return Math.min(1, configured);
    default:
      return 0;
  }
}

/** First study day on or after `date`, or null when there is none. `studyDays` is ascending. */
function snapForward(studyDays: readonly string[], date: string): string | null {
  for (const day of studyDays) if (day >= date) return day;
  return null;
}

export function planRevisionDates(input: {
  /** The day the topic's last study session happens (or happened). */
  studiedOn: string;
  /** The planning date; reviews are never planned before it. */
  today: string;
  /** Every study day from the planning date to the exam, ascending. */
  studyDays: readonly string[];
  intervals: readonly number[];
  /** Reviews already done or skipped; the next ones continue from here. */
  doneCount: number;
  tier: PriorityTier;
  score: number;
}): RevisionSlot[] {
  const { studiedOn, today, studyDays, intervals, doneCount, tier, score } = input;
  const last = studyDays[studyDays.length - 1];
  const limit = maxRevisionsFor(tier, intervals.length);
  if (last === undefined || doneCount >= limit) return [];

  const slots: RevisionSlot[] = [];
  const seen = new Set<string>();
  for (let i = doneCount; i < limit; i += 1) {
    const ideal = addDaysIso(studiedOn, intervals[i] as number);
    const earliest = [ideal, today, addDaysIso(studiedOn, 1)].reduce((a, b) => (a > b ? a : b));
    const due = snapForward(studyDays, earliest);
    if (due === null || due > last || seen.has(due)) continue;
    seen.add(due);
    slots.push({ index: doneCount + slots.length + 1, due, compressed: false });
  }
  if (
    slots.length === 0 &&
    studiedOn < last &&
    (tier === 'MUST' || score >= PRIORITY_LEVEL_THRESHOLDS.medium)
  ) {
    const due = snapForward(studyDays, addDaysIso(studiedOn, 1));
    // A compressed review belongs near the exam, not right after studying.
    const finalDay = diffDaysIso(studiedOn, last) >= 1 ? last : due;
    if (finalDay !== null) slots.push({ index: doneCount + 1, due: finalDay, compressed: true });
  }
  return slots;
}
