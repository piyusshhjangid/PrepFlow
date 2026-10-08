import { describe, expect, it } from 'vitest';
import type { ValidatedTopic } from './analyze-chunk.js';
import { matchWeakHint, mergeTopics, nameKey, sameName } from './merge.js';

const ev = (materialId: string, snippet: string, page: number | null = 1) => ({
  chunkId: 'c',
  materialId,
  page,
  pageEnd: null,
  snippet,
});
const t = (over: Partial<ValidatedTopic> = {}): ValidatedTopic => ({
  subject: 'Databases',
  name: 'Normalization',
  parent: null,
  summary: 'About normal forms',
  difficulty: 'MEDIUM',
  importance: 'MEDIUM',
  effort: 'STANDARD',
  revisionNeed: 'MEDIUM',
  origin: 'EXTRACTED',
  statedEmphasis: false,
  confidence: 0.8,
  prerequisites: [],
  weakTopicMatch: null,
  evidence: [ev('m1', 'first snippet')],
  ...over,
});

describe('mergeTopics', () => {
  it('merges the same topic found in two materials and keeps evidence from both', () => {
    const merged = mergeTopics(
      [
        t({ evidence: [ev('m1', 'from pdf one', 3)] }),
        t({ name: 'normalization', evidence: [ev('m2', 'from pdf two', null)] }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.topics).toHaveLength(1);
    const topic = merged[0]?.topics[0];
    expect(topic?.evidence.map((e) => e.materialId).sort()).toEqual(['m1', 'm2']);
  });
  it('merges near-identical names and subjects, keeps genuinely different topics apart', () => {
    const merged = mergeTopics(
      [
        t({ name: 'Database Normalization' }),
        t({ name: 'Normalization (Database)', subject: 'databases' }),
        t({ name: 'Transactions' }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.topics.map((x) => x.name).sort()).toEqual([
      'Database Normalization',
      'Transactions',
    ]);
  });
  it('is independent of input order', () => {
    const input = [
      t({ name: 'B topic' }),
      t({ name: 'A topic', subject: 'Z' }),
      t({ name: 'B topic', difficulty: 'HARD' }),
    ];
    expect(mergeTopics(input, [])).toEqual(mergeTopics([...input].reverse(), []));
  });
  it('combines attributes deterministically', () => {
    const merged = mergeTopics(
      [
        t({
          difficulty: 'EASY',
          importance: 'LOW',
          effort: 'QUICK',
          confidence: 0.6,
          statedEmphasis: true,
        }),
        t({ difficulty: 'HARD', importance: 'HIGH', effort: 'EXTENSIVE', confidence: 1 }),
      ],
      [],
    );
    const topic = merged[0]?.topics[0];
    expect(topic).toMatchObject({
      difficulty: 'MEDIUM',
      importance: 'HIGH',
      effort: 'EXTENSIVE',
      confidence: 0.8,
      statedEmphasis: true,
    });
  });
  it('computes minutes in code, never from the model', () => {
    const topic = mergeTopics(
      [t({ effort: 'EXTENSIVE', difficulty: 'HARD', importance: 'HIGH' })],
      [],
    )[0]?.topics[0];
    expect(topic?.estimatedMinutes).toBeGreaterThan(90);
    expect(topic?.estimatedMinutes).toBeLessThanOrEqual(240);
  });
  it('deduplicates evidence and caps it at five items', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev('m1', `snippet number ${i}`, i + 1));
    const topic = mergeTopics([t({ evidence: [...many, many[0] as ReturnType<typeof ev>] })], [])[0]
      ?.topics[0];
    expect(topic?.evidence).toHaveLength(5);
  });
  it('flags weak topics from hints and raises their revision weight', () => {
    const merged = mergeTopics(
      [t({ name: 'Deadlocks and Prevention' }), t({ name: 'Joins' })],
      ['Deadlocks'],
    );
    const topics = merged[0]?.topics ?? [];
    expect(topics.find((x) => x.name === 'Deadlocks and Prevention')).toMatchObject({
      isWeak: true,
      weakHint: 'Deadlocks',
    });
    expect(topics.find((x) => x.name === 'Joins')).toMatchObject({ isWeak: false, weakHint: null });
  });
});

describe('weak hint matching', () => {
  it('rejects a model claim that has nothing to do with the topic', () => {
    expect(matchWeakHint({ name: 'Joins', weakTopicMatch: 'Deadlocks' }, ['Deadlocks'])).toBeNull();
  });
  it('rejects a claim that is not one of the student hints', () => {
    expect(matchWeakHint({ name: 'Joins', weakTopicMatch: 'Joins' }, ['Deadlocks'])).toBeNull();
  });
  it('accepts a corroborated claim', () => {
    expect(
      matchWeakHint({ name: 'Deadlock Handling', weakTopicMatch: 'deadlocks' }, ['Deadlocks']),
    ).toBe('Deadlocks');
  });
});

describe('name helpers', () => {
  it('nameKey ignores case, accents and punctuation', () => {
    expect(nameKey('  Café—Ordering!! ')).toBe('cafe ordering');
  });
  it('sameName folds plurals but does not equate a topic with a broader one', () => {
    expect(sameName('Binary Search Tree', 'Binary search trees')).toBe(true);
    expect(sameName('Binary Search Tree', 'Binary Search')).toBe(false);
  });
});
