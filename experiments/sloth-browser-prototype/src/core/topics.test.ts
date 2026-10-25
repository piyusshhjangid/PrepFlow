import { describe, expect, it } from 'vitest';
import { topic } from '../test/factories';
import {
  applyKnownTopics,
  breakCycles,
  clampMinutes,
  estimateMinutes,
  nameSimilarity,
  uniqueId,
} from './topics';

describe('topic utilities', () => {
  it('estimates minutes from two coarse labels, in 5-minute steps within bounds', () => {
    expect(estimateMinutes('short', 1)).toBe(25);
    expect(estimateMinutes('medium', 2)).toBe(60);
    expect(estimateMinutes('long', 3)).toBe(150);
    for (const e of ['short', 'medium', 'long'] as const)
      for (const d of [1, 2, 3] as const) expect(estimateMinutes(e, d) % 5).toBe(0);
  });
  it('clamps user-entered minutes', () => {
    expect(clampMinutes(3)).toBe(15);
    expect(clampMinutes(99999)).toBe(600);
    expect(clampMinutes(62)).toBe(60);
    expect(clampMinutes(Number.NaN)).toBe(15);
  });
  it('compares names without being fooled by punctuation, case or one-word overlap', () => {
    expect(nameSimilarity("Newton's Laws", 'newtons laws')).toBe(1);
    expect(nameSimilarity('Newton laws of motion', 'Newton Laws of Motion!')).toBe(1);
    expect(nameSimilarity('Energy', 'Energy conservation')).toBe(0);
    expect(nameSimilarity('Heat transfer methods', 'Heat engines and cycles')).toBeLessThan(0.8);
  });
  it('makes unique ids', () => {
    const taken = new Set<string>();
    expect(uniqueId('Forces', taken)).toBe('forces');
    expect(uniqueId('Forces!', taken)).toBe('forces-2');
    expect(uniqueId('???', taken)).toBe('topic');
  });
  it('breaks prerequisite cycles deterministically', () => {
    const a = topic({ id: 'a', order: 1, prerequisites: ['c'] });
    const b = topic({ id: 'b', order: 2, prerequisites: ['a'] });
    const c = topic({ id: 'c', order: 3, prerequisites: ['b'] });
    expect(breakCycles([a, b, c])).toBe(1);
    const edges = [a, b, c].flatMap((t) => t.prerequisites.map((p) => `${p}->${t.id}`));
    expect(edges).toHaveLength(2);
  });
  it('marks known topics from free text', () => {
    const topics = [
      topic({ id: 'a', name: 'Kinematics' }),
      topic({ id: 'b', name: 'Newton’s Laws of Motion' }),
      topic({ id: 'c', name: 'Energy' }),
    ];
    const result = applyKnownTopics(topics, 'kinematics\nnewton laws of motion, ab');
    expect(result.map((t) => t.done)).toEqual([true, true, false]);
    expect(applyKnownTopics(topics, '  ')).toBe(topics);
  });
});
