import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisRunRecord, PersistedSubject, PersistedTopic } from './services/ports.js';
import { buildTestApp } from './test/build-test-app.js';

// "Now" is Monday 2026-10-05, 10:00 UTC.
const NOW = new Date('2026-10-05T10:00:00.000Z');

const pt = (name: string, o: Partial<PersistedTopic> = {}): PersistedTopic => ({
  name,
  parent: null,
  description: `About ${name}`,
  difficulty: 'MEDIUM',
  importance: 'MEDIUM',
  effortClass: 'STANDARD',
  revisionWeight: 0.5,
  estimatedMinutes: 60,
  origin: 'EXTRACTED',
  statedEmphasis: false,
  confidence: 0.9,
  prerequisites: [],
  isWeak: false,
  weakHint: null,
  evidence: [{ materialId: 'm1', chunkId: 'c1', page: 14, pageEnd: 14, snippet: 'quote' }],
  ...o,
});

const SUBJECTS: PersistedSubject[] = [
  {
    name: 'Operating Systems',
    topics: [
      pt('Process basics', { importance: 'HIGH', estimatedMinutes: 45 }),
      pt('CPU scheduling', {
        importance: 'HIGH',
        isWeak: true,
        difficulty: 'HARD',
        estimatedMinutes: 90,
        prerequisites: ['Process basics'],
      }),
      pt('Scheduling problems', { estimatedMinutes: 60, prerequisites: ['CPU scheduling'] }),
    ],
  },
  {
    name: 'DBMS',
    topics: [
      pt('Normalization', { importance: 'HIGH', isWeak: true, estimatedMinutes: 75 }),
      pt('SQL practice', { estimatedMinutes: 40, importance: 'LOW' }),
    ],
  },
];

function seedAnalysis(ctx: ReturnType<typeof buildTestApp>, examId: string) {
  ctx.analysisRepo.subjects = SUBJECTS;
  const run: AnalysisRunRecord = {
    id: randomUUID(),
    examId,
    status: 'SUCCEEDED',
    stage: 'COMPLETED',
    fingerprint: 'f',
    provider: 'fake',
    model: 'fake',
    materialCount: 1,
    totalChunks: 1,
    processedChunks: 1,
    failedChunks: 0,
    topicCount: 5,
    droppedTopics: 0,
    warnings: [],
    startedAt: NOW,
    finishedAt: NOW,
    heartbeatAt: NOW,
    latencyMs: 1,
    retryCount: 0,
    validationFailures: 0,
    promptTokens: null,
    completionTokens: null,
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
  };
  ctx.analysisRepo.runs.set(run.id, run);
  ctx.analysisRepo.resultRunId = run.id;
  ctx.planRepo.names.set('m1', 'os-notes.pdf');
}

let ctx: ReturnType<typeof buildTestApp>;
let examId: string;

async function createExam(over: Record<string, unknown> = {}) {
  const res = await request(ctx.app)
    .post('/api/profiles')
    .send({
      nickname: 'Asha',
      examName: 'Finals',
      examDate: '2026-10-25',
      minutesPerDay: 180,
      studyDays: [1, 2, 3, 4, 5, 6],
      weakTopicHints: [],
      ...over,
    });
  expect(res.status).toBe(201);
  return res.body.exam.id as string;
}

beforeEach(async () => {
  ctx = buildTestApp({ now: NOW });
  examId = await createExam();
  seedAnalysis(ctx, examId);
});

const generate = (body: object = {}) =>
  request(ctx.app).post(`/api/exams/${examId}/plan`).send(body);

