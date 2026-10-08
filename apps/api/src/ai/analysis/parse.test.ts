import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseModelOutput } from './parse.js';
import { topic } from '../../test/ai-fixtures.js';

const good = (extra: object = {}) => ({
  subjects: [{ name: 'DBMS', topics: [{ ...topic('c1', 'x'.repeat(30)), ...extra }] }],
});

describe('extractJsonObject', () => {
  it('finds an object inside prose and ignores braces in strings', () => {
    expect(extractJsonObject('Sure! {"a":"}{","b":{"c":1}} done')).toBe('{"a":"}{","b":{"c":1}}');
  });
  it('returns null for truncated output', () => {
    expect(extractJsonObject('{"a": {"b": 1')).toBeNull();
  });
});

describe('parseModelOutput', () => {
  it('parses clean JSON', () => {
    const r = parseModelOutput(JSON.stringify(good()));
    expect(r.ok && r.value.topics).toHaveLength(1);
  });
  it('parses JSON inside markdown fences with surrounding prose', () => {
    const r = parseModelOutput(
      `Here you go:\n\`\`\`json\n${JSON.stringify(good())}\n\`\`\`\nHope that helps!`,
    );
    expect(r.ok && r.value.topics).toHaveLength(1);
  });
  it('tolerates trailing commas', () => {
    const text = JSON.stringify(good()).replace('}]}]}', '},]},]}');
    expect(parseModelOutput(text).ok).toBe(true);
  });
  it('fails clearly on no JSON, broken JSON and wrong shape', () => {
    expect(parseModelOutput('I cannot help with that.')).toMatchObject({
      ok: false,
      failure: 'NO_JSON',
    });
    expect(parseModelOutput('{"subjects": [ {"name": }')).toMatchObject({ ok: false });
    expect(parseModelOutput('{"subjects": "none"}')).toMatchObject({
      ok: false,
      failure: 'WRONG_SHAPE',
    });
  });
  it('drops only the invalid topics (partially valid JSON)', () => {
    const input = {
      subjects: [
        {
          name: 'DBMS',
          topics: [
            topic('c1', 'x'.repeat(30)),
            { name: 'Broken' },
            { ...topic('c1', 'y'), difficulty: 'IMPOSSIBLE' },
          ],
        },
      ],
    };
    const r = parseModelOutput(JSON.stringify(input));
    expect(r.ok && r.value.topics).toHaveLength(1);
    expect(r.ok && r.value.invalidTopics).toBe(2);
  });
  it('rejects topics without evidence and out-of-range confidence', () => {
    const r1 = parseModelOutput(JSON.stringify(good({ evidence: [] })));
    expect(r1.ok && r1.value.topics).toHaveLength(0);
    const r2 = parseModelOutput(JSON.stringify(good({ confidence: 7 })));
    expect(r2.ok && r2.value.topics).toHaveLength(0);
  });
  it('strips unexpected fields, including page numbers and minutes the model invents', () => {
    const r = parseModelOutput(
      JSON.stringify(good({ page: 99, estimatedMinutes: 9999, hours: 40 })),
    );
    const parsed = r.ok ? r.value.topics[0]?.topic : undefined;
    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('estimatedMinutes');
    expect(parsed).not.toHaveProperty('hours');
  });
  it('is not affected by __proto__ keys (no prototype pollution)', () => {
    const text =
      '{"__proto__":{"polluted":true},"subjects":[],"constructor":{"prototype":{"polluted":true}}}';
    parseModelOutput(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
