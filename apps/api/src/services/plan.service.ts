import {
  PLANNING_LIMITS,
  addDaysIso,
  diffDaysIso,
  parseIsoDate,
  planSummarySchema,
  priorityLevelOf,
  toIsoDate,
  todayIso,
  type AnalyzedTopic,
  type GeneratePlanInput,
  type GetPlanResponse,
  type PlanSummary,
  type PlanTrigger,
  type PlanVersion,
  type RebalanceInput,
  type StudyPlanResponse,
  type StudyTaskView,
  type TaskActionInput,
  type TaskActionResponse,
  type TodayResponse,
  type TopicDetailResponse,
  type TopicPlanInsight,
} from '@prepflow/shared';
import {
  PlanningInputError,
  buildCalendar,
  computeProgress,
  generatePlan,
  isOpen,
  recoverMissedTasks,
  summarizeDays,
  type HistoryTask,
  type PlanConfig,
  type PlanTopic,
  type TaskDraft,
} from '../domain/planning/index.js';
import { AppError, NotFoundError, ValidationError } from '../errors/index.js';
import type { AnalysisService } from './analysis.service.js';
import type {
  AnalysisRepository,
  ExamRecord,
  NewPlan,
  PlanRecord,
  PlanRepository,
  PlanWithTasks,
  SetupRepository,
  TaskPatch,
  TaskRecord,
} from './ports.js';

const EXAM_NOT_FOUND = 'We couldn’t find that study setup. Start a new one to continue.';
const NO_PLAN = 'There is no study plan yet. Generate one first.';

export interface PlanServiceDeps {
  setupRepo: Pick<SetupRepository, 'findExam'>;
  analysisRepo: Pick<AnalysisRepository, 'loadResult' | 'findCurrentResultRun'>;
  analysis: Pick<AnalysisService, 'getResult'>;
  repo: PlanRepository;
  /** Injected so tests control "today". */
  clock?: () => Date;
}

/** The planner settings stored with every plan version (so the plan can be explained and reproduced). */
interface StoredConfig extends PlanConfig {
  /** Exam settings at plan time; compared with the live exam to detect "settings changed". */
  fingerprint: string;
}

const taskIso = (d: Date) => toIsoDate(d);

function toHistory(task: TaskRecord): HistoryTask {
  return {
    id: task.id,
    topicId: task.topicId,
    topicName: task.topicName,
    subjectName: task.subjectName,
    type: task.type,
    revisionIndex: task.revisionIndex,
    partIndex: task.partIndex,
    partCount: task.partCount,
    date: taskIso(task.scheduledDate),
    originalDate: task.originalDate ? taskIso(task.originalDate) : null,
    minutes: task.plannedMinutes,
    actualMinutes: task.actualMinutes,
    sortOrder: task.sortOrder,
    status: task.status,
    startedAt: task.startedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    priorityScore: task.priorityScore,
    tier: task.tier,
    reasons: task.reasons,
    carriedFromTaskId: task.carriedFromTaskId,
  };
}

function toNewTask(draft: TaskDraft, validTopics: ReadonlySet<string>): NewPlan['tasks'][number] {
  return {
    topicId: draft.topicId !== null && validTopics.has(draft.topicId) ? draft.topicId : null,
    topicName: draft.topicName,
    subjectName: draft.subjectName,
    type: draft.type,
    revisionIndex: draft.revisionIndex,
    partIndex: draft.partIndex,
    partCount: draft.partCount,
    scheduledDate: parseIsoDate(draft.date),
    originalDate: draft.originalDate ? parseIsoDate(draft.originalDate) : null,
    plannedMinutes: draft.minutes,
    actualMinutes: draft.actualMinutes,
    sortOrder: draft.sortOrder,
    status: draft.status,
    startedAt: draft.startedAt ? new Date(draft.startedAt) : null,
    completedAt: draft.completedAt ? new Date(draft.completedAt) : null,
    priorityScore: draft.priorityScore,
    tier: draft.tier,
    reasons: draft.reasons,
    carriedFromTaskId: draft.carriedFromTaskId,
  };
}

