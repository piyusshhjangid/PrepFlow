import { describe, expect, it } from 'vitest';
import { computeAvailability, listStudyDays } from './availability.js';
import { addDaysIso, diffDaysIso, isValidIsoDate, todayIso } from './dates.js';

// 2026-10-03 is a Saturday.
const TODAY = '2026-10-03';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidIsoDate('2026-10-03')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('10/03/2026')).toBe(false);
    expect(isValidIsoDate('2026-10-3')).toBe(false);
  });

  it('does arithmetic across month and year boundaries', () => {
    expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDaysIso('2026-10-03', '2026-10-11')).toBe(8);
    expect(diffDaysIso('2026-10-11', '2026-10-03')).toBe(-8);
  });

  it('formats today from a Date in UTC', () => {
    expect(todayIso(new Date('2026-10-03T23:59:59.000Z'))).toBe('2026-10-03');
  });
});

describe('computeAvailability', () => {
  it('counts every day in [today, exam) when all weekdays are allowed (8 days x 3h = 24h)', () => {
    const result = computeAvailability({
      today: TODAY,
      examDate: '2026-10-11',
      studyWeekdays: ALL_DAYS,
      minutesPerDay: 180,
    });
    expect(result).toEqual({ daysUntilExam: 8, studyDays: 8, availableMinutes: 1440 });
  });

  it('only counts the chosen weekdays', () => {
    const result = computeAvailability({
      today: TODAY,
      examDate: '2026-10-11',
      studyWeekdays: WEEKDAYS,
      minutesPerDay: 120,
    });
    expect(result.studyDays).toBe(5); // Mon 5th to Fri 9th
    expect(result.availableMinutes).toBe(600);
  });

  it('scenario 3: with very little time, today counts and the exam day does not', () => {
    const tomorrow = computeAvailability({
      today: TODAY,
      examDate: '2026-10-04',
      studyWeekdays: ALL_DAYS,
      minutesPerDay: 180,
    });
    expect(tomorrow).toEqual({ daysUntilExam: 1, studyDays: 1, availableMinutes: 180 });

    const examToday = computeAvailability({
      today: TODAY,
      examDate: TODAY,
      studyWeekdays: ALL_DAYS,
      minutesPerDay: 180,
    });
    expect(examToday).toEqual({ daysUntilExam: 0, studyDays: 0, availableMinutes: 0 });
  });

  it('is zero for exams in the past and for windows with no chosen weekday', () => {
    expect(
      computeAvailability({
        today: TODAY,
        examDate: '2026-10-01',
        studyWeekdays: ALL_DAYS,
        minutesPerDay: 60,
      }).availableMinutes,
    ).toBe(0);
    // Only Sunday allowed, window is Saturday only.
    expect(
      computeAvailability({
        today: TODAY,
        examDate: '2026-10-04',
        studyWeekdays: [0],
        minutesPerDay: 60,
      }).studyDays,
    ).toBe(0);
  });

  it('scenario 10: changing daily hours changes the budget proportionally', () => {
    const base = { today: TODAY, examDate: '2026-10-11', studyWeekdays: ALL_DAYS };
    const threeHours = computeAvailability({ ...base, minutesPerDay: 180 });
    const fourHours = computeAvailability({ ...base, minutesPerDay: 240 });
    expect(fourHours.studyDays).toBe(threeHours.studyDays);
    expect(fourHours.availableMinutes).toBe(1920);
  });
});

describe('listStudyDays', () => {
  it('returns the actual calendar days in order', () => {
    expect(listStudyDays(TODAY, '2026-10-08', WEEKDAYS)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
  });
});
