import { addDaysIso, diffDaysIso, parseIsoDate } from './dates.js';

/**
 * Study-time availability. Shared by the API (exam responses, and later the planner) and the web
 * app (live preview on the setup screen) so both always agree.
 *
 * Convention: the study window is [today, examDate). Today counts; the exam day itself does not.
 * An exam 8 days away therefore has 8 potential study days.
 */
export interface Availability {
  /** Calendar days from today until the exam (the exam day itself excluded). */
  daysUntilExam: number;
  /** Days in the window that fall on one of the student's chosen weekdays. */
  studyDays: number;
  /** studyDays x minutesPerDay. */
  availableMinutes: number;
}

/** The calendar days (YYYY-MM-DD) the student can study, in order. */
export function listStudyDays(
  today: string,
  examDate: string,
  weekdays: readonly number[],
  blockedDates: readonly string[] = [],
): string[] {
  const window = diffDaysIso(today, examDate);
  const allowed = new Set(weekdays);
  const blocked = new Set(blockedDates);
  const days: string[] = [];
  for (let offset = 0; offset < window; offset += 1) {
    const day = addDaysIso(today, offset);
    if (allowed.has(parseIsoDate(day).getUTCDay()) && !blocked.has(day)) days.push(day);
  }
  return days;
}

export function computeAvailability(input: {
  today: string;
  examDate: string;
  studyWeekdays: readonly number[];
  minutesPerDay: number;
  /** Specific dates the student cannot study (YYYY-MM-DD). */
  blockedDates?: readonly string[];
}): Availability {
  const daysUntilExam = Math.max(0, diffDaysIso(input.today, input.examDate));
  const studyDays = listStudyDays(
    input.today,
    input.examDate,
    input.studyWeekdays,
    input.blockedDates ?? [],
  ).length;
  return {
    daysUntilExam,
    studyDays,
    availableMinutes: studyDays * input.minutesPerDay,
  };
}
