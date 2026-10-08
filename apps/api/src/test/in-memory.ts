import { randomUUID } from 'node:crypto';
import type {
  AnalysisMaterial,
  AnalysisRepository,
  AnalysisRunPatch,
  AnalysisRunRecord,
  PersistedSubject,
  StoredSubject,
  ExamPatch,
  ExamRecord,
  MaterialRecord,
  MaterialRepository,
  NewExam,
  NewMaterial,
  NewPlan,
  PlanRecord,
  PlanRepository,
  PlanWithTasks,
  TaskPatch,
  TaskRecord,
  SetupRepository,
} from '../services/ports.js';

/** In-memory fakes of the persistence ports, for service and HTTP tests. */
export class InMemorySetupRepository implements SetupRepository {
  readonly exams = new Map<string, ExamRecord>();

  async createProfileWithExam(data: NewExam): Promise<ExamRecord> {
    const record: ExamRecord = {
      id: randomUUID(),
      profileId: randomUUID(),
      nickname: data.nickname,
      name: data.name,
      examDate: data.examDate,
      minutesPerDay: data.minutesPerDay,
      studyDays: data.studyDays,
      weakTopicHints: data.weakTopicHints,
      confidence: data.confidence,
      revisionIntervalsDays: [1, 3, 7],
      revisionReservePct: 15,
      bufferPct: data.bufferPct,
      blockedDates: data.blockedDates,
    };
    this.exams.set(record.id, record);
    return record;
  }

  async findExam(examId: string): Promise<ExamRecord | null> {
    return this.exams.get(examId) ?? null;
  }

  async updateExam(examId: string, patch: ExamPatch): Promise<ExamRecord | null> {
    const current = this.exams.get(examId);
    if (!current) return null;
    const next: ExamRecord = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.examDate !== undefined) next.examDate = patch.examDate;
    if (patch.minutesPerDay !== undefined) next.minutesPerDay = patch.minutesPerDay;
    if (patch.studyDays !== undefined) next.studyDays = patch.studyDays;
    if (patch.weakTopicHints !== undefined) next.weakTopicHints = patch.weakTopicHints;
    if (patch.confidence !== undefined) next.confidence = patch.confidence;
    if (patch.bufferPct !== undefined) next.bufferPct = patch.bufferPct;
    if (patch.blockedDates !== undefined) next.blockedDates = patch.blockedDates;
    this.exams.set(examId, next);
    return next;
  }
}

export class InMemoryMaterialRepository implements MaterialRepository {
  /** Full rows including text, so tests can assert exactly what was stored. */
  readonly rows = new Map<string, NewMaterial & { id: string; createdAt: Date }>();

  private toRecord(row: NewMaterial & { id: string; createdAt: Date }): MaterialRecord {
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

  async countByExam(examId: string): Promise<number> {
    return [...this.rows.values()].filter((row) => row.examId === examId).length;
  }

  async listByExam(examId: string): Promise<MaterialRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.examId === examId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => this.toRecord(row));
  }

  async findByHash(examId: string, contentHash: string): Promise<MaterialRecord | null> {
    const row = [...this.rows.values()].find(
      (r) => r.examId === examId && r.contentHash === contentHash,
    );
    return row ? this.toRecord(row) : null;
  }

  async createIfAbsent(data: NewMaterial): Promise<{ material: MaterialRecord; created: boolean }> {
    const existing = await this.findByHash(data.examId, data.contentHash);
    if (existing) return { material: existing, created: false };
    const row = { ...data, id: randomUUID(), createdAt: new Date() };
    this.rows.set(row.id, row);
    return { material: this.toRecord(row), created: true };
  }

  async delete(materialId: string): Promise<boolean> {
    return this.rows.delete(materialId);
  }
}

// ------------------------------------------------------------------ analysis (Checkpoint C)
export class InMemoryAnalysisRepository implements AnalysisRepository {
  readonly runs = new Map<string, AnalysisRunRecord>();
  materials: AnalysisMaterial[] = [];
  subjects: PersistedSubject[] = [];
  resultRunId: string | null = null;
  /** Lets tests make saveResult fail. */
  failSave = false;
  private tick = 0;

  /** Builds materials from a material repository's stored rows. */
  constructor(private readonly materialRepo?: InMemoryMaterialRepository) {}

