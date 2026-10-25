import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { outlineMaterial } from '../ai/analyze';
import { extractOutline } from './outline';

const sample = (n: string) =>
  readFileSync(new URL(`../../eval/samples/${n}`, import.meta.url), 'utf8');

describe('extractOutline', () => {
  it('reads labelled weekly entries and names them from the text', () => {
    const topics = extractOutline(sample('01-structured-syllabus.txt'));
    expect(topics.map((t) => t.name)).toEqual([
      'Relational model',
      'SQL basics',
      'Joins',
      'Aggregation',
      'Normalization',
      'Transactions',
      'Indexes',
    ]);
  });
  it('flags a weighting sentence as high importance and nothing else', () => {
    const topics = extractOutline(sample('01-structured-syllabus.txt'));
    expect(topics.filter((t) => t.importance === 'high').map((t) => t.name)).toEqual([
      'Aggregation',
    ]);
  });
  it('uses heading lines followed by a paragraph, with the first sentence as the quote', () => {
    const topics = extractOutline(sample('04-ambiguous-headings.txt'));
    expect(topics.map((t) => t.name)).toContain('Part 2');
    const part2 = topics.find((t) => t.name === 'Part 2')!;
    expect(part2.evidence.startsWith('Elasticity measures')).toBe(true);
  });
  it('does not mistake the document title for a topic', () => {
    const topics = extractOutline(sample('03-repeated-overlapping.txt'));
    expect(topics.map((t) => t.name)).not.toContain('Computer networks revision notes');
    expect(topics.map((t) => t.name)).toEqual([
      'Transport layer',
      'Reliability',
      'Congestion',
      'UDP',
    ]);
  });
  it('skips logistics such as guest lectures and reading lists', () => {
    const topics = extractOutline(sample('05-insufficient-information.txt'));
    expect(topics).toEqual([]);
  });
  it('finds nothing in unstructured prose, which is where a model is needed', () => {
    expect(extractOutline(sample('02-dense-lecture-notes.txt'))).toEqual([]);
  });
  it('handles bullets, numbered items and markdown headings', () => {
    const text = [
      '# Course',
      '',
      '## Limits',
      'A limit describes the value a function approaches near a point.',
      '',
      '1. Derivatives: the rate of change of a function at a point.',
      '- Integrals: the area under a curve between two bounds.',
    ].join('\n');
    expect(extractOutline(text).map((t) => t.name)).toEqual(['Limits', 'Derivatives', 'Integrals']);
  });
  it('drops duplicates and entries too short to prove anything', () => {
    const text =
      'Week 1: Limits and continuity of functions.\nWeek 2: Limits and continuity of functions.\nWeek 3: Go.';
    expect(extractOutline(text).map((t) => t.name)).toEqual(['Limits and continuity of functions']);
  });
  it('never returns a quote that is not in the source', () => {
    for (const f of [
      '01-structured-syllabus.txt',
      '03-repeated-overlapping.txt',
      '04-ambiguous-headings.txt',
    ]) {
      const text = sample(f);
      for (const t of extractOutline(text)) expect(text).toContain(t.evidence);
    }
  });
  it('caps very long entries to one contiguous passage', () => {
    const long = `Week 1: Topic. ${'A sentence about the topic that goes on. '.repeat(30)}`;
    const [t] = extractOutline(long);
    expect(t!.evidence.length).toBeLessThanOrEqual(300);
    expect(long).toContain(t!.evidence);
  });
});

describe('outlineMaterial', () => {
  it('labels everything as rule-based and verifies like model output', () => {
    const { topics, report } = outlineMaterial(sample('01-structured-syllabus.txt'));
    expect(report).toMatchObject({ mode: 'outline', provider: 'outline-rules', verifiedTopics: 7 });
    expect(topics.every((t) => t.origin === 'outline' && t.status === 'verified')).toBe(true);
    expect(topics.find((t) => t.name === 'Aggregation')).toMatchObject({
      importance: 'high',
      importanceBasis: 'material',
    });
  });
  it('rejects empty and tiny material with the same message the model path uses', () => {
    expect(() => outlineMaterial('')).toThrow(RangeError);
    expect(() => outlineMaterial('too short')).toThrow(RangeError);
  });
  it('returns zero topics, not an error, for material with no structure', () => {
    const { topics, report } = outlineMaterial(sample('02-dense-lecture-notes.txt'));
    expect(topics).toEqual([]);
    expect(report.verifiedTopics).toBe(0);
  });
});
