import { describe, expect, it } from 'vitest';
import { topic } from '../test/factories';
import { effectiveScores, priorityOf } from './priority';

describe('priority', () => {
  it('scores importance, difficulty, weakness and foundations, and explains each', () => {
    const base = topic({ id: 'a', importance: 'high', difficulty: 3, weak: true });
    const dep1 = topic({ id: 'b', prerequisites: ['a'] });
    const dep2 = topic({ id: 'c', prerequisites: ['a'] });
    const p = priorityOf(base, [base, dep1, dep2]);
    expect(p.score).toBe(20 + 6 + 12 + 8);
    expect(p.level).toBe('high');
    expect(p.reasons.map((r) => r.points)).toEqual([20, 12, 8, 6]);
    expect(p.reasons.some((r) => r.label.includes('2 other topics'))).toBe(true);
  });
  it('caps the foundation bonus and ignores inactive dependents', () => {
    const base = topic({ id: 'a', importance: 'low', difficulty: 1 });
    const deps = Array.from({ length: 6 }, (_, i) => topic({ id: `d${i}`, prerequisites: ['a'] }));
    expect(priorityOf(base, [base, ...deps]).score).toBe(12);
    const gone = deps.map((d) => ({ ...d, done: true }));
    expect(priorityOf(base, [base, ...gone]).score).toBe(0);
  });
  it('lets a prerequisite inherit the score of what depends on it', () => {
    const basic = topic({ id: 'basic', importance: 'low' });
    const advanced = topic({ id: 'advanced', importance: 'high', prerequisites: ['basic'] });
    const scores = effectiveScores([basic, advanced]);
    expect(scores.get('basic')).toBeGreaterThanOrEqual(scores.get('advanced')!);
  });
});
