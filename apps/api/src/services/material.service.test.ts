import { DEFAULT_MATERIAL_LIMITS, type MaterialLimits } from '@prepflow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toNormalizedPages } from '../domain/documents/pages.js';
import { PdfJsTextExtractor } from '../infrastructure/pdf/pdfjs-text-extractor.js';
import type { PdfPageExtractor } from '../infrastructure/pdf/pdf-page-extractor.js';
import { makePdf } from '../test/make-pdf.js';
import { InMemoryMaterialRepository, InMemorySetupRepository } from '../test/in-memory.js';
import { createMaterialService } from './material.service.js';
import { createPdfIngestor } from './pdf-ingestor.js';
import { createSetupService } from './setup.service.js';

const NOW = new Date('2026-10-03T10:00:00.000Z');
const sentence = (word: string) => `${Array.from({ length: 20 }, () => word).join(' ')}.`;
const NOTES = `Unit 1\n${sentence('normalization')}\nUnit 2\n${sentence('deadlocks')}`;

let setupRepo: InMemorySetupRepository;
let materialRepo: InMemoryMaterialRepository;
let examId: string;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function build(options: { limits?: MaterialLimits; extractors?: PdfPageExtractor[] } = {}) {
  const limits = options.limits ?? DEFAULT_MATERIAL_LIMITS;
  const extractors = options.extractors ?? [new PdfJsTextExtractor()];
  return createMaterialService({
    setupRepo,
    materialRepo,
    pdfIngestor: createPdfIngestor(extractors, limits),
    limits,
  });
}

beforeEach(async () => {
  setupRepo = new InMemorySetupRepository();
  materialRepo = new InMemoryMaterialRepository();
  const setup = createSetupService({ repo: setupRepo, clock: () => NOW });
  examId = (
    await setup.createProfileWithExam({
      nickname: 'Asha',
      examName: 'DBMS Final',
      examDate: '2026-10-11',
      minutesPerDay: 180,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
      weakTopicHints: [],
      blockedDates: [],
      bufferPct: 10,
    })
  ).id;
});

describe('addText', () => {
  it('stores normalized text and returns a summary without the text', async () => {
    const service = build();
    const result = await service.addText(examId, `  ${NOTES.replace(/\n/g, '\r\n')}  `);
    expect(result.duplicate).toBe(false);
    expect(result.material).toMatchObject({
      examId,
      sourceType: 'TEXT',
      pageCount: null,
      lowTextPageCount: null,
    });
    expect(result.material).not.toHaveProperty('extractedText');

    const stored = [...materialRepo.rows.values()][0];
    expect(stored?.extractedText).not.toContain('\r');
    expect(toNormalizedPages(stored?.extractedText ?? '', 'TEXT')).toHaveLength(1);
  });

  it('scenario 4: refuses empty material, stores nothing, and the exam still has no material', async () => {
    const service = build();
    expect(await codeOf(service.addText(examId, '   \n  '))).toBe('TEXT_TOO_SHORT');
    expect(materialRepo.rows.size).toBe(0);
    expect((await service.list(examId)).materials).toEqual([]);
  });

  it('refuses text over the configured limit', async () => {
    const service = build({ limits: { ...DEFAULT_MATERIAL_LIMITS, maxChars: 80 } });
    expect(await codeOf(service.addText(examId, NOTES))).toBe('DOCUMENT_TOO_LONG');
    expect(materialRepo.rows.size).toBe(0);
  });

  it('returns not-found for an unknown exam and stores nothing', async () => {
    const service = build();
    expect(await codeOf(service.addText('00000000-0000-4000-8000-000000000099', NOTES))).toBe(
      'EXAM_NOT_FOUND',
    );
    expect(materialRepo.rows.size).toBe(0);
  });

  it('treats identical content as a duplicate, even with different whitespace, and stores one row', async () => {
    const service = build();
    const first = await service.addText(examId, NOTES);
    const second = await service.addText(examId, `\n\n${NOTES.replace(/ /g, '   ')}\r\n\r\n\r\n`);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.material.id).toBe(first.material.id);
    expect(materialRepo.rows.size).toBe(1);
  });

  it('enforces the per-exam material limit', async () => {
    const service = build({ limits: { ...DEFAULT_MATERIAL_LIMITS, maxMaterialsPerExam: 2 } });
    await service.addText(examId, sentence('alpha'));
    await service.addText(examId, sentence('beta'));
    expect(await codeOf(service.addText(examId, sentence('gamma')))).toBe('MATERIAL_LIMIT_REACHED');
    expect(materialRepo.rows.size).toBe(2);
  });
});

