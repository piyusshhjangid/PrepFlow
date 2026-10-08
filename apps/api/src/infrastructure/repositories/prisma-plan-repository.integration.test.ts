/**
 * Integration test for plan persistence against a REAL PostgreSQL TEST database
 * (`npm run test:integration`): versioning, history preservation, per-exam locking,
 * and the effect of re-analysis on plans and tasks.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../../config/test-database.js';
import { createAnalysisService } from '../../services/analysis.service.js';
import { createPlanService } from '../../services/plan.service.js';
import type { PersistedSubject, PersistedTopic } from '../../services/ports.js';
import { FakeAiProvider } from '../../ai/providers/fake-provider.js';
import { PrismaAnalysisRepository } from './prisma-analysis-repository.js';
import { PrismaPlanRepository } from './prisma-plan-repository.js';
import { PrismaSetupRepository } from './prisma-setup-repository.js';

const url = assertSafeTestDatabase(process.env.DATABASE_URL, undefined);

const NOW = new Date('2026-10-05T10:00:00.000Z');
const pt = (name: string, o: Partial<PersistedTopic> = {}): PersistedTopic => ({
  name,
  parent: null,
  description: '',
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
  evidence: [],
  ...o,
});
const SUBJECTS: PersistedSubject[] = [
  {
    name: 'OS',
    topics: [
      pt('Processes', { importance: 'HIGH', estimatedMinutes: 45 }),
      pt('Scheduling', {
        importance: 'HIGH',
        isWeak: true,
        prerequisites: ['Processes'],
        estimatedMinutes: 90,
      }),
      pt('Deadlocks', { estimatedMinutes: 60 }),
    ],
  },
];

describe('plan persistence (integration, real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let setupRepo: PrismaSetupRepository;
  let analysisRepo: PrismaAnalysisRepository;
  let planRepo: PrismaPlanRepository;
  const profiles: string[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
    setupRepo = new PrismaSetupRepository(prisma);
    analysisRepo = new PrismaAnalysisRepository(prisma);
    planRepo = new PrismaPlanRepository(prisma);
  });
  afterAll(async () => {
    await prisma.studyProfile.deleteMany({ where: { id: { in: profiles } } });
    await prisma.$disconnect();
  });

  const analysisService = () =>
    createAnalysisService({
      setupRepo,
      repo: analysisRepo,
      provider: new FakeAiProvider(['{"subjects":[]}']),
      chunkConfig: { targetChars: 12_000, maxChars: 15_000, maxChunks: 40 },
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      maxConcurrent: 1,
      staleAfterMs: 60_000,
    });
  const plans = () =>
    createPlanService({
      setupRepo,
      analysisRepo,
      analysis: analysisService(),
      repo: planRepo,
      clock: () => NOW,
    });

  async function analyzedExam() {
    const exam = await setupRepo.createProfileWithExam({
      nickname: 'IT',
      name: 'E',
      examDate: new Date('2026-10-25T00:00:00Z'),
      minutesPerDay: 180,
      studyDays: [1, 2, 3, 4, 5, 6],
      weakTopicHints: [],
      confidence: 2,
      bufferPct: 10,
      blockedDates: [new Date('2026-10-12T00:00:00Z')],
    });
    profiles.push(exam.profileId);
    await saveAnalysis(exam.id, SUBJECTS);
    return exam;
  }
  async function saveAnalysis(examId: string, subjects: PersistedSubject[]) {
    const { run } = await analysisRepo.createRunIfNoActive({
      examId,
      fingerprint: `f${Math.random()}`,
      provider: 'fake',
      model: 'm',
      materialCount: 1,
    });
    await analysisRepo.saveResult(run.id, examId, subjects, {
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      topicCount: subjects.reduce((a, s) => a + s.topics.length, 0),
      finishedAt: new Date(),
    });
  }

  it('stores exam settings (buffer, days off) and round-trips them', async () => {
    const exam = await analyzedExam();
    const found = await setupRepo.findExam(exam.id);
    expect(found?.bufferPct).toBe(10);
    expect(found?.blockedDates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-12']);
  });

  it('generates, completes tasks and rebalances into versions, keeping history', async () => {
    const exam = await analyzedExam();
    const svc = plans();
    const { plan } = await svc.generate(exam.id);
    expect(plan.version).toBe(1);
    expect(plan.tasks.every((t) => t.date !== '2026-10-12')).toBe(true); // day off

    const first = plan.tasks[0]!;
    await svc.startTask(first.id);
    const done = await svc.completeTask(first.id, { actualMinutes: 40 });
    expect(done.task).toMatchObject({ status: 'COMPLETED', actualMinutes: 40 });

    const next = await svc.rebalance(exam.id, { mode: 'REPLAN' });
    expect(next.plan.version).toBe(2);
    const kept = next.plan.tasks.find((t) => t.status === 'COMPLETED');
    expect(kept).toMatchObject({
      topicId: first.topicId,
      minutes: first.minutes,
      date: first.date,
      actualMinutes: 40,
    });

    // the old version is archived and untouched
    const versions = await prisma.studyPlan.findMany({
      where: { examId: exam.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((v) => v.status)).toEqual(['ARCHIVED', 'ACTIVE']);
    expect(versions[0]?.archivedReason).toBe('REBALANCED');
    const oldTask = await prisma.studyTask.findUnique({ where: { id: first.id } });
    expect(oldTask?.status).toBe('COMPLETED');

    // tasks of an archived plan can no longer be changed
    await expect(svc.skipTask(plan.tasks[1]!.id)).rejects.toMatchObject({ code: 'PLAN_CHANGED' });
  });

  it('persists topic completion and reverses it when a completed study task is undone', async () => {
    const exam = await analyzedExam();
    const svc = plans();
    const { plan } = await svc.generate(exam.id);
    const processTask = plan.tasks.find(
      (task) => task.type === 'STUDY' && task.topicName === 'Processes',
    );
    expect(processTask?.topicId).toBeTruthy();
    await svc.completeTask(processTask!.id);

    const completedTopic = await prisma.topic.findUnique({ where: { id: processTask!.topicId! } });
    expect(completedTopic).toMatchObject({ status: 'COMPLETED' });

    await svc.uncompleteTask(processTask!.id);
    const reopenedTopic = await prisma.topic.findUnique({ where: { id: processTask!.topicId! } });
    expect(reopenedTopic).toMatchObject({ status: 'NOT_STARTED', completedAt: null });
  });

  it('serializes concurrent rebalances: exactly one active plan, strictly increasing versions', async () => {
    const exam = await analyzedExam();
    const svc = plans();
    await svc.generate(exam.id);
    await Promise.all(Array.from({ length: 5 }, () => svc.rebalance(exam.id, { mode: 'REPLAN' })));
    const rows = await prisma.studyPlan.findMany({
      where: { examId: exam.id },
      orderBy: { version: 'asc' },
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
  });

  it('a completion that succeeds is never lost by a concurrent rebalance (per-exam lock)', async () => {
    const exam = await analyzedExam();
    const svc = plans();
    const { plan } = await svc.generate(exam.id);
    const ids = plan.tasks.slice(0, 4).map((t) => t.id);
    const settled = await Promise.all([
      ...ids.map((id) =>
        svc.completeTask(id).then(
          () => ({ id, ok: true }),
          () => ({ id, ok: false }), // lost the race: the plan had already been replaced
        ),
      ),
      svc.rebalance(exam.id, { mode: 'REPLAN' }),
    ]);
    const active = await planRepo.findActive(exam.id);
    for (const r of settled.filter(
      (x): x is { id: string; ok: boolean } => typeof x === 'object' && 'ok' in x && x.ok,
    )) {
      const carried = active!.tasks.find((t) => t.carriedFromTaskId === r.id);
      expect(carried?.status, `completion of ${r.id} was lost`).toBe('COMPLETED');
    }
  });

  it('re-analysis archives the active plan; finished tasks keep their topic name after topics are replaced', async () => {
    const exam = await analyzedExam();
    const svc = plans();
    const { plan } = await svc.generate(exam.id);
    const task = plan.tasks.find((t) => t.type === 'STUDY')!;
    await svc.completeTask(task.id);

    await saveAnalysis(exam.id, [{ name: 'OS', topics: [pt('Processes v2')] }]);

    const view = await svc.getPlan(exam.id);
    expect(view.plan).toBeNull();
    expect(view.staleReason).toMatch(/analyzed again/);
    const row = await prisma.studyTask.findUnique({ where: { id: task.id } });
    expect(row?.topicId).toBeNull(); // FK is ON DELETE SET NULL…
    expect(row?.topicName).toBe(task.topicName); // …and the snapshot survives
    expect(row?.status).toBe('COMPLETED');
    // a fresh plan can be generated for the new topics
    expect((await svc.generate(exam.id)).plan.version).toBe(2);
  });

  it('deleting an exam cascades to its plans and tasks', async () => {
    const exam = await analyzedExam();
    await plans().generate(exam.id);
    await prisma.exam.delete({ where: { id: exam.id } });
    expect(await prisma.studyPlan.count({ where: { examId: exam.id } })).toBe(0);
  });
});
