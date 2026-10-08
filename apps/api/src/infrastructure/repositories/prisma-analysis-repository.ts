import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AnalysisMaterial,
  AnalysisRepository,
  AnalysisRunPatch,
  AnalysisRunRecord,
  PersistedSubject,
  StoredSubject,
} from '../../services/ports.js';

const ACTIVE = ['QUEUED', 'RUNNING'] as const;

type RunRow = Prisma.AnalysisRunGetPayload<object>;
const toRecord = (row: RunRow): AnalysisRunRecord => ({ ...row });

export class PrismaAnalysisRepository implements AnalysisRepository {
  constructor(private readonly db: PrismaClient) {}

  async loadMaterials(examId: string): Promise<AnalysisMaterial[]> {
    return this.db.studyMaterial.findMany({
      where: { examId },
      select: {
        id: true,
        contentHash: true,
        sourceType: true,
        filename: true,
        extractedText: true,
      },
    });
  }

  async createRunIfNoActive(data: {
    examId: string;
    fingerprint: string;
    provider: string;
    model: string;
    materialCount: number;
  }): Promise<{ run: AnalysisRunRecord; created: boolean }> {
    // A transaction-scoped advisory lock serializes concurrent starts for the same exam, so two
    // simultaneous requests can never both create an active run.
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'analysis:' + data.examId}))`;
      const active = await tx.analysisRun.findFirst({
        where: { examId: data.examId, status: { in: [...ACTIVE] } },
        orderBy: { createdAt: 'desc' },
      });
      if (active) return { run: toRecord(active), created: false };
      const run = await tx.analysisRun.create({ data });
      return { run: toRecord(run), created: true };
    });
  }

  async updateRun(runId: string, patch: AnalysisRunPatch): Promise<AnalysisRunRecord | null> {
    try {
      return toRecord(await this.db.analysisRun.update({ where: { id: runId }, data: patch }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }

  async findRun(runId: string): Promise<AnalysisRunRecord | null> {
    const row = await this.db.analysisRun.findUnique({ where: { id: runId } });
    return row ? toRecord(row) : null;
  }

  async findLatestRun(examId: string): Promise<AnalysisRunRecord | null> {
    const row = await this.db.analysisRun.findFirst({
      where: { examId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async findCurrentResultRun(examId: string): Promise<AnalysisRunRecord | null> {
    const row = await this.db.analysisRun.findFirst({
      where: { examId, status: { in: ['SUCCEEDED', 'PARTIAL'] } },
      orderBy: { finishedAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async saveResult(
    runId: string,
    examId: string,
    subjects: PersistedSubject[],
    finalPatch: AnalysisRunPatch,
  ): Promise<void> {
    await this.db.$transaction(
      async (tx) => {
        // The active plan schedules the topics being replaced: archive it (its finished tasks keep their
        // topic-name snapshot), under the same per-exam lock the plan repository uses.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'plan:' + examId}))`;
        await tx.studyPlan.updateMany({
          where: { examId, status: 'ACTIVE' },
          data: { status: 'ARCHIVED', archivedReason: 'REANALYZED' },
        });
        // Re-analysis replaces the exam's current subjects/topics. Past runs stay as history.
        await tx.subject.deleteMany({ where: { examId } });
        for (const [subjectIndex, subject] of subjects.entries()) {
          const created = await tx.subject.create({
            data: { examId, name: subject.name, sortOrder: subjectIndex },
          });
          const ids = new Map<string, string>();
          for (const [topicIndex, topic] of subject.topics.entries()) {
            const row = await tx.topic.create({
              data: {
                subjectId: created.id,
                analysisRunId: runId,
                name: topic.name,
                description: topic.description || null,
                sortOrder: topicIndex,
                difficulty: topic.difficulty,
                importance: topic.importance,
                revisionWeight: topic.revisionWeight,
                estimatedMinutes: topic.estimatedMinutes,
                origin: topic.origin,
                confidence: topic.confidence,
                statedEmphasis: topic.statedEmphasis,
                effortClass: topic.effortClass,
                weakHint: topic.weakHint,
                isWeak: topic.isWeak,
                evidence: topic.evidence,
              },
              select: { id: true },
            });
            ids.set(topic.name, row.id);
          }
          // Relations by name, resolved within the subject; unknown names are ignored.
          for (const topic of subject.topics) {
            const id = ids.get(topic.name) as string;
            const parentId = topic.parent ? ids.get(topic.parent) : undefined;
            const prerequisiteIds = topic.prerequisites
              .map((name) => ids.get(name))
              .filter((value): value is string => !!value && value !== id);
            if ((parentId && parentId !== id) || prerequisiteIds.length > 0) {
              await tx.topic.update({
                where: { id },
                data: {
                  ...(parentId && parentId !== id ? { parentId } : {}),
                  ...(prerequisiteIds.length > 0
                    ? { prerequisites: { connect: prerequisiteIds.map((p) => ({ id: p })) } }
                    : {}),
                },
              });
            }
          }
        }
        await tx.analysisRun.update({ where: { id: runId }, data: finalPatch });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  async loadResult(examId: string): Promise<StoredSubject[]> {
    const rows = await this.db.subject.findMany({
      where: { examId },
      orderBy: { sortOrder: 'asc' },
      include: {
        topics: {
          orderBy: { sortOrder: 'asc' },
          include: { prerequisites: { select: { id: true } }, parent: { select: { name: true } } },
        },
      },
    });
    return rows.map((subject) => ({
      id: subject.id,
      name: subject.name,
      topics: subject.topics.map((topic) => ({
        id: topic.id,
        subjectId: topic.subjectId,
        parentId: topic.parentId,
        name: topic.name,
        parent: topic.parent?.name ?? null,
        description: topic.description ?? '',
        difficulty: topic.difficulty,
        importance: topic.importance,
        effortClass: topic.effortClass ?? 'STANDARD',
        revisionWeight: topic.revisionWeight,
        estimatedMinutes: topic.estimatedMinutes,
        origin: topic.origin,
        statedEmphasis: topic.statedEmphasis,
        confidence: topic.confidence ?? 0,
        prerequisiteIds: topic.prerequisites.map((p) => p.id),
        prerequisites: [],
        isWeak: topic.isWeak,
        weakHint: topic.weakHint,
        evidence: Array.isArray(topic.evidence)
          ? (topic.evidence as unknown as StoredSubject['topics'][number]['evidence'])
          : [],
      })),
    }));
  }

  async updateReviewedTopic(
    examId: string,
    topicId: string,
    patch: { estimatedMinutes?: number; importance?: 'LOW' | 'MEDIUM' | 'HIGH'; isWeak?: boolean },
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'plan:' + examId}))`;
      const topic = await tx.topic.findFirst({
        where: { id: topicId, subject: { examId } },
        select: { id: true },
      });
      if (!topic) return false;
      await tx.topic.update({
        where: { id: topic.id },
        data: { ...patch, userEdited: true },
      });
      return true;
    });
  }

  async deleteReviewedTopic(examId: string, topicId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'plan:' + examId}))`;
      const topic = await tx.topic.findFirst({
        where: { id: topicId, subject: { examId } },
        select: { id: true },
      });
      if (!topic) return false;
      await tx.topic.delete({ where: { id: topic.id } });
      return true;
    });
  }

  async failActiveRuns(
    olderThan: Date | null,
    error: { code: string; message: string },
    now: Date,
  ): Promise<number> {
    const result = await this.db.analysisRun.updateMany({
      where: {
        status: { in: [...ACTIVE] },
        ...(olderThan
          ? {
              OR: [
                { heartbeatAt: { lt: olderThan } },
                { heartbeatAt: null, createdAt: { lt: olderThan } },
              ],
            }
          : {}),
      },
      data: {
        status: 'FAILED',
        errorCode: error.code,
        errorMessage: error.message,
        finishedAt: now,
      },
    });
    return result.count;
  }
}