describe('POST /api/exams/:examId/plan', () => {
  it('generates a plan with fit report, explained topics and tasks', async () => {
    const res = await generate();
    expect(res.status).toBe(201);
    const { plan } = res.body;
    expect(plan.version).toBe(1);
    expect(plan.summary.fit.status).toBe('GOOD');
    expect(plan.summary.fit.requiredStudyMinutes).toBe(45 + 90 + 60 + 75 + 40);
    const cpu = plan.summary.topics.find((t: { name: string }) => t.name === 'CPU scheduling');
    expect(cpu.level).toBe('HIGH');
    expect(cpu.prerequisites.map((p: { name: string }) => p.name)).toEqual(['Process basics']);
    expect(cpu.evidence).toEqual({ materialName: 'os-notes.pdf', page: 14, pageEnd: 14 });
    expect(cpu.reasons.some((r: { code: string }) => r.code === 'WEAK')).toBe(true);
    expect(plan.tasks.length).toBeGreaterThan(5);
    expect(plan.progress.tasksCompleted).toBe(0);
    expect(plan.settingsChanged).toBe(false);
  });

  it('is repeatable while untouched: a new version replaces the old, no progress is at stake', async () => {
    await generate();
    const second = await generate();
    expect(second.status).toBe(201);
    expect(second.body.plan.version).toBe(2);
    const got = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(got.body.versions.map((v: { status: string }) => v.status)).toEqual([
      'ACTIVE',
      'ARCHIVED',
    ]);
  });

  it('refuses to replace a plan that has progress (history is protected)', async () => {
    const { body } = await generate();
    await request(ctx.app).post(`/api/study-tasks/${body.plan.tasks[0].id}/complete`).send({});
    const again = await generate();
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PLAN_HAS_PROGRESS');
  });

  it('requires an analysis first', async () => {
    const other = await createExam();
    const res = await request(ctx.app).post(`/api/exams/${other}/plan`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PLAN_NO_ANALYSIS');
  });

  it('reports an over-capacity plan honestly', async () => {
    const tight = await createExam({ examDate: '2026-10-07', minutesPerDay: 120 });
    seedAnalysis(ctx, tight);
    const res = await request(ctx.app).post(`/api/exams/${tight}/plan`).send({});
    expect(res.status).toBe(201);
    expect(res.body.plan.summary.fit.status).toBe('OVER_CAPACITY');
    expect(res.body.plan.summary.fit.headline).toMatch(/does not fit/i);
    expect(res.body.plan.summary.tiers.DEFER.topics).toBeGreaterThan(0);
  });

  it.each([
    ['unknown field', { nope: 1 }],
    ['bad date', { planDate: '2026-02-31' }],
    ['date far from today', { planDate: '2026-12-01' }],
  ])('rejects %s', async (_n, body) => {
    const res = await generate(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|select/i);
  });

  it('rejects malformed and unknown exam ids safely', async () => {
    expect((await request(ctx.app).post('/api/exams/not-a-uuid/plan').send({})).status).toBe(400);
    expect((await request(ctx.app).post(`/api/exams/${randomUUID()}/plan`).send({})).status).toBe(
      404,
    );
  });
});

describe('GET plan and today', () => {
  it('returns null plan before generation and the plan afterwards', async () => {
    const before = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(before.body.plan).toBeNull();
    await generate();
    const after = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(after.body.plan.version).toBe(1);
    expect(after.body.today).toBe('2026-10-05');
  });

  it('today lists today’s tasks within capacity, with remaining time', async () => {
    await generate();
    const res = await request(ctx.app).get(`/api/exams/${examId}/plan/today`);
    expect(res.status).toBe(200);
    expect(res.body.hasPlan).toBe(true);
    expect(res.body.date).toBe('2026-10-05');
    expect(res.body.isStudyDay).toBe(true);
    expect(res.body.tasks.length).toBeGreaterThan(0);
    expect(res.body.plannedMinutes).toBeLessThanOrEqual(res.body.capacityMinutes);
    expect(res.body.remainingMinutes).toBe(res.body.plannedMinutes);
    expect(res.body.tasks[0].prerequisites).toBeDefined();
  });

  it('today on a day off has no capacity and no tasks', async () => {
    await generate();
    const sunday = await request(ctx.app).get(`/api/exams/${examId}/plan/today?date=2026-10-04`);
    expect(sunday.body.isStudyDay).toBe(false);
    expect(sunday.body.capacityMinutes).toBe(0);
  });

  it('today without a plan is a calm empty state, not an error', async () => {
    const other = await createExam();
    const res = await request(ctx.app).get(`/api/exams/${other}/plan/today`);
    expect(res.status).toBe(200);
    expect(res.body.hasPlan).toBe(false);
  });

  it('rejects an invalid date query', async () => {
    const res = await request(ctx.app).get(`/api/exams/${examId}/plan/today?date=tomorrow`);
    expect(res.status).toBe(400);
  });
});

describe('task lifecycle', () => {
  it('starts, completes and skips tasks; progress updates deterministically', async () => {
    const { body } = await generate();
    const [a, b, c] = body.plan.tasks as { id: string; minutes: number }[];
    const started = await request(ctx.app).post(`/api/study-tasks/${a!.id}/start`).send({});
    expect(started.body.task.status).toBe('IN_PROGRESS');
    expect(started.body.progress.tasksInProgress).toBe(1);
    const done = await request(ctx.app)
      .post(`/api/study-tasks/${a!.id}/complete`)
      .send({ actualMinutes: 50 });
    expect(done.body.task.status).toBe('COMPLETED');
    expect(done.body.task.actualMinutes).toBe(50);
    expect(done.body.progress.tasksCompleted).toBe(1);
    expect(done.body.progress.completedMinutes).toBe(a!.minutes);
    const skipped = await request(ctx.app).post(`/api/study-tasks/${b!.id}/skip`).send({});
    expect(skipped.body.task.status).toBe('SKIPPED');
    expect(skipped.body.progress.tasksSkipped).toBe(1);
    expect(skipped.body.progress.tasksCompleted).toBe(1);
    expect(c).toBeDefined();
  });

  it('is idempotent for repeated complete / skip', async () => {
    const { body } = await generate();
    const id = body.plan.tasks[0].id;
    const one = await request(ctx.app).post(`/api/study-tasks/${id}/complete`).send({});
    const two = await request(ctx.app).post(`/api/study-tasks/${id}/complete`).send({});
    expect(two.status).toBe(200);
    expect(two.body.task.completedAt).toBe(one.body.task.completedAt);
  });

  it('uncompletes a task and reverses progress without duplicating revisions', async () => {
    const { body } = await generate();
    const study = body.plan.tasks.find((task: { type: string }) => task.type === 'STUDY');
    const completed = await request(ctx.app)
      .post(`/api/study-tasks/${study.id}/complete`)
      .send({ actualMinutes: 40 });
    expect(completed.body.progress.tasksCompleted).toBe(1);

    const undone = await request(ctx.app).post(`/api/study-tasks/${study.id}/uncomplete`).send({});
    expect(undone.body.task).toMatchObject({
      status: 'PENDING',
      completedAt: null,
      actualMinutes: null,
    });
    expect(undone.body.progress.tasksCompleted).toBe(0);

    const repeated = await request(ctx.app)
      .post(`/api/study-tasks/${study.id}/uncomplete`)
      .send({});
    expect(repeated.status).toBe(200);
    const plan = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(
      plan.body.plan.tasks.filter((task: { type: string }) => task.type === 'REVISION'),
    ).toHaveLength(
      body.plan.tasks.filter((task: { type: string }) => task.type === 'REVISION').length,
    );
  });

  it('refuses contradictory transitions with a clear 409', async () => {
    const { body } = await generate();
    const [a, b] = body.plan.tasks as { id: string }[];
    await request(ctx.app).post(`/api/study-tasks/${a!.id}/complete`).send({});
    const skip = await request(ctx.app).post(`/api/study-tasks/${a!.id}/skip`).send({});
    expect(skip.status).toBe(409);
    await request(ctx.app).post(`/api/study-tasks/${b!.id}/skip`).send({});
    const complete = await request(ctx.app).post(`/api/study-tasks/${b!.id}/complete`).send({});
    expect(complete.status).toBe(409);
    expect(complete.body.error.code).toBe('TASK_NOT_OPEN');
  });

  it('validates ids and bodies, and never touches an archived plan', async () => {
    expect((await request(ctx.app).post('/api/study-tasks/xyz/complete').send({})).status).toBe(
      400,
    );
    expect(
      (await request(ctx.app).post(`/api/study-tasks/${randomUUID()}/complete`).send({})).status,
    ).toBe(404);
    const { body } = await generate();
    const id = body.plan.tasks[0].id;
    for (const bad of [
      { actualMinutes: -5 },
      { actualMinutes: 0 },
      { actualMinutes: 99999 },
      { actualMinutes: 1.5 },
      { status: 'COMPLETED' },
    ])
      expect(
        (await request(ctx.app).post(`/api/study-tasks/${id}/complete`).send(bad)).status,
      ).toBe(400);
    await generate(); // replaces (still untouched) → old task now belongs to an archived plan
    const stale = await request(ctx.app).post(`/api/study-tasks/${id}/complete`).send({});
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PLAN_CHANGED');
  });
});

describe('rebalance', () => {
  it('REPLAN keeps finished work, re-plans the rest and creates a new version', async () => {
    const { body } = await generate();
    const first = body.plan.tasks
      .filter((t: { type: string }) => t.type === 'STUDY')
      .slice(0, 2) as { id: string; topicId: string; minutes: number; date: string }[];
    for (const t of first)
      await request(ctx.app).post(`/api/study-tasks/${t.id}/complete`).send({});
    const res = await request(ctx.app)
      .post(`/api/exams/${examId}/plan/rebalance`)
      .send({ mode: 'REPLAN' });
    expect(res.status).toBe(200);
    expect(res.body.plan.version).toBe(2);
    expect(res.body.plan.trigger).toBe('REPLAN_REMAINING');
    const completed = res.body.plan.tasks.filter(
      (t: { status: string }) => t.status === 'COMPLETED',
    );
    expect(completed).toHaveLength(2);
    expect(
      completed
        .map((t: { topicId: string; minutes: number; date: string }) => [
          t.topicId,
          t.minutes,
          t.date,
        ])
        .sort(),
    ).toEqual(first.map((t) => [t.topicId, t.minutes, t.date]).sort());
    expect(res.body.plan.summary.fit.requiredStudyMinutes).toBe(
      45 + 90 + 60 + 75 + 40 - first.reduce((a, t) => a + t.minutes, 0),
    );
    const versions = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions[1].status).toBe('ARCHIVED');
    expect(versions.body.versions[1].archivedReason).toBe('REBALANCED');
  });

  it('RECOVER moves missed tasks into spare time and leaves everything else in place', async () => {
    await generate();
    const later = buildTestApp({
      now: new Date('2026-10-08T09:00:00.000Z'),
      setupRepo: ctx.setupRepo,
      analysisRepo: ctx.analysisRepo,
      planRepo: ctx.planRepo,
      materialRepo: ctx.materialRepo,
    });
    const res = await request(later.app)
      .post(`/api/exams/${examId}/plan/rebalance`)
      .send({ mode: 'RECOVER' });
    expect(res.status).toBe(200);
    expect(res.body.plan.trigger).toBe('RECOVER_MISSED');
    const rec = res.body.plan.summary.recovery;
    expect(rec.missedTasks).toBeGreaterThan(0);
    expect(rec.recoveredMinutes + rec.overloadMinutes).toBe(rec.missedMinutes);
    expect(res.body.plan.progress.overdueTasks).toBe(
      rec.overloadMinutes > 0 ? res.body.plan.progress.overdueTasks : 0,
    );
  });

  it('RECOVER with nothing missed is a clear 409, not an empty new version', async () => {
    await generate();
    const res = await request(ctx.app)
      .post(`/api/exams/${examId}/plan/rebalance`)
      .send({ mode: 'RECOVER' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOTHING_TO_RECOVER');
    expect((await request(ctx.app).get(`/api/exams/${examId}/plan`)).body.versions).toHaveLength(1);
  });

  it('flags changed settings and applies them on rebalance', async () => {
    await generate();
    await request(ctx.app).patch(`/api/exams/${examId}`).send({ minutesPerDay: 60 });
    const got = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(got.body.plan.settingsChanged).toBe(true);
    const res = await request(ctx.app).post(`/api/exams/${examId}/plan/rebalance`).send({});
    expect(res.body.plan.settingsChanged).toBe(false);
    expect(res.body.plan.summary.fit.totalMinutes).toBeLessThan(
      got.body.plan.summary.fit.totalMinutes,
    );
  });

  it('needs an existing plan, and validates input', async () => {
    const none = await request(ctx.app).post(`/api/exams/${examId}/plan/rebalance`).send({});
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('PLAN_NOT_FOUND');
    await generate();
    expect(
      (
        await request(ctx.app)
          .post(`/api/exams/${examId}/plan/rebalance`)
          .send({ mode: 'DELETE_ALL' })
      ).status,
    ).toBe(400);
  });

  it('re-analysis archives the plan: no active plan, with an explanation', async () => {
    await generate();
    ctx.planRepo.archiveActive(examId, 'REANALYZED');
    const got = await request(ctx.app).get(`/api/exams/${examId}/plan`);
    expect(got.body.plan).toBeNull();
    expect(got.body.staleReason).toMatch(/analyzed again/);
  });
});

describe('topic detail', () => {
  it('returns the topic, its plan insight, tasks, dependents and evidence', async () => {
    await generate();
    const plan = (await request(ctx.app).get(`/api/exams/${examId}/plan`)).body.plan;
    const process = plan.summary.topics.find((t: { name: string }) => t.name === 'Process basics');
    const res = await request(ctx.app).get(`/api/exams/${examId}/topics/${process.topicId}`);
    expect(res.status).toBe(200);
    expect(res.body.topic.name).toBe('Process basics');
    expect(res.body.subjectName).toBe('Operating Systems');
    expect(res.body.dependents).toEqual(['CPU scheduling']);
    expect(res.body.insight.directDependents).toBe(1);
    expect(res.body.tasks.length).toBeGreaterThan(0);
    expect(res.body.topic.evidence[0].page).toBe(14);
  });

  it('404s for unknown topics and 400s for malformed ids', async () => {
    expect((await request(ctx.app).get(`/api/exams/${examId}/topics/${randomUUID()}`)).status).toBe(
      404,
    );
    expect((await request(ctx.app).get(`/api/exams/${examId}/topics/nope`)).status).toBe(400);
  });
});

describe('topic review', () => {
  const processBasicsId = '00000000-0000-4000-8000-000000000000';
  const sqlPracticeId = '00000000-0000-4000-8000-000100000001';

  it('updates minutes, importance and weak status with strict request validation', async () => {
    const updated = await request(ctx.app)
      .patch(`/api/exams/${examId}/topics/${processBasicsId}`)
      .send({ estimatedMinutes: 75, importance: 'LOW', isWeak: true });
    expect(updated.status).toBe(200);
    const topic = updated.body.subjects[0].topics[0];
    expect(topic).toMatchObject({ estimatedMinutes: 75, importance: 'LOW', isWeak: true });

    const invalid = await request(ctx.app)
      .patch(`/api/exams/${examId}/topics/${processBasicsId}`)
      .send({ estimatedMinutes: 6, extra: true });
    expect(invalid.status).toBe(400);
    expect(ctx.analysisRepo.subjects[0]!.topics[0]).toMatchObject({
      estimatedMinutes: 75,
      importance: 'LOW',
      isWeak: true,
    });
  });

  it('deletes only a topic belonging to the requested exam', async () => {
    const otherExam = await createExam();
    const foreign = await request(ctx.app).delete(
      `/api/exams/${otherExam}/topics/${sqlPracticeId}`,
    );
    expect(foreign.status).toBe(404);
    expect(ctx.analysisRepo.subjects[1]!.topics).toHaveLength(2);

    const deleted = await request(ctx.app).delete(`/api/exams/${examId}/topics/${sqlPracticeId}`);
    expect(deleted.status).toBe(204);
    expect(ctx.analysisRepo.subjects[1]!.topics).toHaveLength(1);
  });
});
