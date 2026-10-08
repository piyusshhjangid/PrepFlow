import { describe, expect, it } from 'vitest';
import {
  FakeAiProvider,
  permanentFailure,
  transientFailure,
} from '../ai/providers/fake-provider.js';
import { DBMS_TEXT, quoteFrom, readPrompt, response, topic } from '../test/ai-fixtures.js';
import { buildTestApp } from '../test/build-test-app.js';
import { computeFingerprint } from './analysis.service.js';

const examInput = {
  nickname: 'T',
  name: 'Exam',
  examDate: new Date('2026-10-20T00:00:00Z'),
  minutesPerDay: 120,
  studyDays: [1, 2, 3],
  weakTopicHints: ['Deadlocks'],
  confidence: 3,
  bufferPct: 10,
  blockedDates: [] as Date[],
};

async function setup(provider: FakeAiProvider, texts: string[] = [DBMS_TEXT]) {
  const ctx = buildTestApp({ provider });
  const exam = await ctx.setupRepo.createProfileWithExam(examInput);
  for (const [i, text] of texts.entries())
    await ctx.materialRepo.createIfAbsent({
      examId: exam.id,
      sourceType: 'TEXT',
      filename: null,
      contentHash: `hash-${i}`,
      extractedText: text,
      charCount: text.length,
      pageCount: null,
      lowTextPageCount: null,
    });
  return { ...ctx, exam };
}

/** A model that answers every chunk with topics quoted from that chunk's own material. */
const echoModel = () =>
  new FakeAiProvider((req) => {
    const { chunkId, material } = readPrompt(req);
    const n = material.indexOf('Normalization is the process');
    const d = material.indexOf('Deadlocks occur');
    const topics = [
      ...(n >= 0 ? [topic(chunkId, quoteFrom(material, 70, n), { name: 'Normalization' })] : []),
      ...(d >= 0
        ? [
            topic(chunkId, quoteFrom(material, 70, d), {
              name: 'Deadlocks',
              weakTopicMatch: 'Deadlocks',
              difficulty: 'HARD',
            }),
          ]
        : []),
    ];
    return response([{ name: 'Databases', topics }]);
  });

