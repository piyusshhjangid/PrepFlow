import { describe, expect, it } from 'vitest';
import { verifyQuote } from './evidence';
import {
  contentWords,
  decideImportance,
  findImportanceCue,
  paragraphAround,
  supportOf,
  wordsMatch,
} from './support';

const SYLLABUS = [
  'Course syllabus.',
  '',
  'Week 3 - Joins. Inner joins, outer joins and self joins. Choose the correct join type.',
  'Week 4 - Aggregation. GROUP BY and HAVING with COUNT, SUM and AVG. This topic carries 20 percent of the final exam.',
  'Week 5 - Normalization. First, second and third normal form.',
  '',
  'Assessment: final exam 60 percent.',
].join('\n');

const at = (quote: string) => {
  const r = verifyQuote(quote, SYLLABUS);
  if (!r.ok) throw new Error(`fixture quote not found: ${quote}`);
  return r.evidence;
};

describe('words', () => {
  it('drops filler and short words', () => {
    expect(contentWords('Introduction to the Relational Model, part 2')).toEqual([
      'relational',
      'model',
    ]);
  });
  it('matches plurals and derived forms but not unrelated words', () => {
    expect(wordsMatch('joins', 'join')).toBe(true);
    expect(wordsMatch('normalization', 'normal')).toBe(true);
    expect(wordsMatch('aggregate', 'aggregation')).toBe(true);
    expect(wordsMatch('index', 'indexes')).toBe(true);
    expect(wordsMatch('tcp', 'udp')).toBe(false);
    expect(wordsMatch('join', 'jam')).toBe(false);
  });
});

describe('paragraphAround', () => {
  it('is the single entry in a list of weekly lines, not the whole list', () => {
    const e = at('Inner joins, outer joins and self joins.');
    const { text } = paragraphAround(SYLLABUS, e.start, e.end);
    expect(text).toContain('Week 3 - Joins');
    expect(text).not.toContain('Aggregation');
    expect(text).not.toContain('Week 5');
  });
  it('is the whole paragraph for wrapped prose', () => {
    const prose =
      'First line of a paragraph about\nrouting tables and their\nlookups in routers.\n\nNext paragraph.';
    const start = prose.indexOf('routing');
    const { text } = paragraphAround(prose, start, start + 7);
    expect(text).toContain('First line');
    expect(text).toContain('lookups in routers.');
    expect(text).not.toContain('Next paragraph');
  });
  it('does not cross a PDF page break', () => {
    const pdf = 'Page one text that ends here.\fPage two begins with the topic sentence.';
    const start = pdf.indexOf('topic');
    expect(paragraphAround(pdf, start, start + 5).text).not.toContain('Page one');
  });
});

describe('supportOf', () => {
  it('is direct when the quote uses the topic words', () => {
    const e = at('Inner joins, outer joins and self joins.');
    expect(supportOf('Joins', e.quote, SYLLABUS, e.start, e.end)).toBe('direct');
  });
  it('is nearby when only the same entry uses the topic words', () => {
    const e = at('First, second and third normal form.');
    expect(supportOf('Normalization', e.quote, SYLLABUS, e.start, e.end)).toBe('direct'); // "normal" ~ "normalization"
    const f = at('GROUP BY and HAVING with COUNT, SUM and AVG.');
    expect(supportOf('Aggregation', f.quote, SYLLABUS, f.start, f.end)).toBe('nearby');
  });
  it('is weak when neither the quote nor its entry mentions the topic', () => {
    const e = at('First, second and third normal form.');
    expect(supportOf('Query optimization', e.quote, SYLLABUS, e.start, e.end)).toBe('weak');
  });
  it('does not borrow words from a neighbouring entry', () => {
    const e = at('First, second and third normal form.');
    // "Aggregation" is the previous entry; it must not count as nearby for this quote.
    expect(supportOf('Aggregation', e.quote, SYLLABUS, e.start, e.end)).toBe('weak');
  });
  it('treats a name with no content words as unknowable rather than weak', () => {
    const e = at('First, second and third normal form.');
    expect(supportOf('Basics', e.quote, SYLLABUS, e.start, e.end)).toBe('nearby');
  });
});

describe('importance signals', () => {
  it('finds a weighting sentence in the same entry and copies it from the source', () => {
    const e = at('GROUP BY and HAVING with COUNT, SUM and AVG.');
    const cue = findImportanceCue(SYLLABUS, e.start, e.end);
    expect(cue).toBe('This topic carries 20 percent of the final exam.');
    expect(SYLLABUS).toContain(cue!);
  });
  it('does not take a cue from another entry', () => {
    const e = at('First, second and third normal form.');
    expect(findImportanceCue(SYLLABUS, e.start, e.end)).toBeNull();
  });
  it('recognises other plain-language signals', () => {
    for (const phrase of [
      'This is the most important topic.',
      'Worth 15 marks.',
      'Heavily weighted in the exam.',
      'You must know this by heart.',
      'Frequently examined.',
    ]) {
      const src = `Topic line one for context.\n${phrase}`;
      expect(findImportanceCue(src, 0, 5), phrase).not.toBeNull();
    }
    expect(findImportanceCue('Nothing special here at all.', 0, 5)).toBeNull();
  });
  it('keeps "high" only when the material signals it', () => {
    const backed = at('GROUP BY and HAVING with COUNT, SUM and AVG.');
    expect(decideImportance('high', SYLLABUS, backed.start, backed.end)).toMatchObject({
      level: 'high',
      basis: 'material',
      downgraded: false,
    });
    const bare = at('First, second and third normal form.');
    expect(decideImportance('high', SYLLABUS, bare.start, bare.end)).toMatchObject({
      level: 'medium',
      basis: 'default',
      downgraded: true,
    });
  });
  it('never raises importance on its own and reports why medium is medium', () => {
    const backed = at('GROUP BY and HAVING with COUNT, SUM and AVG.');
    expect(decideImportance('medium', SYLLABUS, backed.start, backed.end).level).toBe('medium');
    expect(decideImportance('low', SYLLABUS, backed.start, backed.end).level).toBe('low');
    const bare = at('First, second and third normal form.');
    expect(decideImportance('medium', SYLLABUS, bare.start, bare.end).basis).toBe('default');
    expect(decideImportance('low', SYLLABUS, bare.start, bare.end).basis).toBe('model');
  });
});

describe('importance cues stated elsewhere in the material', () => {
  const DOC = [
    'Memory hierarchy',
    '',
    'Caches keep recently used blocks close to the processor.',
    '',
    'Pipelining',
    '',
    'A pipeline overlaps instructions.',
    '',
    'Revision hint. Cache and memory hierarchy questions are most often examined.',
  ].join('\n');
  it('uses a signalling sentence that names the topic, wherever it is', () => {
    const start = DOC.indexOf('Caches keep');
    const cue = findImportanceCue(DOC, start, start + 20, 'Memory hierarchy');
    expect(cue).toBe('Cache and memory hierarchy questions are most often examined.');
  });
  it('does not apply that sentence to a topic it does not name', () => {
    const start = DOC.indexOf('A pipeline overlaps');
    expect(findImportanceCue(DOC, start, start + 10, 'Pipelining')).toBeNull();
  });
  it('recognises "(core)" markers', () => {
    expect(findImportanceCue('- Cell theory: cells come from cells. (core)', 0, 5)).toContain(
      '(core)',
    );
  });
});
