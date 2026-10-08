import type {
  AddMaterialResponse,
  ListMaterialsResponse,
  MaterialLimits,
  MaterialSummary,
} from '@prepflow/shared';
import { buildTextDocument, type NormalizedDocument } from '../domain/documents/document.js';
import { documentErrors } from '../domain/documents/document-errors.js';
import { looksLikePdf } from '../domain/documents/filename.js';
import { NotFoundError } from '../errors/index.js';
import { logger } from '../infrastructure/logger.js';
import type { MaterialRecord, MaterialRepository, SetupRepository } from './ports.js';
import type { PdfIngestor } from './pdf-ingestor.js';

export function toMaterialSummary(record: MaterialRecord): MaterialSummary {
  return {
    id: record.id,
    examId: record.examId,
    sourceType: record.sourceType,
    filename: record.filename,
    charCount: record.charCount,
    pageCount: record.pageCount,
    lowTextPageCount: record.lowTextPageCount,
    createdAt: record.createdAt.toISOString(),
  };
}

export interface MaterialServiceDeps {
  setupRepo: Pick<SetupRepository, 'findExam'>;
  materialRepo: MaterialRepository;
  pdfIngestor: PdfIngestor;
  limits: MaterialLimits;
}

/**
 * Ingestion is entirely deterministic: validate → extract → normalize → hash → persist.
 * There are no AI calls anywhere in this service. Failures store nothing.
 */
export function createMaterialService(deps: MaterialServiceDeps) {
  const { setupRepo, materialRepo, pdfIngestor, limits } = deps;

  async function requireExam(examId: string): Promise<void> {
    const exam = await setupRepo.findExam(examId);
    if (!exam) {
      throw new NotFoundError(
        'We couldn’t find that study setup. Start a new one to continue.',
        'EXAM_NOT_FOUND',
      );
    }
  }

  /** Cheap check done before any expensive parsing. */
  async function assertRoomForAnother(examId: string): Promise<void> {
    if ((await materialRepo.countByExam(examId)) >= limits.maxMaterialsPerExam) {
      throw documentErrors.materialLimitReached(limits.maxMaterialsPerExam);
    }
  }

  async function persist(
    examId: string,
    document: NormalizedDocument,
    meta: { operation: string; startedAt: number; extractor?: string },
  ): Promise<AddMaterialResponse> {
    const { material, created } = await materialRepo.createIfAbsent({
      examId,
      sourceType: document.sourceType,
      filename: document.filename,
      contentHash: document.contentHash,
      extractedText: document.storedText,
      charCount: document.charCount,
      pageCount: document.pageCount,
      lowTextPageCount: document.lowTextPageCount,
    });
    // Metadata only: never log text or filenames (they can contain personal information).
    logger.info('material ingested', {
      operation: meta.operation,
      sourceType: document.sourceType,
      pages: document.pageCount,
      lowTextPages: document.lowTextPageCount,
      chars: document.charCount,
      duplicate: !created,
      extractor: meta.extractor,
      durationMs: Date.now() - meta.startedAt,
    });
    return { material: toMaterialSummary(material), duplicate: !created };
  }

  return {
    limits,

    async list(examId: string): Promise<ListMaterialsResponse> {
      await requireExam(examId);
      const materials = await materialRepo.listByExam(examId);
      return { materials: materials.map(toMaterialSummary), limits };
    },

    async addText(examId: string, rawText: string): Promise<AddMaterialResponse> {
      const startedAt = Date.now();
      await requireExam(examId);
      await assertRoomForAnother(examId);
      const document = buildTextDocument(rawText, limits);
      return persist(examId, document, { operation: 'add_text', startedAt });
    },

    async addPdf(
      examId: string,
      file: { buffer: Buffer; originalName: string | undefined },
    ): Promise<AddMaterialResponse> {
      const startedAt = Date.now();
      await requireExam(examId);
      await assertRoomForAnother(examId);
      if (file.buffer.length === 0) throw documentErrors.notAPdf();
      if (file.buffer.length > limits.maxPdfBytes)
        throw documentErrors.pdfTooLarge(limits.maxPdfBytes);
      if (!looksLikePdf(file.buffer)) throw documentErrors.notAPdf();

      const { document, extractor } = await pdfIngestor.ingest(file.buffer, file.originalName);
      return persist(examId, document, { operation: 'add_pdf', startedAt, extractor });
    },

    async remove(materialId: string): Promise<void> {
      const deleted = await materialRepo.delete(materialId);
      if (!deleted)
        throw new NotFoundError(
          'We couldn’t find that material. It may already be removed.',
          'MATERIAL_NOT_FOUND',
        );
    },
  };
}

export type MaterialService = ReturnType<typeof createMaterialService>;