describe('addPdf', () => {
  const originalName = 'notes.pdf';

  it('extracts, normalizes and stores a multi-page PDF with physical page numbers', async () => {
    const service = build();
    const pdf = makePdf([
      ['UNIT ONE', sentence('normalization')],
      ['UNIT TWO', sentence('deadlocks')],
      ['UNIT THREE', sentence('greedy')],
    ]);
    const result = await service.addPdf(examId, { buffer: pdf, originalName });
    expect(result.material).toMatchObject({
      sourceType: 'PDF',
      filename: 'notes.pdf',
      pageCount: 3,
      lowTextPageCount: 0,
    });

    const stored = [...materialRepo.rows.values()][0];
    const pages = toNormalizedPages(stored?.extractedText ?? '', 'PDF');
    expect(pages.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(pages[1]?.text).toContain('deadlocks');
    expect(pages[1]?.text).not.toContain('normalization');
  });

  it('keeps pages with no text, counts them as low-text, and keeps numbering correct', async () => {
    const service = build();
    const pdf = makePdf([[sentence('alpha')], [], [sentence('gamma')]]);
    const result = await service.addPdf(examId, { buffer: pdf, originalName });
    expect(result.material).toMatchObject({ pageCount: 3, lowTextPageCount: 1 });
    const pages = toNormalizedPages([...materialRepo.rows.values()][0]?.extractedText ?? '', 'PDF');
    expect(pages[1]).toEqual({ number: 2, text: '' });
    expect(pages[2]?.text).toContain('gamma');
  });

  it('scenario 7: rejects a file that is not a PDF without ever invoking an extractor', async () => {
    const extract = vi.fn();
    const service = build({ extractors: [{ name: 'spy', extract }] });
    expect(
      await codeOf(
        service.addPdf(examId, {
          buffer: Buffer.from('MZ not a pdf at all'),
          originalName: 'x.pdf',
        }),
      ),
    ).toBe('PDF_INVALID');
    expect(extract).not.toHaveBeenCalled();
    expect(materialRepo.rows.size).toBe(0);
  });

  it('scenario 7: rejects a corrupt PDF (valid header, broken body) and stores nothing', async () => {
    const service = build();
    const broken = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage '.repeat(50))]);
    expect(await codeOf(service.addPdf(examId, { buffer: broken, originalName }))).toBe(
      'PDF_UNREADABLE',
    );
    expect(materialRepo.rows.size).toBe(0);
  });

  it('rejects an empty upload', async () => {
    const service = build();
    expect(await codeOf(service.addPdf(examId, { buffer: Buffer.alloc(0), originalName }))).toBe(
      'PDF_INVALID',
    );
  });

  it('rejects an oversized PDF before parsing it', async () => {
    const extract = vi.fn();
    const service = build({
      limits: { ...DEFAULT_MATERIAL_LIMITS, maxPdfBytes: 100 },
      extractors: [{ name: 'spy', extract }],
    });
    const pdf = makePdf([[sentence('alpha')]]);
    expect(await codeOf(service.addPdf(examId, { buffer: pdf, originalName }))).toBe(
      'PDF_TOO_LARGE',
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects a PDF with too many pages', async () => {
    const service = build({ limits: { ...DEFAULT_MATERIAL_LIMITS, maxPdfPages: 2 } });
    const pdf = makePdf([[sentence('a')], [sentence('b')], [sentence('c')]]);
    expect(await codeOf(service.addPdf(examId, { buffer: pdf, originalName }))).toBe(
      'PDF_TOO_MANY_PAGES',
    );
    expect(materialRepo.rows.size).toBe(0);
  });

  it('scanned-style PDF (pages without any text) fails as PDF_NO_TEXT and stores nothing', async () => {
    const service = build();
    const pdf = makePdf([[], [], []]);
    expect(await codeOf(service.addPdf(examId, { buffer: pdf, originalName }))).toBe('PDF_NO_TEXT');
    expect(materialRepo.rows.size).toBe(0);
  });

  it('treats the same PDF uploaded twice as a duplicate', async () => {
    const service = build();
    const pdf = makePdf([[sentence('alpha')], [sentence('beta')]]);
    const first = await service.addPdf(examId, { buffer: pdf, originalName: 'a.pdf' });
    const second = await service.addPdf(examId, { buffer: pdf, originalName: 'renamed.pdf' });
    expect(second.duplicate).toBe(true);
    expect(second.material.id).toBe(first.material.id);
    expect(materialRepo.rows.size).toBe(1);
  });

  it('propagates extractor failures and stores nothing', async () => {
    const service = build({
      extractors: [
        {
          name: 'broken',
          extract: async () => {
            throw new Error('boom');
          },
        },
      ],
    });
    await expect(
      service.addPdf(examId, { buffer: makePdf([[sentence('a')]]), originalName }),
    ).rejects.toThrow('boom');
    expect(materialRepo.rows.size).toBe(0);
  });
});

describe('extractor fallback seam (how OCR could be added later)', () => {
  const noText: PdfPageExtractor = { name: 'first', extract: async () => ['', ''] };
  const withText = (name: string): PdfPageExtractor => ({
    name,
    extract: async () => [sentence('recovered'), sentence('pages')],
  });

  it('uses the next extractor when the first yields no usable text', async () => {
    const ingestor = createPdfIngestor([noText, withText('second')], DEFAULT_MATERIAL_LIMITS);
    const result = await ingestor.ingest(makePdf([[sentence('x')]]), 'x.pdf');
    expect(result.extractor).toBe('second');
    expect(result.document.pageCount).toBe(2);
  });

  it('does not call later extractors when an earlier one succeeds', async () => {
    const later = vi.fn();
    const ingestor = createPdfIngestor(
      [withText('first'), { name: 'later', extract: later }],
      DEFAULT_MATERIAL_LIMITS,
    );
    expect((await ingestor.ingest(makePdf([[sentence('x')]]), 'x.pdf')).extractor).toBe('first');
    expect(later).not.toHaveBeenCalled();
  });

  it('ends as PDF_NO_TEXT when no extractor yields usable text', async () => {
    const ingestor = createPdfIngestor([noText, noText], DEFAULT_MATERIAL_LIMITS);
    expect(await codeOf(ingestor.ingest(makePdf([[sentence('x')]]), 'x.pdf'))).toBe('PDF_NO_TEXT');
  });
});

describe('list / remove', () => {
  it('lists summaries with the effective limits, oldest first', async () => {
    const service = build();
    await service.addText(examId, sentence('alpha'));
    await service.addPdf(examId, { buffer: makePdf([[sentence('beta')]]), originalName: 'b.pdf' });
    const result = await service.list(examId);
    expect(result.materials.map((m) => m.sourceType)).toEqual(['TEXT', 'PDF']);
    expect(result.limits).toEqual(DEFAULT_MATERIAL_LIMITS);
  });

  it('removes a material, and reports not-found for one that is gone', async () => {
    const service = build();
    const { material } = await service.addText(examId, sentence('alpha'));
    await service.remove(material.id);
    expect(materialRepo.rows.size).toBe(0);
    expect(await codeOf(service.remove(material.id))).toBe('MATERIAL_NOT_FOUND');
  });
});
