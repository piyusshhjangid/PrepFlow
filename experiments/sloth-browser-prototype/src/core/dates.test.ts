import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDay, isISODate, localToday } from './dates';

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isISODate('2026-10-22')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('22-10-2026')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2027-02-29')).toBe(false);
  });
  it('does day arithmetic across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
  it('formats and reads the local date', () => {
    expect(formatDay('2026-10-22')).toBe('Thu 22 Oct');
    expect(localToday(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
  it('rejects invalid input loudly', () => {
    expect(() => addDays('nope', 1)).toThrow(RangeError);
  });
});
