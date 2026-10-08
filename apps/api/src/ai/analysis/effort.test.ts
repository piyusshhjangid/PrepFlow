import { describe, expect, it } from 'vitest';
import {
  BASE_MINUTES,
  MAX_TOPIC_MINUTES,
  MIN_TOPIC_MINUTES,
  estimateMinutes,
  revisionWeightFor,
} from './effort.js';

const base = { difficulty: 'MEDIUM', importance: 'MEDIUM', revisionWeight: 0 } as const;

describe('estimateMinutes', () => {
  it('maps effort classes to the base minutes (20 / 45 / 90)', () => {
    expect(BASE_MINUTES).toEqual({ QUICK: 20, STANDARD: 45, EXTENSIVE: 90 });
    expect(estimateMinutes({ ...base, effort: 'QUICK' })).toBe(20);
    expect(estimateMinutes({ ...base, effort: 'STANDARD' })).toBe(45);
    expect(estimateMinutes({ ...base, effort: 'EXTENSIVE' })).toBe(90);
  });
  it('is monotonic in difficulty, importance and revision weight', () => {
    const m = (o: Partial<Parameters<typeof estimateMinutes>[0]>) =>
      estimateMinutes({ effort: 'EXTENSIVE', ...base, ...o });
    expect(m({ difficulty: 'EASY' })).toBeLessThan(m({ difficulty: 'MEDIUM' }));
    expect(m({ difficulty: 'MEDIUM' })).toBeLessThan(m({ difficulty: 'HARD' }));
    expect(m({ importance: 'LOW' })).toBeLessThan(m({ importance: 'HIGH' }));
    expect(m({ revisionWeight: 0 })).toBeLessThan(m({ revisionWeight: 1 }));
  });
  it('rounds to 5 minutes and clamps', () => {
    expect(
      estimateMinutes({
        effort: 'STANDARD',
        difficulty: 'HARD',
        importance: 'HIGH',
        revisionWeight: 0.8,
      }) % 5,
    ).toBe(0);
    expect(
      estimateMinutes({
        effort: 'QUICK',
        difficulty: 'EASY',
        importance: 'LOW',
        revisionWeight: 0,
      }),
    ).toBeGreaterThanOrEqual(MIN_TOPIC_MINUTES);
    expect(
      estimateMinutes({
        effort: 'EXTENSIVE',
        difficulty: 'HARD',
        importance: 'HIGH',
        revisionWeight: 1,
      }),
    ).toBeLessThanOrEqual(MAX_TOPIC_MINUTES);
  });
  it('is deterministic', () => {
    const input = {
      effort: 'STANDARD',
      difficulty: 'HARD',
      importance: 'HIGH',
      revisionWeight: 0.5,
    } as const;
    expect(estimateMinutes(input)).toBe(estimateMinutes(input));
  });
  it('weak topics get more revision weight, capped at 1', () => {
    expect(revisionWeightFor('MEDIUM', true)).toBeGreaterThan(revisionWeightFor('MEDIUM', false));
    expect(revisionWeightFor('HIGH', true)).toBe(0.95);
    expect(revisionWeightFor('HIGH', true)).toBeLessThanOrEqual(1);
  });
});
