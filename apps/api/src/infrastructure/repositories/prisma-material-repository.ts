import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../errors/index.js';
import type { MaterialRecord, MaterialRepository, NewMaterial } from '../../services/ports.js';

/** Everything except the large `extractedText`, which list/summary queries must never load. */
const summarySelect = {
  id: true,
  examId: true,
  sourceType: true,
  filename: true,
  charCount: true,
  pageCount: true,
  lowTextPageCount: true,
  createdAt: true,
} as const;

function toRecord(row: MaterialRecord): MaterialRecord {
  return {
    id: row.id,
    examId: row.examId,
    sourceType: row.sourceType,
    filename: row.filename,
    charCount: row.charCount,
    pageCount: row.pageCount,
    lowTextPageCount: row.lowTextPageCount,
    createdAt: row.createdAt,
  };
}

export class PrismaMaterialRepository implements MaterialRepository {
  constructor(private readonly db: PrismaClient) {}

  countByExam(examId: string): Promise<number> {
    return this.db.studyMaterial.count({ where: { examId } });
  }

  async listByExam(examId: string): Promise<MaterialRecord[]> {
    const rows = await this.db.studyMaterial.findMany({
      where: { examId },
      orderBy: { createdAt: 'asc' },
      select: summarySelect,
    });
    return rows.map(toRecord);
  }

  async findByHash(examId: string, contentHash: string): Promise<MaterialRecord | null> {
    const row = await this.db.studyMaterial.findUnique({
      where: { examId_contentHash: { examId, contentHash } },
      select: summarySelect,
    });
    return row ? toRecord(row) : null;
  }

  async createIfAbsent(data: NewMaterial): Promise<{ material: MaterialRecord; created: boolean }> {
    try {
      const row = await this.db.studyMaterial.create({ data, select: summarySelect });
      return { material: toRecord(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Unique violation: identical content was added concurrently or earlier. Return the existing row.
        if (error.code === 'P2002') {
          const existing = await this.findByHash(data.examId, data.contentHash);
          if (existing) return { material: existing, created: false };
        }
        // Foreign-key violation: the exam was deleted between the service's check and this insert.
        if (error.code === 'P2003') {
          throw new NotFoundError(
            'We couldn’t find that study setup. Start a new one to continue.',
            'EXAM_NOT_FOUND',
          );
        }
      }
      throw error;
    }
  }

  async delete(materialId: string): Promise<boolean> {
    const result = await this.db.studyMaterial.deleteMany({ where: { id: materialId } });
    return result.count > 0;
  }
}
