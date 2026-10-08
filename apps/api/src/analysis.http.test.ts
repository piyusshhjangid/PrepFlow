import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeAiProvider } from './ai/providers/fake-provider.js';
import { DBMS_TEXT, quoteFrom, readPrompt, response, topic } from './test/ai-fixtures.js';
import { buildTestApp } from './test/build-test-app.js';

const setupBody = {
  nickname: 'Asha',
  examName: 'Sem 5',
  examDate: '2026-10-20',
  minutesPerDay: 120,
  studyDays: [1, 2, 3],
  weakTopicHints: ['Deadlocks'],
};

const model = () =>
  new FakeAiProvider((req) => {
    const { chunkId, material } = readPrompt(req);
    return response([
      {
        name: 'Databases',
        topics: [topic(chunkId, quoteFrom(material, 70, material.indexOf('Normalization is')))],
      },
    ]);
  });

async function ready() {
  const ctx = buildTestApp({ provider: model() });
  const examId = (await request(ctx.app).post('/api/profiles').send(setupBody)).body.exam
    .id as string;
  await request(ctx.app).post(`/api/exams/${examId}/materials/text`).send({ text: DBMS_TEXT });
  return { ...ctx, examId };
}

describe('analysis HTTP API', () => {
  it('start → poll → result, end to end through real HTTP routing', async () => {
    const { app, analysis, examId } = await ready();
    expect((await request(app).get(`/api/exams/${examId}/analysis/latest`)).body).toEqual({
      run: null,
    });
    const start = await request(app).post(`/api/exams/${examId}/analysis`);
    expect(start.status).toBe(202);
    expect(start.body.run.status).toBe('QUEUED');
    await analysis.whenIdle();
    const run = await request(app).get(`/api/analysis-runs/${start.body.run.id}`);
    expect(run.body.run).toMatchObject({ status: 'SUCCEEDED', stage: 'COMPLETED' });
    const result = await request(app).get(`/api/exams/${examId}/analysis/result`);
    expect(result.status).toBe(200);
    expect(result.body.subjects[0].topics[0]).toMatchObject({
      name: 'Normalization',
      evidence: [{ page: null }],
    });
    expect(result.body.totalEstimatedMinutes).toBeGreaterThan(0);
  });

  it('answers 200 with reused=true for an identical repeat, and never leaks internals', async () => {
    const { app, analysis, examId } = await ready();
    await request(app).post(`/api/exams/${examId}/analysis`);
    await analysis.whenIdle();
    const again = await request(app).post(`/api/exams/${examId}/analysis`);
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);
    const text = JSON.stringify(again.body);
    expect(text).not.toMatch(/fingerprint|prompt|apiKey|heartbeat/i);
  });

  it('maps problems to the standard error shape', async () => {
    const { app } = buildTestApp();
    const examId = (await request(app).post('/api/profiles').send(setupBody)).body.exam
      .id as string;
    const none = await request(app).post(`/api/exams/${examId}/analysis`);
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('ANALYSIS_NO_MATERIALS');
    expect((await request(app).post('/api/exams/not-a-uuid/analysis')).status).toBe(400);
    expect(
      (await request(app).post('/api/exams/00000000-0000-4000-8000-000000000000/analysis')).status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/analysis-runs/00000000-0000-4000-8000-000000000000')).body.error
        .code,
    ).toBe('ANALYSIS_NOT_FOUND');
    expect((await request(app).get('/api/analysis-runs/nope')).status).toBe(400);
  });

  it('rate-limits analysis starts', async () => {
    const limited = buildTestApp({
      provider: model(),
      rateLimits: {
        uploads: { windowMs: 60_000, limit: 100 },
        profiles: { windowMs: 60_000, limit: 100 },
        analysis: { windowMs: 60_000, limit: 2 },
        planning: { windowMs: 60_000, limit: 100 },
      },
    });
    const examId = (await request(limited.app).post('/api/profiles').send(setupBody)).body.exam
      .id as string;
    await request(limited.app)
      .post(`/api/exams/${examId}/materials/text`)
      .send({ text: DBMS_TEXT });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++)
      codes.push((await request(limited.app).post(`/api/exams/${examId}/analysis`)).status);
    await limited.analysis.whenIdle();
    expect(codes[2]).toBe(429);
  });
});
