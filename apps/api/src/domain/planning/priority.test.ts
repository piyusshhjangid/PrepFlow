import { describe, expect, it } from 'vitest';
import { topic } from './fixtures.js';
import { computePriority, PRIORITY_MODEL, urgencyShare, type PriorityContext } from './priority.js';

const ctx = (o: Partial<PriorityContext> = {}): PriorityContext => ({
  daysUntilExam: 30,
  learnerConfidence: null,
  directDependents: 0,
  transitiveDependents: 0,
  ...o,
});
const score = (t = topic('a'), c = ctx()) => computePriority(t, c).score;

describe('priority engine', () => {
  it('a weak topic scores higher than the same topic that is not weak', () => {
    expect(score(topic('a', { isWeak: true }))).toBe(score(topic('a')) + PRIORITY_MODEL.weakness);
  });

  it('higher importance scores higher (LOW < MEDIUM < HIGH)', () => {
    const [lo, mid, hi] = (['LOW', 'MEDIUM', 'HIGH'] as const).map((importance) =>
      score(topic('a', { importance })),
    );
    expect(lo).toBeLessThan(mid as number);
    expect(mid).toBeLessThan(hi as number);
  });

  it('being a prerequisite raises priority, direct dependents more than indirect ones', () => {
    const none = score();
    const direct = score(topic('a'), ctx({ directDependents: 2, transitiveDependents: 2 }));
    const indirect = score(topic('a'), ctx({ directDependents: 1, transitiveDependents: 3 }));
    expect(direct).toBeGreaterThan(none);
    expect(indirect).toBeGreaterThan(none);
    expect(direct).toBe(none + 8);
    expect(indirect).toBe(none + 4 + 2);
  });

  it('the foundation bonus is capped', () => {
    const r = computePriority(topic('a'), ctx({ directDependents: 50, transitiveDependents: 80 }));
    expect(r.components.foundation).toBe(PRIORITY_MODEL.foundation.max);
  });

  it('low learner confidence amplifies difficulty; high confidence dampens it', () => {
    const hard = topic('a', { difficulty: 'HARD' });
    const low = computePriority(hard, ctx({ learnerConfidence: 1 })).components.difficulty;
    const mid = computePriority(hard, ctx({ learnerConfidence: 3 })).components.difficulty;
    const high = computePriority(hard, ctx({ learnerConfidence: 5 })).components.difficulty;
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it('stated emphasis adds points', () => {
    expect(score(topic('a', { statedEmphasis: true }))).toBe(score() + PRIORITY_MODEL.emphasis);
  });

  it('urgency grows as the exam approaches and only scales importance', () => {
    expect(urgencyShare(30)).toBe(0);
    expect(urgencyShare(10)).toBeLessThan(urgencyShare(5));
    expect(urgencyShare(5)).toBeLessThan(urgencyShare(2));
    const important = topic('a', { importance: 'HIGH' });
    const trivial = topic('b', { importance: 'LOW' });
    expect(
      computePriority(important, ctx({ daysUntilExam: 2 })).components.urgency,
    ).toBeGreaterThan(0);
    expect(computePriority(trivial, ctx({ daysUntilExam: 2 })).components.urgency).toBe(0);
  });

  it('is bounded to 0-100 even for the most extreme topic', () => {
    const max = topic('a', {
      importance: 'HIGH',
      statedEmphasis: true,
      isWeak: true,
      difficulty: 'HARD',
      confidence: 1,
      evidenceCount: 5,
      revisionWeight: 1,
    });
    const r = computePriority(
      max,
      ctx({
        daysUntilExam: 1,
        learnerConfidence: 1,
        directDependents: 9,
        transitiveDependents: 20,
      }),
    );
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(80);
    const min = computePriority(
      topic('b', {
        importance: 'LOW',
        difficulty: 'EASY',
        confidence: 0,
        evidenceCount: 0,
        revisionWeight: 0,
      }),
      ctx(),
    );
    expect(min.score).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic and the reasons add up to the score', () => {
    const t = topic('a', { isWeak: true, importance: 'HIGH', statedEmphasis: true });
    const c = ctx({ directDependents: 3, transitiveDependents: 3, daysUntilExam: 6 });
    const a = computePriority(t, c);
    expect(computePriority(t, c)).toEqual(a);
    const componentSum = Object.values(a.components).reduce((x, y) => x + y, 0);
    expect(a.score).toBe(Math.min(100, componentSum));
    // reasons: positive, largest first, explain the big contributors
    expect(a.reasons.map((r) => r.points)).toEqual(
      [...a.reasons.map((r) => r.points)].sort((x, y) => y - x),
    );
    expect(a.reasons[0]?.code).toBe('IMPORTANCE');
    expect(a.reasons.some((r) => r.code === 'WEAK')).toBe(true);
    expect(a.reasons.every((r) => r.points > 0 && r.text.includes(`+${r.points}`))).toBe(true);
  });

  it('maps scores to HIGH / MEDIUM / LOW levels', () => {
    expect(computePriority(topic('a', { importance: 'HIGH', isWeak: true }), ctx()).level).toBe(
      'HIGH',
    );
    expect(
      computePriority(
        topic('a', { importance: 'LOW', difficulty: 'EASY', confidence: 0, evidenceCount: 0 }),
        ctx(),
      ).level,
    ).toBe('LOW');
  });
});