describe('analysis service', () => {
  it('runs the whole pipeline and stores verified topics with deterministic minutes', async () => {
    const { analysis, analysisRepo, exam } = await setup(echoModel());
    const started = await analysis.start(exam.id);
    expect(started).toMatchObject({
      reused: false,
      alreadyRunning: false,
      run: { status: 'QUEUED' },
    });
    await analysis.whenIdle();
    const { run } = await analysis.getRun(started.run.id);
    expect(run).toMatchObject({
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      topicCount: 2,
      totalChunks: 1,
      processedChunks: 1,
      failedChunks: 0,
      errorCode: null,
    });
    const result = await analysis.getResult(exam.id);
    const names = result.subjects[0]?.topics.map((t) => t.name);
    expect(names).toEqual(['Deadlocks', 'Normalization']);
    const deadlocks = result.subjects[0]?.topics[0];
    expect(deadlocks).toMatchObject({ isWeak: true, weakHint: 'Deadlocks', difficulty: 'HARD' });
    expect(deadlocks?.estimatedMinutes).toBeGreaterThan(45);
    expect(deadlocks?.evidence[0]?.snippet).toContain('Deadlocks occur');
    expect(analysisRepo.runs.size).toBe(1);
  });

  it('stores no prompts or raw responses on the run', async () => {
    const { analysis, analysisRepo, exam } = await setup(echoModel());
    await analysis.start(exam.id);
    await analysis.whenIdle();
    const json = JSON.stringify([...analysisRepo.runs.values()]);
    expect(json).not.toContain('MATERIAL');
    expect(json).not.toContain('Normalization is the process');
  });

  it('is idempotent: an identical, already-succeeded analysis makes no AI calls', async () => {
    const provider = echoModel();
    const { analysis, exam } = await setup(provider);
    await analysis.start(exam.id);
    await analysis.whenIdle();
    const callsAfterFirst = provider.calls.length;
    const again = await analysis.start(exam.id);
    expect(again).toMatchObject({
      reused: true,
      alreadyRunning: false,
      run: { status: 'SUCCEEDED' },
    });
    expect(provider.calls.length).toBe(callsAfterFirst);
  });

  it('re-analyzes when materials change, and keeps the previous run as history', async () => {
    const { analysis, analysisRepo, materialRepo, exam } = await setup(echoModel());
    await analysis.start(exam.id);
    await analysis.whenIdle();
    await materialRepo.createIfAbsent({
      examId: exam.id,
      sourceType: 'TEXT',
      filename: null,
      contentHash: 'new-hash',
      extractedText: DBMS_TEXT + '\n\nMore text about indexes and B-trees.',
      charCount: 10,
      pageCount: null,
      lowTextPageCount: null,
    });
    const second = await analysis.start(exam.id);
    expect(second.reused).toBe(false);
    await analysis.whenIdle();
    expect(analysisRepo.runs.size).toBe(2);
  });

  it('prevents simultaneous duplicate analysis of one exam', async () => {
    const { analysis, analysisRepo, exam } = await setup(
      new FakeAiProvider(
        (req) =>
          response([
            { name: 'D', topics: [topic(readPrompt(req).chunkId, quoteFrom(DBMS_TEXT, 70, 24))] },
          ]),
        'fake',
        30,
      ),
    );
    const [a, b] = await Promise.all([analysis.start(exam.id), analysis.start(exam.id)]);
    expect([a.alreadyRunning, b.alreadyRunning].sort()).toEqual([false, true]);
    expect(a.run.id).toBe(b.run.id);
    await analysis.whenIdle();
    expect(analysisRepo.runs.size).toBe(1);
  });

  it('merges topics found in several materials and keeps evidence from each', async () => {
    const second =
      'Normalization is the process of structuring a database so that redundancy is minimized across tables.';
    const { analysis, exam } = await setup(echoModel(), [DBMS_TEXT, second]);
    const provider = new FakeAiProvider((req) => {
      const { chunkId, material } = readPrompt(req);
      return response([
        {
          name: 'Databases',
          topics: [
            topic(
              chunkId,
              quoteFrom(material, 60, material.indexOf('Normalization is the process')),
              { name: 'Normalization' },
            ),
          ],
        },
      ]);
    });
    void provider;
    await analysis.start(exam.id);
    await analysis.whenIdle();
    const result = await analysis.getResult(exam.id);
    const normalization = result.subjects
      .flatMap((s) => s.topics)
      .find((t) => t.name === 'Normalization');
    expect(result.run?.materialCount).toBe(2);
    expect(result.run?.totalChunks).toBe(2);
    expect(normalization?.evidence.length).toBe(2);
  });

  it('PARTIAL when some chunks fail, with a safe warning', async () => {
    const big = Array.from(
      { length: 160 },
      (_, i) => `Paragraph ${i} about operating systems and scheduling policies of processes.`,
    ).join('\n\n');
    let call = 0;
    const provider = new FakeAiProvider((req) => {
      call++;
      if (call === 1) return 'garbage';
      if (call === 2) return 'garbage again';
      const { chunkId, material } = readPrompt(req);
      return response([
        {
          name: 'OS',
          topics: [topic(chunkId, quoteFrom(material, 60), { name: `Topic ${call}` })],
        },
      ]);
    });
    const ctx = buildTestApp({ provider });
    const exam = await ctx.setupRepo.createProfileWithExam(examInput);
    await ctx.materialRepo.createIfAbsent({
      examId: exam.id,
      sourceType: 'TEXT',
      filename: null,
      contentHash: 'big',
      extractedText: big + '\n\n' + big,
      charCount: 1,
      pageCount: null,
      lowTextPageCount: null,
    });
    await ctx.analysis.start(exam.id);
    await ctx.analysis.whenIdle();
    const { run } = (await ctx.analysis.getLatest(exam.id)) as {
      run: NonNullable<Awaited<ReturnType<typeof ctx.analysis.getLatest>>['run']>;
    };
    expect(run.status).toBe('PARTIAL');
    expect(run.failedChunks).toBe(1);
    expect(run.warnings).toContain('CHUNK_FAILED');
    expect(run.topicCount).toBeGreaterThan(0);
  });

  it('FAILED with a safe code when the model returns nothing usable', async () => {
    const { analysis, exam } = await setup(new FakeAiProvider(['no json at all']));
    const { run } = await analysis.start(exam.id);
    await analysis.whenIdle();
    expect((await analysis.getRun(run.id)).run).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_INVALID_OUTPUT',
    });
  });

  it('FAILED with NO_TOPICS_FOUND when every topic lacks verifiable evidence', async () => {
    const hallucinating = new FakeAiProvider((req) =>
      response([
        {
          name: 'X',
          topics: [
            topic(
              readPrompt(req).chunkId,
              'The mitochondria is the powerhouse of the cell and more',
            ),
          ],
        },
      ]),
    );
    const { analysis, exam } = await setup(hallucinating);
    const { run } = await analysis.start(exam.id);
    await analysis.whenIdle();
    expect((await analysis.getRun(run.id)).run).toMatchObject({
      status: 'FAILED',
      errorCode: 'NO_TOPICS_FOUND',
      droppedTopics: 1,
    });
    expect((await analysis.getResult(exam.id)).subjects).toEqual([]);
  });

  it('a permanent provider failure stops the run immediately with a safe message', async () => {
    const provider = new FakeAiProvider([permanentFailure('AI_AUTH_FAILED')]);
    const { analysis, exam } = await setup(provider);
    const { run } = await analysis.start(exam.id);
    await analysis.whenIdle();
    const finished = (await analysis.getRun(run.id)).run;
    expect(finished).toMatchObject({ status: 'FAILED', errorCode: 'AI_AUTH_FAILED' });
    expect(finished.errorMessage).not.toMatch(/Simulated/);
    expect(provider.calls).toHaveLength(1);
  });

  it('transient failures are retried and the retry count is recorded', async () => {
    const good = (req: Parameters<typeof readPrompt>[0]) => {
      const { chunkId, material } = readPrompt(req);
      return response([{ name: 'D', topics: [topic(chunkId, quoteFrom(material, 70, 24))] }]);
    };
    const provider = new FakeAiProvider((req, i) => {
      if (i < 2) throw transientFailure('AI_TIMEOUT');
      return good(req);
    });
    const { analysis, analysisRepo, exam } = await setup(provider);
    const { run } = await analysis.start(exam.id);
    await analysis.whenIdle();
    expect(analysisRepo.runs.get(run.id)).toMatchObject({ status: 'SUCCEEDED', retryCount: 2 });
  });

  it('a failed re-analysis keeps the previous good result', async () => {
    let broken = false;
    const echo = echoModel();
    const switching = new FakeAiProvider(async (req) =>
      broken ? 'garbage' : (await echo.complete(req)).text,
    );
    const { analysis, materialRepo, exam } = await setup(switching);
    await analysis.start(exam.id);
    await analysis.whenIdle();
    broken = true;
    await materialRepo.createIfAbsent({
      examId: exam.id,
      sourceType: 'TEXT',
      filename: null,
      contentHash: 'h9',
      extractedText: 'Another text about hashing and trees in data structures.',
      charCount: 1,
      pageCount: null,
      lowTextPageCount: null,
    });
    const second = await analysis.start(exam.id);
    await analysis.whenIdle();
    expect((await analysis.getRun(second.run.id)).run.status).toBe('FAILED');
    const result = await analysis.getResult(exam.id);
    expect(result.subjects[0]?.topics.map((t) => t.name)).toEqual(['Deadlocks', 'Normalization']);
  });

  it('reports a persistence failure honestly', async () => {
    const { analysis, analysisRepo, exam } = await setup(echoModel());
    analysisRepo.failSave = true;
    const { run } = await analysis.start(exam.id);
    await analysis.whenIdle();
    expect((await analysis.getRun(run.id)).run).toMatchObject({
      status: 'FAILED',
      errorCode: 'PERSISTENCE_FAILED',
    });
  });

  it('refuses without materials, and when the material needs more chunks than allowed', async () => {
    const empty = buildTestApp();
    const e = await empty.setupRepo.createProfileWithExam(examInput);
    await expect(empty.analysis.start(e.id)).rejects.toMatchObject({
      code: 'ANALYSIS_NO_MATERIALS',
      status: 422,
    });
    const huge = Array.from(
      { length: 9000 },
      (_, i) => `Paragraph number ${i} with a fair amount of words to take up space in the chunk.`,
    ).join('\n\n');
    const { analysis, exam } = await setup(echoModel(), [huge]);
    await expect(analysis.start(exam.id)).rejects.toMatchObject({ code: 'ANALYSIS_TOO_LARGE' });
  });

  it('fails runs left active by a previous process (never stuck RUNNING)', async () => {
    const { analysis, analysisRepo, exam } = await setup(echoModel());
    const { run } = await analysisRepo.createRunIfNoActive({
      examId: exam.id,
      fingerprint: 'x',
      provider: 'fake',
      model: 'm',
      materialCount: 1,
    });
    await analysisRepo.updateRun(run.id, {
      status: 'RUNNING',
      stage: 'ANALYZING',
      heartbeatAt: new Date(),
    });
    expect(await analysis.recoverInterrupted()).toBe(1);
    expect((await analysis.getRun(run.id)).run).toMatchObject({
      status: 'FAILED',
      errorCode: 'ANALYSIS_INTERRUPTED',
    });
  });

  it('treats a stale active run with no local worker as interrupted when polled', async () => {
    const { analysis, analysisRepo, exam } = await setup(echoModel());
    const { run } = await analysisRepo.createRunIfNoActive({
      examId: exam.id,
      fingerprint: 'x',
      provider: 'fake',
      model: 'm',
      materialCount: 1,
    });
    await analysisRepo.updateRun(run.id, {
      status: 'RUNNING',
      heartbeatAt: new Date(Date.now() - 3_600_000),
    });
    expect((await analysis.getRun(run.id)).run.status).toBe('FAILED');
  });

  it('limits concurrent analyses: a second exam waits for the slot', async () => {
    const provider = new FakeAiProvider(
      (req) => {
        const { chunkId, material } = readPrompt(req);
        return response([{ name: 'D', topics: [topic(chunkId, quoteFrom(material, 70, 24))] }]);
      },
      'fake',
      25,
    );
    const ctx = buildTestApp({ provider, maxConcurrent: 1 });
    const ids: string[] = [];
    for (const i of [1, 2]) {
      const e = await ctx.setupRepo.createProfileWithExam(examInput);
      await ctx.materialRepo.createIfAbsent({
        examId: e.id,
        sourceType: 'TEXT',
        filename: null,
        contentHash: `c${i}`,
        extractedText: DBMS_TEXT,
        charCount: 1,
        pageCount: null,
        lowTextPageCount: null,
      });
      ids.push(e.id);
    }
    await Promise.all(ids.map((id) => ctx.analysis.start(id)));
    let maxInFlight = 0;
    const timer = setInterval(() => {
      maxInFlight = Math.max(
        maxInFlight,
        [...ctx.analysisRepo.runs.values()].filter((r) => r.status === 'RUNNING').length,
      );
    }, 5);
    await ctx.analysis.whenIdle();
    clearInterval(timer);
    expect(maxInFlight).toBeLessThanOrEqual(1);
    expect([...ctx.analysisRepo.runs.values()].every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('unknown exam gives 404', async () => {
    const { analysis } = buildTestApp();
    await expect(analysis.start('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'EXAM_NOT_FOUND',
    });
  });
});

describe('computeFingerprint', () => {
  const base = {
    provider: 'ollama',
    model: 'm',
    chunkConfig: { targetChars: 1, maxChars: 2, maxChunks: 3 },
    materials: [{ contentHash: 'a' }, { contentHash: 'b' }],
    weakTopicHints: ['X', 'Y'],
  };
  it('ignores ordering and casing of inputs', () => {
    expect(computeFingerprint(base)).toBe(
      computeFingerprint({
        ...base,
        materials: [{ contentHash: 'b' }, { contentHash: 'a' }],
        weakTopicHints: ['y', 'x'],
      }),
    );
  });
  it.each([
    ['provider', { provider: 'gemini' }],
    ['model', { model: 'n' }],
    ['materials', { materials: [{ contentHash: 'a' }] }],
    ['weak hints', { weakTopicHints: ['X'] }],
    ['chunk size', { chunkConfig: { targetChars: 9, maxChars: 9, maxChunks: 3 } }],
  ])('changes when %s changes', (_n, override) =>
    expect(computeFingerprint({ ...base, ...override })).not.toBe(computeFingerprint(base)),
  );
});
