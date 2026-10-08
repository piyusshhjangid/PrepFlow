/**
 * Integration test for the Prisma repositories against a REAL PostgreSQL TEST database.
 * Run with `npm run test:integration` (never part of plain `npm test`). It FAILS, rather than
 * skips, when the test database is not configured. Every row it creates is deleted afterwards.
 */
import { DEFAULT_MATERIAL_LIMITS } from '@prepflow/shared';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePageTexts, serializePages } from '../../domain/documents/pages.js';
import { makePdf } from '../../test/make-pdf.js';
import { createMaterialService } from '../../services/material.service.js';
import { createPdfIngestor } from '../../services/pdf-ingestor.js';
import { assertSafeTestDatabase } from '../../config/test-database.js';
import { PdfJsTextExtractor } from '../pdf/pdfjs-text-extractor.js';
import { PrismaMaterialRepository } from './prisma-material-repository.js';
import { PrismaSetupRepository } from './prisma-setup-repository.js';

const url = assertSafeTestDatabase(process.env.DATABASE_URL, undefined);

describe('Prisma repositories (integration, real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let setupRepo: PrismaSetupRepository;
  let materialRepo: PrismaMaterialRepository;
  const createdProfileIds: string[] = [];

  async function newExam() {
    const exam = await setupRepo.createProfileWithExam({
      nickname: 'Integration Test',
      name: 'Test Exam',
      examDate: new Date('2026-10-11T00:00:00.000Z'),
      minutesPerDay: 180,
      studyDays: [1, 2, 3],
      weakTopicHints: ['Normalization'],
      confidence: 2,
      bufferPct: 10,
      blockedDates: [],
    });
    createdProfileIds.push(exam.profileId);
    return exam;
  }

  const newMaterial = (examId: string, text: string, hash: string) => ({
    examId,
    sourceType: 'TEXT' as const,
    filename: null,
    contentHash: hash,
    extractedText: text,
    charCount: text.length,
    pageCount: null,
    lowTextPageCount: null,
  });

  beforeAll(() => {
    prisma = new PrismaClient({ datasourceUrl: url });
    setupRepo = new PrismaSetupRepository(prisma);
    materialRepo = new PrismaMaterialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.studyProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    await prisma.$disconnect();
  });

  it('creates and reads an exam, round-tripping the date, arrays and nickname', async () => {
    const created = await newExam();
    const found = await setupRepo.findExam(created.id);
    expect(found).toMatchObject({
      nickname: 'Integration Test',
      name: 'Test Exam',
      minutesPerDay: 180,
      studyDays: [1, 2, 3],
      weakTopicHints: ['Normalization'],
      confidence: 2,
      bufferPct: 10,
      blockedDates: [],
      revisionIntervalsDays: [1, 3, 7],
      revisionReservePct: 15,
    });
    expect(found?.examDate.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  it('updates only the provided fields, clears confidence with null, and returns null for an unknown exam', async () => {
    const { id } = await newExam();
    const updated = await setupRepo.updateExam(id, { minutesPerDay: 240, confidence: null });
    expect(updated).toMatchObject({
      minutesPerDay: 240,
      confidence: null,
      name: 'Test Exam',
      studyDays: [1, 2, 3],
    });
    expect(
      await setupRepo.updateExam('00000000-0000-4000-8000-000000000099', { minutesPerDay: 60 }),
    ).toBeNull();
    expect(await setupRepo.findExam('00000000-0000-4000-8000-000000000099')).toBeNull();
  });

  it('stores a material once; the identical hash returns the existing row', async () => {
    const { id: examId } = await newExam();
    const first = await materialRepo.createIfAbsent(
      newMaterial(examId, 'alpha beta gamma', 'hash-1'),
    );
    const again = await materialRepo.createIfAbsent(
      newMaterial(examId, 'alpha beta gamma', 'hash-1'),
    );
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.material.id).toBe(first.material.id);
    expect(await materialRepo.countByExam(examId)).toBe(1);
  });

  it('is safe under concurrent identical uploads: exactly one row, exactly one "created"', async () => {
    const { id: examId } = await newExam();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        materialRepo.createIfAbsent(newMaterial(examId, 'race text', 'hash-race')),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.material.id)).size).toBe(1);
    expect(await materialRepo.countByExam(examId)).toBe(1);
  });

  it('preserves the form-feed page separator through the database', async () => {
    const { id: examId } = await newExam();
    const pages = ['Page one', '', 'Page three\nsecond line'];
    const { material } = await materialRepo.createIfAbsent({
      ...newMaterial(examId, serializePages(pages), 'hash-pages'),
      sourceType: 'PDF',
      pageCount: 3,
      lowTextPageCount: 1,
    });
    const row = await prisma.studyMaterial.findUnique({
      where: { id: material.id },
      select: { extractedText: true },
    });
    expect(parsePageTexts(row?.extractedText ?? '')).toEqual(pages);
  });

  it('lists summaries without loading the text, oldest first', async () => {
    const { id: examId } = await newExam();
    await materialRepo.createIfAbsent(newMaterial(examId, 'first', 'hash-l1'));
    await materialRepo.createIfAbsent(newMaterial(examId, 'second', 'hash-l2'));
    const list = await materialRepo.listByExam(examId);
    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty('extractedText');
    expect(list[0]?.createdAt.getTime()).toBeLessThanOrEqual(list[1]?.createdAt.getTime() ?? 0);
  });

  it('reports not-found when the exam does not exist (foreign-key violation)', async () => {
    await expect(
      materialRepo.createIfAbsent(
        newMaterial('00000000-0000-4000-8000-000000000099', 'x', 'hash-fk'),
      ),
    ).rejects.toMatchObject({ code: 'EXAM_NOT_FOUND' });
  });

  it('deletes a material once; a second delete reports false', async () => {
    const { id: examId } = await newExam();
    const { material } = await materialRepo.createIfAbsent(
      newMaterial(examId, 'to delete', 'hash-del'),
    );
    expect(await materialRepo.delete(material.id)).toBe(true);
    expect(await materialRepo.delete(material.id)).toBe(false);
  });

  it('end to end: a real PDF goes through the service into PostgreSQL with correct pages', async () => {
    const { id: examId } = await newExam();
    const service = createMaterialService({
      setupRepo,
      materialRepo,
      pdfIngestor: createPdfIngestor([new PdfJsTextExtractor()], DEFAULT_MATERIAL_LIMITS),
      limits: DEFAULT_MATERIAL_LIMITS,
    });
    const line = (w: string) => Array.from({ length: 20 }, () => w).join(' ');
    const result = await service.addPdf(examId, {
      buffer: makePdf([[line('alpha')], [], [line('gamma')]]),
      originalName: 'integration.pdf',
    });
    expect(result.material).toMatchObject({ pageCount: 3, lowTextPageCount: 1, sourceType: 'PDF' });
    const row = await prisma.studyMaterial.findUnique({
      where: { id: result.material.id },
      select: { extractedText: true },
    });
    const pages = parsePageTexts(row?.extractedText ?? '');
    expect(pages).toHaveLength(3);
    expect(pages[1]).toBe('');
    expect(pages[2]).toContain('gamma');
  });
});
