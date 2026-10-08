import { addDaysIso, diffDaysIso, isValidIsoDate, listStudyDays } from '@prepflow/shared';
import { PLAN_TUNING } from './config.js';
import { PlanningInputError, type DayCapacity, type PlanConfig } from './types.js';

const G = PLAN_TUNING.granularity;

const isInt = (value: unknown): value is number => Number.isInteger(value);

/** Rejects configurations the planner cannot plan from. Dates that are merely in the past are allowed (they plan nothing). */
export function assertValidConfig(config: PlanConfig): void {
  const bad = (code: string, message: string): never => {
    throw new PlanningInputError(code, message);
  };
  if (!isValidIsoDate(config.today)) bad('INVALID_DATE', 'The planning date is not a real date.');
  if (!isValidIsoDate(config.examDate)) bad('INVALID_DATE', 'The exam date is not a real date.');
  if (diffDaysIso(config.today, config.examDate) > PLAN_TUNING.maxDaysAhead)
    bad('EXAM_TOO_FAR', `The exam is more than ${PLAN_TUNING.maxDaysAhead} days away.`);
  if (!isInt(config.minutesPerDay) || config.minutesPerDay < 1 || config.minutesPerDay > 1440)
    bad('INVALID_CAPACITY', 'Daily study time must be between 1 and 1440 minutes.');
  if (!config.studyWeekdays.every((d) => isInt(d) && d >= 0 && d <= 6))
    bad('INVALID_WEEKDAYS', 'Study days must be weekdays 0-6.');
  if (!config.blockedDates.every(isValidIsoDate))
    bad('INVALID_DATE', 'A day off is not a real date.');
  if (
    !isInt(config.bufferPct) ||
    config.bufferPct < 0 ||
    config.bufferPct > PLAN_TUNING.maxBufferPct
  )
    bad('INVALID_BUFFER', `The buffer must be between 0% and ${PLAN_TUNING.maxBufferPct}%.`);
  if (
    !isInt(config.revisionReservePct) ||
    config.revisionReservePct < 0 ||
    config.revisionReservePct > PLAN_TUNING.maxRevisionReservePct
  )
    bad('INVALID_RESERVE', 'The revision reserve must be between 0% and 50%.');
  const intervals = config.revisionIntervalsDays;
  if (
    intervals.length > PLAN_TUNING.maxRevisionIntervals ||
    !intervals.every((d) => isInt(d) && d >= 1 && d <= PLAN_TUNING.maxIntervalDays)
  )
    bad('INVALID_INTERVALS', 'Revision intervals must be whole days between 1 and 60.');
  if (
    config.learnerConfidence !== null &&
    !(
      isInt(config.learnerConfidence) &&
      config.learnerConfidence >= 1 &&
      config.learnerConfidence <= 5
    )
  )
    bad('INVALID_CONFIDENCE', 'Confidence must be between 1 and 5.');
}

/** The per-day split of the student's time. All values are multiples of 5 minutes (except `total`). */
export function dayCapacityFor(
  total: number,
  bufferPct: number,
  reservePct: number,
): Omit<DayCapacity, 'date'> {
  const usable = Math.floor((total * (100 - bufferPct)) / (100 * G)) * G;
  const revisionReserve = Math.floor((usable * reservePct) / (100 * G)) * G;
  return {
    total,
    buffer: total - usable,
    usable,
    revisionReserve,
    studyCapacity: usable - revisionReserve,
  };
}

/** Every day the student can study in [today, examDate), in order, with its capacity. */
export function buildCalendar(config: PlanConfig): DayCapacity[] {
  const split = dayCapacityFor(config.minutesPerDay, config.bufferPct, config.revisionReservePct);
  return listStudyDays(
    config.today,
    config.examDate,
    config.studyWeekdays,
    config.blockedDates,
  ).map((date) => ({ date, ...split }));
}

export interface CalendarTotals {
  studyDays: number;
  totalMinutes: number;
  bufferMinutes: number;
  revisionReserveMinutes: number;
  usableMinutes: number;
  studyCapacityMinutes: number;
}

export function totalsOf(days: readonly DayCapacity[]): CalendarTotals {
  const sum = (pick: (d: DayCapacity) => number) => days.reduce((acc, d) => acc + pick(d), 0);
  return {
    studyDays: days.length,
    totalMinutes: sum((d) => d.total),
    bufferMinutes: sum((d) => d.buffer),
    revisionReserveMinutes: sum((d) => d.revisionReserve),
    usableMinutes: sum((d) => d.usable),
    studyCapacityMinutes: sum((d) => d.studyCapacity),
  };
}

/** The last day anything can be studied or revised (the day before the exam, if it is a study day). */
export function lastStudyDay(days: readonly DayCapacity[]): string | null {
  return days.length === 0 ? null : (days[days.length - 1] as DayCapacity).date;
}

export { addDaysIso };