  async loadMaterials(examId: string): Promise<AnalysisMaterial[]> {
    if (this.materialRepo) {
      return [...this.materialRepo.rows.values()]
        .filter((row) => row.examId === examId)
        .map((row) => ({
          id: row.id,
          contentHash: row.contentHash,
          sourceType: row.sourceType,
          filename: row.filename,
          extractedText: row.extractedText,
        }));
    }
    return this.materials;
  }

  async createRunIfNoActive(data: {
    examId: string;
    fingerprint: string;
    provider: string;
    model: string;
    materialCount: number;
  }) {
    const active = [...this.runs.values()].find(
      (r) => r.examId === data.examId && (r.status === 'QUEUED' || r.status === 'RUNNING'),
    );
    if (active) return { run: { ...active }, created: false };
    const run: AnalysisRunRecord = {
      id: randomUUID(),
      examId: data.examId,
      status: 'QUEUED',
      stage: null,
      fingerprint: data.fingerprint,
      provider: data.provider,
      model: data.model,
      materialCount: data.materialCount,
      totalChunks: 0,
      processedChunks: 0,
      failedChunks: 0,
      topicCount: 0,
      droppedTopics: 0,
      warnings: [],
      startedAt: null,
      finishedAt: null,
      heartbeatAt: null,
      latencyMs: null,
      retryCount: 0,
      validationFailures: 0,
      promptTokens: null,
      completionTokens: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(Date.now() + this.tick++),
    };
    this.runs.set(run.id, run);
    return { run: { ...run }, created: true };
  }

  async updateRun(runId: string, patch: AnalysisRunPatch) {
    const run = this.runs.get(runId);
    if (!run) return null;
    Object.assign(run, patch);
    return { ...run };
  }
  async findRun(runId: string) {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }
  async findLatestRun(examId: string) {
    const list = [...this.runs.values()]
      .filter((r) => r.examId === examId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list[0] ? { ...list[0] } : null;
  }
  async findCurrentResultRun(examId: string) {
    const run = this.resultRunId ? this.runs.get(this.resultRunId) : undefined;
    return run && run.examId === examId && (run.status === 'SUCCEEDED' || run.status === 'PARTIAL')
      ? { ...run }
      : null;
  }
  async saveResult(
    runId: string,
    _examId: string,
    subjects: PersistedSubject[],
    finalPatch: AnalysisRunPatch,
  ) {
    if (this.failSave) throw new Error('simulated persistence failure');
    this.subjects = subjects;
    this.resultRunId = runId;
    Object.assign(this.runs.get(runId) as AnalysisRunRecord, finalPatch);
  }
  async loadResult(examId?: string): Promise<StoredSubject[]> {
    const owner = this.resultRunId ? this.runs.get(this.resultRunId)?.examId : undefined;
    if (examId !== undefined && owner !== undefined && owner !== examId) return [];
    // Stable UUID-shaped ids so routes that validate UUIDs can be exercised.
    const uuid = (si: number, ti: number) =>
      `00000000-0000-4000-8000-${String(si).padStart(4, '0')}${String(ti).padStart(8, '0')}`;
    return this.subjects.map((s, si) => ({
      id: uuid(si, 99999999),
      name: s.name,
      topics: s.topics.map((t, ti) => ({
        ...t,
        id: uuid(si, ti),
        subjectId: uuid(si, 99999999),
        parentId: null,
        prerequisiteIds: t.prerequisites
          .map((name) => s.topics.findIndex((x) => x.name === name))
          .filter((index) => index >= 0 && index !== ti)
          .map((index) => uuid(si, index)),
      })),
    }));
  }
  async updateReviewedTopic(
    examId: string,
    topicId: string,
    patch: { estimatedMinutes?: number; importance?: 'LOW' | 'MEDIUM' | 'HIGH'; isWeak?: boolean },
  ): Promise<boolean> {
    const owner = this.resultRunId ? this.runs.get(this.resultRunId)?.examId : undefined;
    if (owner !== examId) return false;
    for (const [si, subject] of this.subjects.entries())
      for (const [ti, topic] of subject.topics.entries())
        if (this.topicId(si, ti) === topicId) {
          Object.assign(topic, patch);
          return true;
        }
    return false;
  }
  async deleteReviewedTopic(examId: string, topicId: string): Promise<boolean> {
    const owner = this.resultRunId ? this.runs.get(this.resultRunId)?.examId : undefined;
    if (owner !== examId) return false;
    for (const [si, subject] of this.subjects.entries()) {
      const index = Number(topicId.slice(-8));
      if (this.topicId(si, index) !== topicId || !subject.topics[index]) continue;
      subject.topics.splice(index, 1);
      return true;
    }
    return false;
  }
  private topicId(si: number, ti: number) {
    return `00000000-0000-4000-8000-${String(si).padStart(4, '0')}${String(ti).padStart(8, '0')}`;
  }
  async failActiveRuns(
    olderThan: Date | null,
    error: { code: string; message: string },
    now: Date,
  ) {
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.status !== 'QUEUED' && run.status !== 'RUNNING') continue;
      if (olderThan && (run.heartbeatAt ?? run.createdAt) >= olderThan) continue;
      Object.assign(run, {
        status: 'FAILED',
        errorCode: error.code,
        errorMessage: error.message,
        finishedAt: now,
      });
      count += 1;
    }
    return count;
  }
}