function configFingerprint(exam: ExamRecord): string {
  return JSON.stringify([
    toIsoDate(exam.examDate),
    exam.minutesPerDay,
    [...exam.studyDays].sort(),
    exam.blockedDates.map(toIsoDate).sort(),
    exam.bufferPct,
    exam.revisionReservePct,
    exam.revisionIntervalsDays,
    exam.confidence,
  ]);
}

function configFor(exam: ExamRecord, today: string): StoredConfig {
  return {
    today,
    examDate: toIsoDate(exam.examDate),
    minutesPerDay: exam.minutesPerDay,
    studyWeekdays: [...exam.studyDays],
    blockedDates: exam.blockedDates.map(toIsoDate),
    bufferPct: exam.bufferPct,
    revisionReservePct: exam.revisionReservePct,
    revisionIntervalsDays: [...exam.revisionIntervalsDays],
    learnerConfidence: exam.confidence,
    fingerprint: configFingerprint(exam),
  };
}

function conflict(code: string, message: string): AppError {
  return new AppError(code, message, 409, 'validation');
}

export function createPlanService(deps: PlanServiceDeps) {
  const { repo } = deps;
  const clock = deps.clock ?? (() => new Date());

  async function requireExam(examId: string): Promise<ExamRecord> {
    const exam = await deps.setupRepo.findExam(examId);
    if (!exam) throw new NotFoundError(EXAM_NOT_FOUND, 'EXAM_NOT_FOUND');
    return exam;
  }

  /**
   * The planning date. The server's UTC date is authoritative; the browser may send its own local
   * date, accepted only within one day of the server's so a student near midnight still gets "their" today.
   */
  function resolveToday(requested?: string): string {
    const server = todayIso(clock());
    if (requested === undefined) return server;
    if (Math.abs(diffDaysIso(server, requested)) > 1)
      throw new ValidationError('That date is too far from today.', { code: 'INVALID_PLAN_DATE' });
    return requested;
  }

  async function loadPlanTopics(
    examId: string,
  ): Promise<{ topics: PlanTopic[]; runId: string | null }> {
    const [stored, names, run] = await Promise.all([
      deps.analysisRepo.loadResult(examId),
      repo.materialNames(examId),
      deps.analysisRepo.findCurrentResultRun(examId),
    ]);
    const topics: PlanTopic[] = [];
    let order = 0;
    for (const subject of stored) {
      for (const t of subject.topics) {
        const first = t.evidence[0];
        topics.push({
          id: t.id,
          name: t.name,
          subjectId: subject.id,
          subjectName: subject.name,
          order: order++,
          difficulty: t.difficulty,
          importance: t.importance,
          estimatedMinutes: t.estimatedMinutes,
          revisionWeight: t.revisionWeight,
          statedEmphasis: t.statedEmphasis,
          confidence: t.confidence,
          isWeak: t.isWeak,
          prerequisiteIds: t.prerequisiteIds,
          evidenceCount: t.evidence.length,
          evidence: first
            ? {
                materialName: names.get(first.materialId) ?? null,
                page: first.page,
                pageEnd: first.pageEnd,
              }
            : null,
        });
      }
    }
    return { topics, runId: run?.id ?? null };
  }

  function parseSummary(plan: PlanRecord): PlanSummary {
    const parsed = planSummarySchema.safeParse(plan.summary);
    if (!parsed.success)
      throw new AppError(
        'PLAN_CORRUPT',
        'This plan could not be read. Generate it again.',
        500,
        'unexpected',
      );
    return parsed.data;
  }

  function parseConfig(plan: PlanRecord): StoredConfig {
    const c = plan.config as Partial<StoredConfig> | null;
    if (!c || typeof c.examDate !== 'string' || !Array.isArray(c.studyWeekdays))
      throw new AppError(
        'PLAN_CORRUPT',
        'This plan could not be read. Generate it again.',
        500,
        'unexpected',
      );
    return c as StoredConfig;
  }

  function viewTask(
    task: TaskRecord,
    insights: Map<string, TopicPlanInsight>,
    today: string,
  ): StudyTaskView {
    const insight = task.topicId ? insights.get(task.topicId) : undefined;
    const date = taskIso(task.scheduledDate);
    return {
      id: task.id,
      topicId: task.topicId,
      topicName: task.topicName,
      subjectName: task.subjectName,
      type: task.type,
      revisionIndex: task.revisionIndex,
      partIndex: task.partIndex,
      partCount: task.partCount,
      date,
      originalDate: task.originalDate ? taskIso(task.originalDate) : null,
      minutes: task.plannedMinutes,
      actualMinutes: task.actualMinutes,
      status: task.status,
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      priorityScore: task.priorityScore,
      level: priorityLevelOf(task.priorityScore),
      tier: task.tier,
      reasons: task.reasons,
      prerequisites: insight?.prerequisites.map((p) => p.name) ?? [],
      evidence: insight?.evidence ?? null,
      overdue: isOpen(task.status) && date < today,
    };
  }

  function progressInputs(tasks: TaskRecord[]) {
    return tasks.map((t) => ({
      topicId: t.topicId,
      type: t.type,
      status: t.status,
      date: taskIso(t.scheduledDate),
      minutes: t.plannedMinutes,
    }));
  }

  function topicRows(summary: PlanSummary) {
    return summary.topics.map((t) => ({
      id: t.topicId,
      name: t.name,
      deferred: t.tier === 'DEFER' && t.requiredMinutes > 0,
    }));
  }

  function versionOf(p: PlanRecord): PlanVersion {
    return {
      id: p.id,
      version: p.version,
      status: p.status,
      trigger: p.trigger,
      planDate: taskIso(p.planDate),
      createdAt: p.createdAt.toISOString(),
      archivedReason: p.archivedReason,
    };
  }

  function toPlanResponse(
    exam: ExamRecord,
    current: PlanWithTasks,
    today: string,
  ): StudyPlanResponse {
    const { plan, tasks } = current;
    const summary = parseSummary(plan);
    const config = parseConfig(plan);
    const insights = new Map(summary.topics.map((t) => [t.topicId, t]));
    const { progress, topics } = computeProgress(progressInputs(tasks), topicRows(summary), today);
    const calendar = buildCalendar({ ...config, today: taskIso(plan.planDate) });
    return {
      id: plan.id,
      version: plan.version,
      trigger: plan.trigger,
      planDate: taskIso(plan.planDate),
      createdAt: plan.createdAt.toISOString(),
      examDate: config.examDate,
      daysUntilExam: Math.max(0, diffDaysIso(today, config.examDate)),
      summary,
      progress,
      topicProgress: topics,
      days: summarizeDays(calendar, progressInputs(tasks)),
      tasks: tasks.map((t) => viewTask(t, insights, today)),
      settingsChanged: config.fingerprint !== configFingerprint(exam),
    };
  }

  /** Builds the persisted plan from the planner's output. */
  function toNewPlan(args: {
    trigger: PlanTrigger;
    config: StoredConfig;
    runId: string | null;
    tasks: TaskDraft[];
    summary: PlanSummary;
    topics: PlanTopic[];
  }): NewPlan {
    const valid = new Set(args.topics.map((t) => t.id));
    const { fit } = args.summary;
    return {
      trigger: args.trigger,
      planDate: parseIsoDate(args.config.today),
      basedOnAnalysisRunId: args.runId,
      availableMinutes: fit.totalMinutes,
      requiredMinutes: fit.requiredStudyMinutes,
      scheduledMinutes: fit.plannedMinutes,
      config: args.config,
      summary: args.summary,
      tasks: args.tasks.map((t) => toNewTask(t, valid)),
    };
  }

  function translatePlanningError(error: unknown): never {
    if (error instanceof PlanningInputError)
      throw new ValidationError(error.message, { code: `PLAN_${error.code}` });
    throw error;
  }

  async function transition(
    taskId: string,
    action: 'start' | 'complete' | 'skip' | 'uncomplete',
    input: TaskActionInput,
  ): Promise<TaskActionResponse> {
    const today = resolveToday(input.planDate);
    const now = clock();
    const result = await repo.mutateTask(taskId, (task, plan): TaskPatch | null => {
      if (plan.status !== 'ACTIVE')
        throw conflict('PLAN_CHANGED', 'This plan was updated. Reload to see the current plan.');
      if (action === 'start') {
        if (task.status === 'IN_PROGRESS') return null;
        if (task.status !== 'PENDING')
          throw conflict('TASK_NOT_OPEN', 'This task is already finished or skipped.');
        return { status: 'IN_PROGRESS', startedAt: now };
      }
      if (action === 'complete') {
        if (task.status === 'COMPLETED') return null;
        if (task.status === 'SKIPPED')
          throw conflict(
            'TASK_NOT_OPEN',
            'This task was skipped. Rebalance with “include skipped” to bring it back.',
          );
        return {
          status: 'COMPLETED',
          completedAt: now,
          startedAt: task.startedAt ?? now,
          actualMinutes: input.actualMinutes ?? task.actualMinutes,
        };
      }
      if (action === 'uncomplete') {
        if (task.status !== 'COMPLETED') return null;
        return { status: 'PENDING', startedAt: null, completedAt: null, actualMinutes: null };
      }
      if (task.status === 'SKIPPED') return null;
      if (task.status === 'COMPLETED')
        throw conflict('TASK_NOT_OPEN', 'This task is already completed.');
      return { status: 'SKIPPED' };
    });
    if (!result) throw new NotFoundError('We couldn’t find that task.', 'TASK_NOT_FOUND');

    const active = await repo.findActive(result.plan.examId);
    const tasks = active?.plan.id === result.plan.id ? active.tasks : [result.task];
    const summary = parseSummary(result.plan);
    const insights = new Map(summary.topics.map((t) => [t.topicId, t]));
    const { progress } = computeProgress(progressInputs(tasks), topicRows(summary), today);
    const fresh = tasks.find((t) => t.id === result.task.id) ?? result.task;
    return { task: viewTask(fresh, insights, today), progress };
  }

  return {
    /**
     * Generates the first plan. An existing plan with no recorded progress is replaced by a new
     * version; one with progress is never replaced here (that would hide the student's history) — use rebalance.
     */
    async generate(
      examId: string,
      input: GeneratePlanInput = {},
    ): Promise<{ plan: StudyPlanResponse }> {
      const exam = await requireExam(examId);
      const today = resolveToday(input.planDate);
      const { topics, runId } = await loadPlanTopics(examId);
      if (topics.length === 0)
        throw new AppError(
          'PLAN_NO_ANALYSIS',
          'Analyze your study material first, then build a plan.',
          422,
          'validation',
        );
      if (topics.length > PLANNING_LIMITS.maxTopics)
        throw new ValidationError(`Plans hold at most ${PLANNING_LIMITS.maxTopics} topics.`, {
          code: 'PLAN_TOO_MANY_TOPICS',
        });

      const config = configFor(exam, today);
      let planned: ReturnType<typeof generatePlan>;
      try {
        planned = generatePlan({ topics, config });
      } catch (error) {
        translatePlanningError(error);
      }
      const saved = await repo.replaceActive(examId, 'REGENERATED', (current) => {
        if (current && current.tasks.some((t) => t.status !== 'PENDING'))
          throw conflict(
            'PLAN_HAS_PROGRESS',
            'You already have progress on this plan. Rebalance it instead, so nothing you finished is lost.',
          );
        return toNewPlan({
          trigger: 'GENERATE',
          config,
          runId,
          tasks: planned.tasks,
          summary: planned.summary,
          topics,
        });
      });
      return { plan: toPlanResponse(exam, saved, today) };
    },

    async getPlan(examId: string, requestedDate?: string): Promise<GetPlanResponse> {
      const exam = await requireExam(examId);
      const today = resolveToday(requestedDate);
      const [active, versions, latest] = await Promise.all([
        repo.findActive(examId),
        repo.listVersions(examId),
        repo.findLatest(examId),
      ]);
      return {
        plan: active ? toPlanResponse(exam, active, today) : null,
        today,
        staleReason:
          !active && latest?.archivedReason === 'REANALYZED'
            ? 'Your material was analyzed again, so the old plan no longer matches the topics. Generate a new one.'
            : null,
        versions: versions.map(versionOf),
      };
    },

    async getToday(examId: string, requestedDate?: string): Promise<TodayResponse> {
      const exam = await requireExam(examId);
      const today = resolveToday(requestedDate);
      const examDate = toIsoDate(exam.examDate);
      const base = {
        date: today,
        examDate,
        daysUntilExam: Math.max(0, diffDaysIso(today, examDate)),
      };
      const active = await repo.findActive(examId);
      if (!active) {
        return {
          ...base,
          hasPlan: false,
          isStudyDay: false,
          capacityMinutes: 0,
          plannedMinutes: 0,
          completedMinutes: 0,
          remainingMinutes: 0,
          tasks: [],
          overdue: [],
          overdueMinutes: 0,
          urgentRevision: 0,
          progress: null,
          warnings: [],
        };
      }
      const view = toPlanResponse(exam, active, today);
      const config = parseConfig(active.plan);
      // Today's capacity comes from the live settings, not from where the plan started.
      const calendar = buildCalendar({ ...config, today });
      const dayCapacity = calendar.find((d) => d.date === today);
      const todays = view.tasks.filter((t) => t.date === today);
      const counted = todays.filter((t) => t.status !== 'SKIPPED');
      const overdue = view.tasks.filter((t) => t.overdue);
      const sum = (list: StudyTaskView[]) => list.reduce((a, t) => a + t.minutes, 0);
      return {
        ...base,
        hasPlan: true,
        isStudyDay: dayCapacity !== undefined,
        capacityMinutes: dayCapacity?.usable ?? 0,
        plannedMinutes: sum(counted),
        completedMinutes: sum(counted.filter((t) => t.status === 'COMPLETED')),
        remainingMinutes: sum(
          counted.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS'),
        ),
        tasks: todays,
        overdue,
        overdueMinutes: sum(overdue),
        urgentRevision: view.tasks.filter(
          (t) => t.type === 'REVISION' && isOpen(t.status) && t.date <= today,
        ).length,
        progress: view.progress,
        warnings: view.summary.warnings,
      };
    },

    /** Re-plans (REPLAN) or moves only missed tasks (RECOVER). Finished work is carried into the new version untouched. */
    async rebalance(
      examId: string,
      input: Partial<RebalanceInput> = {},
    ): Promise<{ plan: StudyPlanResponse }> {
      const exam = await requireExam(examId);
      const today = resolveToday(input.planDate);
      const { topics, runId } = await loadPlanTopics(examId);
      const config = configFor(exam, today);
      const mode = input.mode ?? 'REPLAN';

      const saved = await repo.replaceActive(
        examId,
        mode === 'RECOVER' ? 'RECOVERED' : 'REBALANCED',
        (current) => {
          if (!current) throw new NotFoundError(NO_PLAN, 'PLAN_NOT_FOUND');
          const history = current.tasks.map(toHistory);
          try {
            if (mode === 'RECOVER') {
              // Recovery keeps the plan's own settings: it moves tasks, it doesn't re-decide the plan.
              const stored = parseConfig(current.plan);
              const out = recoverMissedTasks({
                tasks: history,
                topics,
                config: { ...stored, today },
              });
              if (out.report.missedTasks === 0)
                throw conflict(
                  'NOTHING_TO_RECOVER',
                  'No tasks have been missed, so there is nothing to recover.',
                );
              const prev = parseSummary(current.plan);
              const summary: PlanSummary = {
                ...prev,
                warnings: [
                  ...prev.warnings.filter(
                    (w) => w.code !== 'PLAN_OVERLOADED' && w.code !== 'RECOVERY_ORDER',
                  ),
                  ...out.warnings,
                ],
                recovery: out.report,
              };
              return toNewPlan({
                trigger: 'RECOVER_MISSED',
                config: { ...stored, today },
                runId: current.plan.basedOnAnalysisRunId,
                tasks: out.tasks,
                summary,
                topics,
              });
            }
            if (topics.length === 0)
              throw new AppError(
                'PLAN_NO_ANALYSIS',
                'Analyze your study material first, then build a plan.',
                422,
                'validation',
              );
            const out = generatePlan({
              topics,
              config,
              history,
              includeSkipped: input.includeSkipped,
            });
            return toNewPlan({
              trigger: 'REPLAN_REMAINING',
              config,
              runId,
              tasks: out.tasks,
              summary: out.summary,
              topics,
            });
          } catch (error) {
            return translatePlanningError(error);
          }
        },
      );
      return { plan: toPlanResponse(exam, saved, today) };
    },

    async startTask(taskId: string, input: TaskActionInput = {}): Promise<TaskActionResponse> {
      return transition(taskId, 'start', input);
    },
    async completeTask(taskId: string, input: TaskActionInput = {}): Promise<TaskActionResponse> {
      return transition(taskId, 'complete', input);
    },
    async skipTask(taskId: string, input: TaskActionInput = {}): Promise<TaskActionResponse> {
      return transition(taskId, 'skip', input);
    },
    async uncompleteTask(taskId: string, input: TaskActionInput = {}): Promise<TaskActionResponse> {
      return transition(taskId, 'uncomplete', input);
    },

    async getTopic(
      examId: string,
      topicId: string,
      requestedDate?: string,
    ): Promise<TopicDetailResponse> {
      const exam = await requireExam(examId);
      const today = resolveToday(requestedDate);
      const result = await deps.analysis.getResult(examId);
      let found: { topic: AnalyzedTopic; subjectName: string } | null = null;
      for (const subject of result.subjects) {
        const topic = subject.topics.find((t) => t.id === topicId);
        if (topic) found = { topic, subjectName: subject.name };
      }
      if (!found) throw new NotFoundError('We couldn’t find that topic.', 'TOPIC_NOT_FOUND');
      const active = await repo.findActive(examId);
      if (!active) {
        return {
          ...found,
          insight: null,
          progress: null,
          tasks: [],
          dependents: dependentsOf(result, topicId),
        };
      }
      const view = toPlanResponse(exam, active, today);
      return {
        ...found,
        insight: view.summary.topics.find((t) => t.topicId === topicId) ?? null,
        progress: view.topicProgress.find((t) => t.topicId === topicId) ?? null,
        tasks: view.tasks.filter((t) => t.topicId === topicId),
        dependents: dependentsOf(result, topicId),
      };
    },
  };
}

function dependentsOf(
  result: { subjects: { topics: AnalyzedTopic[] }[] },
  topicId: string,
): string[] {
  const target = result.subjects.flatMap((s) => s.topics).find((t) => t.id === topicId);
  if (!target) return [];
  return result.subjects
    .flatMap((s) => s.topics)
    .filter((t) => t.id !== topicId && t.prerequisites.includes(target.name))
    .map((t) => t.name);
}

export type PlanService = ReturnType<typeof createPlanService>;
export { addDaysIso };
