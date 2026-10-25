import { describe, expect, it } from 'vitest';
import { ScriptedProvider } from '../src/ai/fake';
import { AiError } from '../src/ai/errors';
import { runEval, toMarkdownTable, type Sample } from './runner';

const text =
  'Unit 1 Kinematics. Students describe motion using displacement, velocity and acceleration.\n\nUnit 2 Energy. Work is force applied over a distance in closed systems.';
const sample: Sample = {
  id: 's1',
  kind: 'syllabus',
  text,
  expectedKeywords: ['kinematic', 'energy', 'optics'],
  expectedTopicRange: [1, 3],
};
const topic = (name: string, evidence: string) => ({
  name,
  description: '',
  evidence,
  effort: 'medium',
  difficulty: 2,
});

describe('runEval (scripted provider: tests the harness, not a model)', () => {
  it('records verified counts, keyword hits and timing', async () => {
    let t = 0;
    const provider = new ScriptedProvider(() =>
      JSON.stringify({
        topics: [
          topic(
            'Kinematics',
            'Students describe motion using displacement, velocity and acceleration.',
          ),
          topic('Invented', 'a passage that is not in the material at all'),
        ],
      }),
    );
    const [r] = await runEval(provider, [sample], () => (t += 1000));
    expect(r).toMatchObject({
      ok: true,
      keywordHits: ['kinematic'],
      keywordMisses: ['energy', 'optics'],
      topicCountInRange: true,
      verifiedShare: 0.5,
    });
    expect(r!.report).toMatchObject({ verifiedTopics: 1, unverifiedTopics: 1 });
    expect(r!.seconds).toBeGreaterThan(0);
  });
  it('records a provider failure as a fixed error code and keeps going', async () => {
    const provider = new ScriptedProvider(() => {
      throw new AiError('MODEL_NOT_FOUND');
    });
    const results = await runEval(provider, [sample, { ...sample, id: 's2' }]);
    expect(results.map((r) => [r.id, r.ok, r.errorCode])).toEqual([
      ['s1', false, 'MODEL_NOT_FOUND'],
      ['s2', false, 'MODEL_NOT_FOUND'],
    ]);
  });
  it('records rejected input without calling the model', async () => {
    const provider = new ScriptedProvider(() => '{}');
    const [r] = await runEval(provider, [{ ...sample, text: 'tiny' }]);
    expect(r).toMatchObject({ ok: false, errorCode: 'INPUT_REJECTED' });
    expect(provider.requests).toHaveLength(0);
  });
  it('renders a markdown table', async () => {
    const provider = new ScriptedProvider(() => JSON.stringify({ topics: [] }));
    const md = toMarkdownTable(await runEval(provider, [sample]));
    expect(md.split('\n')).toHaveLength(3);
    expect(md).toContain('| s1 |');
  });
});
