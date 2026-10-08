import { addDaysIso, diffDaysIso } from '@prepflow/shared';
import { ValidationError } from '../errors/index.js';

export const EXAM_DATE_RULES = {
  /**
   * How many days in the past an exam date may be. One day, because "today" is the UTC date and
   * a student west of UTC can legitimately be a calendar day behind it.
   */
  pastToleranceDays: 1,
  /** Further than this is almost certainly a typo and would make plans meaningless. */
  maxDaysAhead: 400,
} as const;

/** Throws a user-facing ValidationError when the exam date can't be planned for. */
export function assertPlannableExamDate(examDate: string, today: string): void {
  const daysAhead = diffDaysIso(today, examDate);
  if (daysAhead < -EXAM_DATE_RULES.pastToleranceDays) {
    throw new ValidationError('That exam date has already passed. Pick today or a later date.', {
      code: 'EXAM_DATE_IN_PAST',
    });
  }
  if (daysAhead > EXAM_DATE_RULES.maxDaysAhead) {
    throw new ValidationError(
      `That exam is more than ${EXAM_DATE_RULES.maxDaysAhead} days away. Double-check the date (the latest allowed is ${addDaysIso(today, EXAM_DATE_RULES.maxDaysAhead)}).`,
      { code: 'EXAM_DATE_TOO_FAR' },
    );
  }
}
