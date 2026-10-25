import { describe, expect, it } from 'vitest';
import { classifyEvidenceSupport, findImportanceCue } from './support.js';

describe('classifyEvidenceSupport', () => {
  it('labels a quote that names the topic as direct support', () => {
    const source = 'Binary search repeatedly halves the search range until the target is found.';
    const quote = source;
    expect(classifyEvidenceSupport('Binary search', quote, source, 0, source.length)).toBe(
      'direct',
    );
  });

  it('labels a quote whose paragraph names the topic as nearby support', () => {
    const source =
      'Binary search compares the middle value with the target.\nIt halves the range until it finds the target.';
    const quote = 'It halves the range until it finds the target.';
    const start = source.indexOf(quote);
    expect(
      classifyEvidenceSupport('Binary search', quote, source, start, start + quote.length),
    ).toBe('nearby');
  });

  it('marks verified but unrelated evidence as a weak topic link', () => {
    const source = 'A queue stores items in order.\n\nIt removes the earliest item first.';
    const quote = 'It removes the earliest item first.';
    const start = source.indexOf(quote);
    expect(
      classifyEvidenceSupport('Binary search', quote, source, start, start + quote.length),
    ).toBe('weak');
  });

  it('uses the full topic name rather than calling an empty topic name weak', () => {
    expect(
      classifyEvidenceSupport(
        'A',
        'A valid source passage contains enough words.',
        'A valid source passage contains enough words.',
        0,
        50,
      ),
    ).toBe('nearby');
  });

  it('returns a source-backed importance cue for a high-importance topic', () => {
    const source =
      'Binary search is frequently tested on the final exam. It halves the search range.';
    const quote = 'Binary search is frequently tested on the final exam.';
    const start = source.indexOf(quote);
    expect(
      findImportanceCue(
        'Binary search is frequently tested on the final exam.',
        start,
        start + quote.length,
        'Binary search',
      ),
    ).toBe('Binary search is frequently tested on the final exam.');
  });

  it('does not invent an importance cue when the material gives no signal', () => {
    const source = 'Binary search halves the range until it finds the target.';
    expect(findImportanceCue(source, 0, source.length, 'Binary search')).toBeNull();
  });

  it('does not borrow an importance cue from an unrelated item', () => {
    const source =
      'Binary search halves the range to find the target.\n\nQueues are frequently tested on the final exam.';
    const quote = 'Binary search halves the range to find the target.';
    expect(findImportanceCue(source, 0, quote.length, 'Binary search')).toBeNull();
  });
});
