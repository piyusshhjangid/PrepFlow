import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  NewPlan,
  PlanRecord,
  PlanRepository,
  PlanWithTasks,
  TaskPatch,
  TaskRecord,
} from '../../services/ports.js';

type PlanRow = Prisma.StudyPlanGetPayload<object>;
type TaskRow = Prisma.StudyTaskGetPayload<object>;

const toPlan = (row: PlanRow): PlanRecord => ({
  id: row.id,
  examId: row.examId,
  version: row.version,
  status: row.status,
  trigger: row.trigger,
  planDate: row.planDate,
  basedOnAnalysisRunId: row.basedOnAnalysisRunId,
  availableMinutes: row.availableMinutes,
  requiredMinutes: row.requiredMinutes,
  scheduledMinutes: row.scheduledMinutes,
  config: row.config,
  summary: row.summary,
  archivedReason: row.archivedReason,
  createdAt: row.createdAt,
});

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id,
  planId: row.planId,
  topicId: row.topicId,
  topicName: row.topicName,
  subjectName: row.subjectName,
  type: row.type,
  revisionIndex: row.revisionIndex,
  partIndex: row.partIndex,
  partCount: row.partCount,
  scheduledDate: row.scheduledDate,
  originalDate: row.originalDate,
  plannedMinutes: row.plannedMinutes,
  actualMinutes: row.actualMinutes,
  sortOrder: row.sortOrder,
  status: row.status,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  priorityScore: row.priorityScore,
  tier: row.tier,
  reasons: row.reasons ?? [],
  carriedFromTaskId: row.carriedFromTaskId,
});

const TASK_ORDER = [{ scheduledDate: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] as const;

/** Thin mapping layer. Per-exam advisory locks serialize rebalances and task updates; all queries are parameterized. */
export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly db: PrismaClient) {}

  private lock(tx: Prisma.TransactionClient, examId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'plan:' + examId}))`;
  }

  async findActive(examId: string): Promise<PlanWithTasks | null> {
    const row = await this.db.studyPlan.findFirst({
      where: { examId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: { tasks: { orderBy: [...TASK_ORDER] } },
    });
    return row ? { plan: toPlan(row), tasks: row.tasks.map(toTask) } : null;
  }

  async findLatest(examId: string): Promise<PlanRecord | null> {
    const row = await this.db.studyPlan.findFirst({
      where: { examId },
      orderBy: { version: 'desc' },
    });
    return row ? toPlan(row) : null;
  }

  async listVersions(examId: string): Promise<PlanRecord[]> {
    const rows = await this.db.studyPlan.findMany({
      where: { examId },
      orderBy: { version: 'desc' },
      take: 50,
    });
    return rows.map(toPlan);
  }

  async materialNames(examId: string): Promise<Map<string, string | null>> {
    const rows = await this.db.studyMaterial.findMany({
      where: { examId },
      select: { id: true, filename: true },
    });
    return new Map(rows.map((r) => [r.id, r.filename]));
  }

  async replaceActive(
    examId: string,
    reason: string,
    build: (current: PlanWithTasks | null) => NewPlan,
  ): Promise<PlanWithTasks> {
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, examId);
        const activeRow = await tx.studyPlan.findFirst({
          where: { examId, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          include: { tasks: { orderBy: [...TASK_ORDER] } },
        });
        const current = activeRow
          ? { plan: toPlan(activeRow), tasks: activeRow.tasks.map(toTask) }
          : null;
        const next = build(current);

        if (activeRow)
          await tx.studyPlan.updateMany({
            where: { examId, status: 'ACTIVE' },
            data: { status: 'ARCHIVED', archivedReason: reason },
          });
        const latest = await tx.studyPlan.findFirst({
          where: { examId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await tx.studyPlan.create({
          data: {
            examId,
            version: (latest?.version ?? 0) + 1,
            status: 'ACTIVE',
            trigger: next.trigger,
            planDate: next.planDate,
            basedOnAnalysisRunId: next.basedOnAnalysisRunId,
            availableMinutes: next.availableMinutes,
            requiredMinutes: next.requiredMinutes,
            scheduledMinutes: next.scheduledMinutes,
            config: next.config as Prisma.InputJsonValue,
            summary: next.summary as Prisma.InputJsonValue,
          },
        });
        if (next.tasks.length > 0)
          await tx.studyTask.createMany({
            data: next.tasks.map((t) => ({ ...t, planId: created.id })),
          });
        const tasks = await tx.studyTask.findMany({
          where: { planId: created.id },
          orderBy: [...TASK_ORDER],
        });
        return { plan: toPlan(created), tasks: tasks.map(toTask) };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  async mutateTask(
    taskId: string,
    decide: (task: TaskRecord, plan: PlanRecord) => TaskPatch | null,
  ): Promise<{ task: TaskRecord; plan: PlanRecord; changed: boolean; activePlan: boolean } | null> {
    const peek = await this.db.studyTask.findUnique({
      where: { id: taskId },
      select: { plan: { select: { examId: true } } },
    });
    if (!peek) return null;
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, peek.plan.examId);
      const row = await tx.studyTask.findUnique({ where: { id: taskId }, include: { plan: true } });
      if (!row) return null;
      const task = toTask(row);
      const plan = toPlan(row.plan);
      const patch = decide(task, plan);
      if (patch === null)
        return { task, plan, changed: false, activePlan: plan.status === 'ACTIVE' };
      const updated = await tx.studyTask.update({ where: { id: taskId }, data: patch });
      if (plan.status === 'ACTIVE' && updated.type === 'STUDY' && updated.topicId) {
        const studyTasks = await tx.studyTask.findMany({
          where: { planId: plan.id, topicId: updated.topicId, type: 'STUDY' },
          select: { status: true },
        });
        const topicStatus = studyTasks.every((item) => item.status === 'COMPLETED')
          ? 'COMPLETED'
          : studyTasks.some((item) => item.status === 'IN_PROGRESS' || item.status === 'COMPLETED')
            ? 'IN_PROGRESS'
            : 'NOT_STARTED';
        await tx.topic.updateMany({
          where: { id: updated.topicId },
          data: {
            status: topicStatus,
            completedAt: topicStatus === 'COMPLETED' ? updated.completedAt : null,
          },
        });
      }
      return { task: toTask(updated), plan, changed: true, activePlan: plan.status === 'ACTIVE' };
    });
  }

  async findTask(taskId: string): Promise<{ task: TaskRecord; plan: PlanRecord } | null> {
    const row = await this.db.studyTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });
    return row ? { task: toTask(row), plan: toPlan(row.plan) } : null;
  }
}
