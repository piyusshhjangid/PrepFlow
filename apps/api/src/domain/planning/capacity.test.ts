import { describe, expect, it } from 'vitest';
import { assertValidConfig, buildCalendar, dayCapacityFor, totalsOf } from './capacity.js';
import { config } from './fixtures.js';

describe('capacity', () => {
  it('splits a day into buffer, revision reserve and study capacity (multiples of 5)', () => {
    expect(dayCapacityFor(180, 10, 15)).toEqual({
      total: 180,
      buffer: 20,
      usable: 160,
      revisionReserve: 20,
      studyCapacity: 140,
    });
    for (const total of [37, 61, 99, 180, 333]) {
      const c = dayCapacityFor(total, 10, 15);
      expect(c.usable % 5).toBe(0);
      expect(c.usable + c.buffer).toBe(total);
      expect(c.studyCapacity + c.revisionReserve).toBe(c.usable);
    }
  });

  it('counts only chosen weekdays, excludes the exam day, includes today', () => {
    // Mon 2026-10-05 → exam Mon 2026-10-12: Mon..Sun = 7 days; Sunday (0) off → 6
    const days = buildCalendar(
      config({ examDate: '2026-10-12', studyWeekdays: [1, 2, 3, 4, 5, 6] }),
    );
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
  });

  it('removes blocked dates', () => {
    const days = buildCalendar(config({ examDate: '2026-10-08', blockedDates: ['2026-10-06'] }));
    expect(days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('exam today, exam tomorrow, past exam and no study days', () => {
    expect(buildCalendar(config({ examDate: '2026-10-05' }))).toEqual([]);
    expect(buildCalendar(config({ examDate: '2026-10-06' })).map((d) => d.date)).toEqual([
      '2026-10-05',
    ]);
    expect(buildCalendar(config({ examDate: '2026-10-01' }))).toEqual([]);
    expect(buildCalendar(config({ studyWeekdays: [] }))).toEqual([]);
  });

  it('totals add up', () => {
    const t = totalsOf(buildCalendar(config({ examDate: '2026-10-08' })));
    expect(t.studyDays).toBe(3);
    expect(t.totalMinutes).toBe(540);
    expect(t.usableMinutes + t.bufferMinutes).toBe(540);
    expect(t.studyCapacityMinutes + t.revisionReserveMinutes).toBe(t.usableMinutes);
  });

  it.each([
    ['invalid date', { today: '2026-02-30' }],
    ['invalid exam date', { examDate: 'soon' }],
    ['exam too far', { examDate: '2030-01-01' }],
    ['zero minutes', { minutesPerDay: 0 }],
    ['negative minutes', { minutesPerDay: -30 }],
    ['absurd minutes', { minutesPerDay: 5000 }],
    ['fractional minutes', { minutesPerDay: 90.5 }],
    ['bad weekday', { studyWeekdays: [7] }],
    ['bad blocked date', { blockedDates: ['x'] }],
    ['negative buffer', { bufferPct: -1 }],
    ['huge buffer', { bufferPct: 90 }],
    ['bad interval', { revisionIntervalsDays: [0] }],
    ['too many intervals', { revisionIntervalsDays: [1, 2, 3, 4, 5, 6, 7] }],
    ['bad confidence', { learnerConfidence: 9 }],
  ])('rejects %s', (_name, override) => {
    expect(() => assertValidConfig(config(override))).toThrow();
  });

  it('accepts a past exam date (it simply plans nothing)', () => {
    expect(() => assertValidConfig(config({ examDate: '2026-10-01' }))).not.toThrow();
  });
});
