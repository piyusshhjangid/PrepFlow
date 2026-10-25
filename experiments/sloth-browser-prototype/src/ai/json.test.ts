import { describe, expect, it } from 'vitest';
import { extractJsonObject, salvageTopicObjects } from './json';

describe('extractJsonObject', () => {
  it('parses clean JSON', () => {
    expect(extractJsonObject('{"topics": []}')).toEqual({ topics: [] });
  });
  it('strips code fences and surrounding prose', () => {
    expect(extractJsonObject('Sure! ```json\n{"a": 1}\n``` hope that helps')).toEqual({ a: 1 });
  });
  it('tolerates trailing commas', () => {
    expect(extractJsonObject('{"a": [1, 2,], "b": 2,}')).toEqual({ a: [1, 2], b: 2 });
  });
  it('is not fooled by braces inside strings', () => {
    expect(extractJsonObject('{"q": "a } b { c"}')).toEqual({ q: 'a } b { c' });
  });
  it('skips an unparseable first brace and finds a later object', () => {
    expect(extractJsonObject('{oops {"ok": true}')).toEqual({ ok: true });
  });
  it('returns undefined for nothing usable, never throws', () => {
    for (const bad of ['', 'no json here', '{"a": ', '[1,2,3]', '{{{{']) {
      expect(extractJsonObject(bad)).toBeUndefined();
    }
  });
});

describe('salvageTopicObjects', () => {
  it('returns the complete topics from a reply cut off mid-object', () => {
    const cut =
      '{"topics":[{"name":"A one","evidence":"alpha beta gamma delta epsilon"},{"name":"B two","evidence":"zeta eta theta iota kappa"},{"name":"C thr';
    const out = salvageTopicObjects(cut) as { name: string }[];
    expect(out.map((t) => t.name)).toEqual(['A one', 'B two']);
  });
  it('copes with fences, prose, trailing commas and braces inside strings', () => {
    const raw =
      'Sure!\n```json\n{"topics":[{"name":"Sets {x}","evidence":"a } b { c d e f g",},{"name":"Maps","evidence":"q r s t u v w x y z"}';
    const out = salvageTopicObjects(raw) as { name: string }[];
    expect(out.map((t) => t.name)).toEqual(['Sets {x}', 'Maps']);
  });
  it('finds nothing when there is no topics array, and never throws', () => {
    expect(salvageTopicObjects('')).toEqual([]);
    expect(salvageTopicObjects('I cannot help with that')).toEqual([]);
    expect(salvageTopicObjects('{"other":[{"name":"x"}]}')).toEqual([]);
    expect(salvageTopicObjects('{"topics":[')).toEqual([]);
  });
  it('skips an object that is itself broken but keeps later complete ones', () => {
    const raw =
      '{"topics":[{"name": oops},{"name":"Good","evidence":"one two three four five six"}]}';
    expect((salvageTopicObjects(raw) as { name: string }[]).map((t) => t.name)).toEqual(['Good']);
  });
});
