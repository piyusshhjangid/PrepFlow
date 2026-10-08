import { describe, expect, it } from 'vitest';
import { createProfileInputSchema, updateExamInputSchema } from './setup.js';

const valid = {
  nickname: '  Asha ',
  examName: 'DBMS Final',
  examDate: '2026-10-11',
  minutesPerDay: 180,
  studyDays: [3, 1, 2],
};

describe('createProfileInputSchema', () => {
  it('trims, sorts study days and defaults weak topics', () => {
    const parsed = createProfileInputSchema.parse(valid);
    expect(parsed.nickname).toBe('Asha');
    expect(parsed.studyDays).toEqual([1, 2, 3]);
    expect(parsed.weakTopicHints).toEqual([]);
  });

  it('dedupes weak topics case-insensitively and drops blanks', () => {
    const parsed = createProfileInputSchema.safeParse({
      ...valid,
      weakTopicHints: ['Normalization', 'normalization', 'Deadlocks'],
    });
    expect(parsed.success && parsed.data.weakTopicHints).toEqual(['Normalization', 'Deadlocks']);
    expect(createProfileInputSchema.safeParse({ ...valid, weakTopicHints: ['   '] }).success).toBe(
      false,
    );
  });

  it.each([
    ['impossible date', { examDate: '2026-02-30' }],
    ['too little time', { minutesPerDay: 5 }],
    ['too much time', { minutesPerDay: 721 }],
    ['fractional minutes', { minutesPerDay: 90.5 }],
    ['no study days', { studyDays: [] }],
    ['duplicate study days', { studyDays: [1, 1] }],
    ['weekday out of range', { studyDays: [7] }],
    ['confidence out of range', { confidence: 6 }],
    ['unknown field', { isAdmin: true }],
  ])('rejects %s', (_label, patch) => {
    expect(createProfileInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('updateExamInputSchema', () => {
  it('accepts a partial update and null to clear confidence', () => {
    expect(updateExamInputSchema.safeParse({ minutesPerDay: 240 }).success).toBe(true);
    expect(updateExamInputSchema.safeParse({ confidence: null }).success).toBe(true);
  });

  it('rejects an empty update and invalid values', () => {
    expect(updateExamInputSchema.safeParse({}).success).toBe(false);
    expect(updateExamInputSchema.safeParse({ minutesPerDay: 0 }).success).toBe(false);
  });
});
