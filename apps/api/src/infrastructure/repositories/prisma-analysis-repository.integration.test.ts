/**
 * Integration test for analysis persistence against a REAL PostgreSQL TEST database
 * (`npm run test:integration`). Includes the full pipeline with a fake AI provider and real PDF text.
 */
import { DEFAULT_MATERIAL_LIMITS } from '@prepflow/shared';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeAiProvider } from '../../ai/providers/fake-provider.js';
import { assertSafeTestDatabase } from '../../config/test-database.js';
import { createAnalysisService } from '../../services/analysis.service.js';
import { createMaterialService } from '../../services/material.service.js';
import { createPdfIngestor } from '../../services/pdf-ingestor.js';
import { makePdf } from '../../test/make-pdf.js';
import { quoteFrom, readPrompt, response, topic } from '../../test/ai-fixtures.js';
import { PdfJsTextExtractor } from '../pdf/pdfjs-text-extractor.js';
import { PrismaAnalysisRepository } from './prisma-analysis-repository.js';
import { PrismaMaterialRepository } from './prisma-material-repository.js';
import { PrismaSetupRepository } from './prisma-setup-repository.js';

const url = assertSafeTestDatabase(process.env.DATABASE_URL, undefined);

describe('analysis persistence (integration, real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let setupRepo: PrismaSetupRepository;
  let materialRepo: PrismaMaterialRepository;
  let repo: PrismaAnalysisRepository;
  const profiles: string[] = [];

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
    setupRepo = new PrismaSetupRepository(prisma);
    materialRepo = new PrismaMaterialRepository(prisma);
    repo = new PrismaAnalysisRepository(prisma);
  });
  afterAll(async () => {
    await prisma.studyProfile.deleteMany({ where: { id: { in: profiles } } });
    await prisma.$disconnect();
  });

  async function newExam() {
    const exam = await setupRepo.createProfileWithExam({
      nickname: 'IT',
      name: 'E',
      examDate: new Date('2026-10-20T00:00:00Z'),
      minutesPerDay: 120,
      studyDays: [1],
      weakTopicHints: ['Hashing'],
      confidence: 2,
      bufferPct: 10,
      blockedDates: [],
    });
    profiles.push(exam.profileId);
    return exam;
  }
  const service = (provider: FakeAiProvider) =>
    createAnalysisService({
      setupRepo,
      repo,
      provider,
      chunkConfig: { targetChars: 12_000, maxChars: 15_000, maxChunks: 40 },
      retry: { maxAttempts: 2, baseDelayMs: 0 },
      maxConcurrent: 1,
      staleAfterMs: 60_000,
      sleep: async () => undefined,
    });
  const materials = () =>
    createMaterialService({
      setupRepo,
      materialRepo,
      pdfIngestor: createPdfIngestor([new PdfJsTextExtractor()], DEFAULT_MATERIAL_LIMITS),
      limits: DEFAULT_MATERIAL_LIMITS,
    });
  const line = (w: string) =>
    Array.from({ length: 6 }, () => `${w} structures organise data efficiently.`).join(' ');

  it('real PDF → chunks → fake Gemma → verified topics in PostgreSQL, with pages derived from the PDF', async () => {
    const exam = await newExam();
    await materials().addPdf(exam.id, {
      buffer: makePdf([
        [line('Hash')],
        [],
        [`Hashing maps keys to buckets using a hash function. ${line('Tree')}`],
      ]),
      originalName: 'notes.pdf',
    });
    const provider = new FakeAiProvider((req) => {
      const { chunkId, material } = readPrompt(req);
      return response([
        {
          name: 'Data Structures',
          topics: [
            topic(chunkId, quoteFrom(material, 60, material.indexOf('Hashing maps keys')), {
              name: 'Hashing',
              weakTopicMatch: 'Hashing',
              parent: null,
            }),
            topic(chunkId, 'Invented sentence that is nowhere in the document at all', {
              name: 'Ghost',
            }),
          ],
        },
      ]);
    });
    const svc = service(provider);
    const { run } = await svc.start(exam.id);
    await svc.whenIdle();
    expect((await svc.getRun(run.id)).run).toMatchObject({
      status: 'SUCCEEDED',
      topicCount: 1,
      droppedTopics: 1,
      totalChunks: 1,
    });
    const result = await svc.getResult(exam.id);
    const hashing = result.subjects[0]?.topics[0];
    expect(hashing).toMatchObject({ name: 'Hashing', isWeak: true, weakHint: 'Hashing' });
    expect(hashing?.evidence[0]).toMatchObject({ page: 3, materialName: 'notes.pdf' }); // page 2 is image-only
    const stored = await prisma.topic.findFirst({ where: { subject: { examId: exam.id } } });
    expect(stored).toMatchObject({ effortClass: 'STANDARD', analysisRunId: run.id });
    // Reuse: identical analysis makes no further model calls.
    const calls = provider.calls.length;
    expect((await svc.start(exam.id)).reused).toBe(true);
    expect(provider.calls.length).toBe(calls);
  });

  it('enforces one active run per exam under concurrent starts (advisory lock)', async () => {
    const exam = await newExam();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        repo.createRunIfNoActive({
          examId: exam.id,
          fingerprint: 'f',
          provider: 'fake',
          model: 'm',
          materialCount: 1,
        }),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
    expect(await prisma.analysisRun.count({ where: { examId: exam.id } })).toBe(1);
  });

  it('saveResult is transactional: a failing save leaves the previous topics untouched', async () => {
    const exam = await newExam();
    const mk = async () =>
      (
        await repo.createRunIfNoActive({
          examId: exam.id,
          fingerprint: `f${Math.random()}`,
          provider: 'fake',
          model: 'm',
          materialCount: 1,
        })
      ).run;
    const topicOf = (name: string, extra: object = {}) => ({
      name,
      parent: null,
      description: '',
      difficulty: 'EASY' as const,
      importance: 'LOW' as const,
      effortClass: 'QUICK' as const,
      revisionWeight: 0.25,
      estimatedMinutes: 20,
      origin: 'EXTRACTED' as const,
      statedEmphasis: false,
      confidence: 0.5,
      prerequisites: [],
      isWeak: false,
      weakHint: null,
      evidence: [],
      ...extra,
    });
    const first = await mk();
    await repo.saveResult(first.id, exam.id, [{ name: 'S1', topics: [topicOf('Old')] }], {
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      finishedAt: new Date(),
    });
    await repo.updateRun(first.id, {});
    const second = await mk();
    // The run vanishes mid-way: the LAST statement of the transaction fails, after the new topics were written.
    await prisma.analysisRun.delete({ where: { id: second.id } });
    await expect(
      repo.saveResult(second.id, exam.id, [{ name: 'S2', topics: [topicOf('New')] }], {
        status: 'SUCCEEDED',
      }),
    ).rejects.toThrow();
    expect((await repo.loadResult(exam.id)).map((s) => s.name)).toEqual(['S1']);
  });

  it('stores parent and prerequisite relations and history across re-runs', async () => {
    const exam = await newExam();
    const run = (
      await repo.createRunIfNoActive({
        examId: exam.id,
        fingerprint: 'rel',
        provider: 'fake',
        model: 'm',
        materialCount: 1,
      })
    ).run;
    const t = (name: string, extra: object = {}) => ({
      name,
      parent: null,
      description: 'd',
      difficulty: 'MEDIUM' as const,
      importance: 'MEDIUM' as const,
      effortClass: 'STANDARD' as const,
      revisionWeight: 0.5,
      estimatedMinutes: 45,
      origin: 'EXTRACTED' as const,
      statedEmphasis: true,
      confidence: 0.9,
      prerequisites: [],
      isWeak: false,
      weakHint: null,
      evidence: [{ materialId: 'm', chunkId: 'c', page: 1, pageEnd: null, snippet: 's' }],
      ...extra,
    });
    await repo.saveResult(
      run.id,
      exam.id,
      [
        {
          name: 'S',
          topics: [t('Trees'), t('Binary Trees', { parent: 'Trees', prerequisites: ['Trees'] })],
        },
      ],
      { status: 'SUCCEEDED', stage: 'COMPLETED', finishedAt: new Date() },
    );
    const stored = (await repo.loadResult(exam.id))[0]?.topics ?? [];
    const binary = stored.find((x) => x.name === 'Binary Trees');
    const trees = stored.find((x) => x.name === 'Trees');
    expect(binary).toMatchObject({ parent: 'Trees', parentId: trees?.id });
    expect(binary?.prerequisiteIds).toEqual([trees?.id]);
    expect((await repo.findCurrentResultRun(exam.id))?.id).toBe(run.id);
  });

  it('failActiveRuns fails stuck runs only', async () => {
    const exam = await newExam();
    const { run } = await repo.createRunIfNoActive({
      examId: exam.id,
      fingerprint: 'stuck',
      provider: 'fake',
      model: 'm',
      materialCount: 1,
    });
    await repo.updateRun(run.id, { status: 'RUNNING', heartbeatAt: new Date() });
    expect(
      await repo.failActiveRuns(null, { code: 'ANALYSIS_INTERRUPTED', message: 'x' }, new Date()),
    ).toBeGreaterThanOrEqual(1);
    expect((await repo.findRun(run.id))?.status).toBe('FAILED');
  });
});
