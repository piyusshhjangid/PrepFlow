import request from 'supertest';
import { DEFAULT_MATERIAL_LIMITS } from '@prepflow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryMaterialRepository, InMemorySetupRepository } from './test/in-memory.js';
import { buildTestApp } from './test/build-test-app.js';
import { makePdf } from './test/make-pdf.js';

const words = (word: string) => `${Array.from({ length: 20 }, () => word).join(' ')}.`;
const NOTES = `Unit 1\n${words('normalization')}\nUnit 2\n${words('deadlocks')}`;
const setupBody = {
  nickname: 'Asha',
  examName: 'DBMS Final',
  examDate: '2026-10-11',
  minutesPerDay: 180,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  weakTopicHints: ['Normalization'],
};
const NIL_UUID = '00000000-0000-4000-8000-000000000099';

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(() => {
  ctx = buildTestApp();
});

async function createExam(app = ctx.app): Promise<string> {
  const res = await request(app).post('/api/profiles').send(setupBody);
  return res.body.exam.id as string;
}

describe('setup endpoints', () => {
  it('POST /api/profiles creates a workspace and reports availability', async () => {
    const res = await request(ctx.app).post('/api/profiles').send(setupBody);
    expect(res.status).toBe(201);
    expect(res.body.exam).toMatchObject({
      name: 'DBMS Final',
      examDate: '2026-10-11',
      availability: { daysUntilExam: 8, studyDays: 8, availableMinutes: 1440 },
    });
    expect(res.body.profileId).toBe(res.body.exam.profileId);
  });

  it('rejects invalid input with field-level details, and unknown fields', async () => {
    const bad = await request(ctx.app)
      .post('/api/profiles')
      .send({ ...setupBody, minutesPerDay: 5, studyDays: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(bad.body.error.details)).toContain('minutesPerDay');

    const extra = await request(ctx.app)
      .post('/api/profiles')
      .send({ ...setupBody, isAdmin: true });
    expect(extra.status).toBe(400);
    expect(ctx.setupRepo.exams.size).toBe(0);
  });

  it('rejects a past exam date with a specific, actionable message', async () => {
    const res = await request(ctx.app)
      .post('/api/profiles')
      .send({ ...setupBody, examDate: '2026-09-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXAM_DATE_IN_PAST');
    expect(res.body.error.message).toMatch(/Pick today or a later date/);
  });

  it('GET /api/exams/:id returns the exam; unknown id is 404; malformed id is 400', async () => {
    const id = await createExam();
    expect((await request(ctx.app).get(`/api/exams/${id}`)).body.id).toBe(id);
    const missing = await request(ctx.app).get(`/api/exams/${NIL_UUID}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EXAM_NOT_FOUND');
    expect((await request(ctx.app).get('/api/exams/not-a-uuid')).status).toBe(400);
  });

  it('scenario 10: PATCH changes daily hours and the response reflects the new budget', async () => {
    const id = await createExam();
    const res = await request(ctx.app).patch(`/api/exams/${id}`).send({ minutesPerDay: 240 });
    expect(res.status).toBe(200);
    expect(res.body.availability.availableMinutes).toBe(1920);
    expect((await request(ctx.app).patch(`/api/exams/${id}`).send({})).status).toBe(400);
  });
});

describe('material endpoints: pasted text', () => {
  it('creates (201), then reports an identical paste as a duplicate (200) without a second row', async () => {
    const id = await createExam();
    const first = await request(ctx.app)
      .post(`/api/exams/${id}/materials/text`)
      .send({ text: NOTES });
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.material).toMatchObject({ sourceType: 'TEXT', pageCount: null });

    const second = await request(ctx.app)
      .post(`/api/exams/${id}/materials/text`)
      .send({ text: `\n${NOTES}\n\n\n` });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.material.id).toBe(first.body.material.id);
    expect(ctx.materialRepo.rows.size).toBe(1);
  });

  it('scenario 4: empty text gets a specific message and nothing is stored', async () => {
    const id = await createExam();
    const res = await request(ctx.app).post(`/api/exams/${id}/materials/text`).send({ text: '  ' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEXT_TOO_SHORT');
    expect(res.body.error.message).toMatch(/Add more of your syllabus or notes/);
    expect(ctx.materialRepo.rows.size).toBe(0);
  });

  it('handles malformed JSON and a missing body without leaking internals', async () => {
    const id = await createExam();
    const malformed = await request(ctx.app)
      .post(`/api/exams/${id}/materials/text`)
      .set('Content-Type', 'application/json')
      .send('{"text":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const noBody = await request(ctx.app).post(`/api/exams/${id}/materials/text`);
    expect(noBody.status).toBe(400);
  });

  it('returns 404 for an unknown exam', async () => {
    const res = await request(ctx.app)
      .post(`/api/exams/${NIL_UUID}/materials/text`)
      .send({ text: NOTES });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EXAM_NOT_FOUND');
  });
});

describe('material endpoints: PDF upload', () => {
  const upload = (
    examId: string,
    buffer: Buffer,
    filename = 'notes.pdf',
    contentType = 'application/pdf',
  ) =>
    request(ctx.app)
      .post(`/api/exams/${examId}/materials/pdf`)
      .attach('file', buffer, { filename, contentType });

  it('accepts a multi-page text PDF and reports pages', async () => {
    const id = await createExam();
    const pdf = makePdf([[words('alpha')], [words('beta')], [words('gamma')]]);
    const res = await upload(id, pdf);
    expect(res.status).toBe(201);
    expect(res.body.material).toMatchObject({
      sourceType: 'PDF',
      filename: 'notes.pdf',
      pageCount: 3,
      lowTextPageCount: 0,
    });
    expect(JSON.stringify(res.body)).not.toContain('extractedText');
  });

  it('keeps a UTF-8 filename readable', async () => {
    const id = await createExam();
    const res = await upload(id, makePdf([[words('alpha')]]), 'नोट्स-अध्याय1.pdf');
    expect(res.body.material.filename).toBe('नोट्स-अध्याय1.pdf');
  });

  it('accepts application/octet-stream when the name ends in .pdf and the bytes are a PDF', async () => {
    const id = await createExam();
    const res = await upload(
      id,
      makePdf([[words('alpha')]]),
      'notes.pdf',
      'application/octet-stream',
    );
    expect(res.status).toBe(201);
  });

  it('reports the same PDF uploaded twice as a duplicate (200)', async () => {
    const id = await createExam();
    const pdf = makePdf([[words('alpha')], [words('beta')]]);
    expect((await upload(id, pdf)).status).toBe(201);
    const again = await upload(id, pdf, 'other-name.pdf');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(ctx.materialRepo.rows.size).toBe(1);
  });

  it('rejects a non-PDF content type with 415 and PDF_INVALID', async () => {
    const id = await createExam();
    const res = await upload(id, Buffer.from('hello'), 'notes.txt', 'text/plain');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('PDF_INVALID');
  });

  it('scenario 7: rejects a file labelled PDF whose bytes are not a PDF (magic-byte check)', async () => {
    const id = await createExam();
    const res = await upload(id, Buffer.from('MZ\u0090 this is an executable, not a pdf'));
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('PDF_INVALID');
    expect(ctx.materialRepo.rows.size).toBe(0);
  });

  it('scenario 7: rejects a corrupt PDF with 422 PDF_UNREADABLE and a helpful message', async () => {
    const id = await createExam();
    const res = await upload(
      id,
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('junk '.repeat(100))]),
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_UNREADABLE');
    expect(res.body.error.message).toMatch(/paste the text instead/);
    expect(JSON.stringify(res.body)).not.toMatch(/pdfjs|stack|at \w+ \(/i);
  });

  it('a PDF with no selectable text returns PDF_NO_TEXT with the agreed message', async () => {
    const id = await createExam();
    const res = await upload(id, makePdf([[], [], []]));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_NO_TEXT');
    expect(res.body.error.message).toMatch(
      /Check that the PDF contains selectable text and try again/,
    );
    expect(ctx.materialRepo.rows.size).toBe(0);
  });

  it('returns NO_FILE when no file is sent, and UPLOAD_INVALID for the wrong field name', async () => {
    const id = await createExam();
    const none = await request(ctx.app).post(`/api/exams/${id}/materials/pdf`).field('note', 'hi');
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('NO_FILE');

    const wrongField = await request(ctx.app)
      .post(`/api/exams/${id}/materials/pdf`)
      .attach('document', makePdf([[words('alpha')]]), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      });
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.code).toBe('UPLOAD_INVALID');
  });

  it('rejects an oversized file with 413 while streaming, using the configured limit in the message', async () => {
    const small = buildTestApp({ limits: { ...DEFAULT_MATERIAL_LIMITS, maxPdfBytes: 1024 } });
    const examId = (await request(small.app).post('/api/profiles').send(setupBody)).body.exam
      .id as string;
    const big = makePdf([[words('alpha')], ...Array.from({ length: 80 }, () => [words('beta')])]);
    expect(big.length).toBeGreaterThan(1024);
    const res = await request(small.app)
      .post(`/api/exams/${examId}/materials/pdf`)
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PDF_TOO_LARGE');
    expect(res.body.error.message).toMatch(/larger than/);
    expect(small.materialRepo.rows.size).toBe(0);
  });

  it('rejects a PDF over the page limit with a message that names both numbers', async () => {
    const fewPages = buildTestApp({ limits: { ...DEFAULT_MATERIAL_LIMITS, maxPdfPages: 2 } });
    const examId = (await request(fewPages.app).post('/api/profiles').send(setupBody)).body.exam
      .id as string;
    const res = await request(fewPages.app)
      .post(`/api/exams/${examId}/materials/pdf`)
      .attach('file', makePdf([[words('a')], [words('b')], [words('c')]]), {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_TOO_MANY_PAGES');
    expect(res.body.error.message).toMatch(/3 pages.*up to 2/);
  });
});

describe('list and delete', () => {
  it('lists summaries with the effective limits, and deletes a material (204, then 404)', async () => {
    const id = await createExam();
    const added = await request(ctx.app)
      .post(`/api/exams/${id}/materials/text`)
      .send({ text: NOTES });
    const list = await request(ctx.app).get(`/api/exams/${id}/materials`);
    expect(list.status).toBe(200);
    expect(list.body.materials).toHaveLength(1);
    expect(list.body.limits).toEqual(DEFAULT_MATERIAL_LIMITS);

    const materialId = added.body.material.id as string;
    expect((await request(ctx.app).delete(`/api/materials/${materialId}`)).status).toBe(204);
    const again = await request(ctx.app).delete(`/api/materials/${materialId}`);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('MATERIAL_NOT_FOUND');
    expect((await request(ctx.app).delete('/api/materials/nope')).status).toBe(400);
  });
});

describe('cross-cutting behavior', () => {
  it('rate-limits ingestion endpoints with the standard error shape', async () => {
    const limited = buildTestApp({
      rateLimits: {
        uploads: { windowMs: 60_000, limit: 2 },
        profiles: { windowMs: 60_000, limit: 100 },
        analysis: { windowMs: 60_000, limit: 100 },
        planning: { windowMs: 60_000, limit: 100 },
      },
    });
    const examId = (await request(limited.app).post('/api/profiles').send(setupBody)).body.exam
      .id as string;
    const post = () =>
      request(limited.app).post(`/api/exams/${examId}/materials/text`).send({ text: NOTES });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(200);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('never leaks internal error details on unexpected failures', async () => {
    class ExplodingRepo extends InMemorySetupRepository {
      override async findExam(): Promise<never> {
        throw new Error('db exploded: password=hunter2 at /srv/app/secret.ts');
      }
    }
    const broken = buildTestApp({
      setupRepo: new ExplodingRepo(),
      materialRepo: new InMemoryMaterialRepository(),
    });
    const res = await request(broken.app).get(`/api/exams/${NIL_UUID}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|secret|exploded|\.ts/);
  });
});