// ------------------------------------------------------------------ planning (Checkpoint D)
export class InMemoryPlanRepository implements PlanRepository {
  readonly plans: PlanRecord[] = [];
  readonly tasks: TaskRecord[] = [];
  names = new Map<string, string | null>();
  /** Simulates the analysis repository archiving the plan on re-analysis. */
  archiveActive(examId: string, reason: string): void {
    for (const p of this.plans)
      if (p.examId === examId && p.status === 'ACTIVE') {
        p.status = 'ARCHIVED';
        p.archivedReason = reason;
      }
  }

  private tasksOf(planId: string): TaskRecord[] {
    return this.tasks
      .filter((t) => t.planId === planId)
      .sort(
        (a, b) =>
          a.scheduledDate.getTime() - b.scheduledDate.getTime() ||
          a.sortOrder - b.sortOrder ||
          a.id.localeCompare(b.id),
      )
      .map((t) => ({ ...t }));
  }

  async findActive(examId: string): Promise<PlanWithTasks | null> {
    const plan = this.plans.filter((p) => p.examId === examId && p.status === 'ACTIVE').at(-1);
    return plan ? { plan: { ...plan }, tasks: this.tasksOf(plan.id) } : null;
  }
  async findLatest(examId: string) {
    const plan = this.plans
      .filter((p) => p.examId === examId)
      .sort((a, b) => b.version - a.version)[0];
    return plan ? { ...plan } : null;
  }
  async listVersions(examId: string) {
    return this.plans
      .filter((p) => p.examId === examId)
      .sort((a, b) => b.version - a.version)
      .map((p) => ({ ...p }));
  }
  async materialNames() {
    return this.names;
  }
  async replaceActive(examId: string, reason: string, build: (c: PlanWithTasks | null) => NewPlan) {
    const current = await this.findActive(examId);
    const next = build(current);
    if (current) {
      const row = this.plans.find((p) => p.id === current.plan.id) as PlanRecord;
      row.status = 'ARCHIVED';
      row.archivedReason = reason;
    }
    const version =
      Math.max(0, ...this.plans.filter((p) => p.examId === examId).map((p) => p.version)) + 1;
    const plan: PlanRecord = {
      id: randomUUID(),
      examId,
      version,
      status: 'ACTIVE',
      trigger: next.trigger,
      planDate: next.planDate,
      basedOnAnalysisRunId: next.basedOnAnalysisRunId,
      availableMinutes: next.availableMinutes,
      requiredMinutes: next.requiredMinutes,
      scheduledMinutes: next.scheduledMinutes,
      config: structuredClone(next.config),
      summary: structuredClone(next.summary),
      archivedReason: null,
      createdAt: new Date(Date.now() + version),
    };
    this.plans.push(plan);
    for (const t of next.tasks) this.tasks.push({ ...t, id: randomUUID(), planId: plan.id });
    return { plan: { ...plan }, tasks: this.tasksOf(plan.id) };
  }
  async mutateTask(taskId: string, decide: (t: TaskRecord, p: PlanRecord) => TaskPatch | null) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const plan = this.plans.find((p) => p.id === task.planId) as PlanRecord;
    const patch = decide({ ...task }, { ...plan });
    if (patch) Object.assign(task, patch);
    return {
      task: { ...task },
      plan: { ...plan },
      changed: patch !== null,
      activePlan: plan.status === 'ACTIVE',
    };
  }
  async findTask(taskId: string) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    return {
      task: { ...task },
      plan: { ...(this.plans.find((p) => p.id === task.planId) as PlanRecord) },
    };
  }
}
