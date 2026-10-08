import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from './test/build-test-app.js';

const setupBody = {
  nickname: 'Asha',
  examName: 'Finals',
  examDate: '2026-10-25',
  minutesPerDay: 180,
  studyDays: [1, 2, 3, 4, 5, 6],
  weakTopicHints: [],
};
const words = (word: string) => `${Array.from({ length: 20 }, () => word).join(' ')}.`;

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(() => {
  ctx = buildTestApp();
});

async function createExam(nickname: string): Promise<string> {
  const res = await request(ctx.app)
    .post('/api/profiles')
    .send({ ...setupBody, nickname });
  expect(res.status).toBe(201);
  return res.body.exam.id as string;
}

describe('workspace isolation (exam ids are the access keys)', () => {
  it('never lists one workspace’s materials under another workspace', async () => {
    const a = await createExam('Asha');
    const b = await createExam('Bela');
    const added = await request(ctx.app)
      .post(`/api/exams/${a}/materials/text`)
      .send({ text: `Unit 1\n${words('secret-a')}` });
    expect(added.status).toBe(201);

    const listB = await request(ctx.app).get(`/api/exams/${b}/materials`);
    expect(listB.status).toBe(200);
    expect(listB.body.materials).toHaveLength(0);
    expect(JSON.stringify(listB.body)).not.toContain('secret-a');

    const listA = await request(ctx.app).get(`/api/exams/${a}/materials`);
    expect(listA.body.materials).toHaveLength(1);
  });

  it('keeps identical text in two workspaces as two separate materials', async () => {
    const a = await createExam('Asha');
    const b = await createExam('Bela');
    const text = `Unit 1\n${words('shared')}`;
    const first = await request(ctx.app).post(`/api/exams/${a}/materials/text`).send({ text });
    const second = await request(ctx.app).post(`/api/exams/${b}/materials/text`).send({ text });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.duplicate).toBe(false);
    expect(second.body.material.id).not.toBe(first.body.material.id);
  });

  it('exposes no analysis result or plan for a workspace that has none', async () => {
    const a = await createExam('Asha');
    const b = await createExam('Bela');
    await request(ctx.app)
      .post(`/api/exams/${a}/materials/text`)
      .send({ text: `Unit 1\n${words('only-a')}` });

    const latest = await request(ctx.app).get(`/api/exams/${b}/analysis/latest`);
    expect(latest.status).toBe(200);
    expect(JSON.stringify(latest.body)).not.toContain('only-a');

    const plan = await request(ctx.app).get(`/api/exams/${b}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.body.plan).toBeNull();
  });

  it('answers unknown and malformed workspace ids without revealing anything', async () => {
    const unknown = '00000000-0000-4000-8000-0000000000aa';
    for (const path of [
      `/api/exams/${unknown}`,
      `/api/exams/${unknown}/materials`,
      `/api/exams/${unknown}/plan`,
      `/api/exams/${unknown}/plan/today`,
      `/api/exams/${unknown}/analysis/latest`,
    ]) {
      const res = await request(ctx.app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code, path).toMatch(/NOT_FOUND/);
    }
    const malformed = await request(ctx.app).get('/api/exams/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).not.toMatch(/prisma|select|stack|node_modules/i);
  });

  it('rejects task actions for unknown task ids', async () => {
    const unknown = '00000000-0000-4000-8000-0000000000bb';
    for (const action of ['start', 'complete', 'skip', 'uncomplete']) {
      const res = await request(ctx.app).post(`/api/study-tasks/${unknown}/${action}`).send({});
      expect(res.status, action).toBe(404);
    }
  });
});

describe('request hardening', () => {
  it('returns a clean 400 for malformed JSON', async () => {
    const res = await request(ctx.app)
      .post('/api/profiles')
      .set('Content-Type', 'application/json')
      .send('{"nickname": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at \w+ \(/);
  });

  it('returns 413 for bodies over the JSON limit', async () => {
    const id = await createExam('Asha');
    const res = await request(ctx.app)
      .post(`/api/exams/${id}/materials/text`)
      .send({ text: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a non-PDF upload with a user-readable error', async () => {
    const id = await createExam('Asha');
    const res = await request(ctx.app)
      .post(`/api/exams/${id}/materials/pdf`)
      .attach('file', Buffer.from('just some text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('rejects a file that claims to be a PDF but is not', async () => {
    const id = await createExam('Asha');
    const res = await request(ctx.app)
      .post(`/api/exams/${id}/materials/pdf`)
      .attach('file', Buffer.from('this is not a pdf'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBeTruthy();
  });

  it('sends security headers and does not advertise the framework', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not echo a disallowed CORS origin', async () => {
    const res = await request(ctx.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('health reports status without secrets', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|password|key|secret/i);
  });
});
