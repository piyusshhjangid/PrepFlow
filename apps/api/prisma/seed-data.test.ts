import { describe, expect, it } from 'vitest';
import { buildMaterialText, subjects } from './seed-data.js';

const allTopics = subjects.flatMap((subject) => subject.topics);

describe('demo seed data', () => {
  it('has unique topic names', () => {
    const names = allTopics.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses only verbatim phrases from the material as evidence', () => {
    const text = buildMaterialText();
    for (const topic of allTopics) {
      expect(text, topic.name).toContain(topic.phrase);
    }
  });

  it('only references prerequisites that exist', () => {
    const names = new Set(allTopics.map((t) => t.name));
    for (const topic of allTopics) {
      for (const prerequisite of topic.prerequisites ?? []) {
        expect(names.has(prerequisite), `${topic.name} -> ${prerequisite}`).toBe(true);
      }
    }
  });

  it('has no prerequisite cycles', () => {
    const edges = new Map(allTopics.map((t) => [t.name, t.prerequisites ?? []]));
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string): void => {
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') throw new Error(`cycle through ${name}`);
      state.set(name, 'visiting');
      for (const next of edges.get(name) ?? []) visit(next);
      state.set(name, 'done');
    };
    expect(() => allTopics.forEach((t) => visit(t.name))).not.toThrow();
  });

  it('has a workload larger than the 24h available, so the demo shows an honest tradeoff', () => {
    const totalMinutes = allTopics.reduce((sum, t) => sum + t.minutes, 0);
    expect(totalMinutes).toBeGreaterThan(8 * 180);
  });
});
