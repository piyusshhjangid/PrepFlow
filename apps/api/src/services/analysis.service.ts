import { createHash } from 'node:crypto';
import type {
  AnalysisResultResponse,
  AnalysisRunSummary,
  LatestAnalysisResponse,
  ReviewTopicInput,
  StartAnalysisResponse,
} from '@prepflow/shared';
import { AppError, NotFoundError } from '../errors/index.js';
import { analyzeChunk, type ValidatedTopic } from '../ai/analysis/analyze-chunk.js';
import { chunkMaterials } from '../ai/analysis/chunker.js';
import {
  ANALYSIS_SCHEMA_VERSION,
  CHUNKER_VERSION,
  PROMPT_VERSION,
  type ChunkConfig,
  type RetryConfig,
} from '../ai/analysis/config.js';
import { normalizeWithMap } from '../ai/analysis/evidence.js';
import { mergeTopics, nameKey } from '../ai/analysis/merge.js';
import type { Sleep } from '../ai/analysis/retry.js';
import { AiProviderFailure, type AiProvider } from '../ai/provider.js';
import { logger } from '../infrastructure/logger.js';
import type {
  AnalysisMaterial,
  AnalysisRepository,
  AnalysisRunPatch,
  AnalysisRunRecord,
  ExamRecord,
  PersistedSubject,
  SetupRepository,
} from './ports.js';

export interface AnalysisServiceDeps {
  setupRepo: Pick<SetupRepository, 'findExam'>;
  repo: AnalysisRepository;
  provider: AiProvider;
  chunkConfig: ChunkConfig;
  retry: RetryConfig;
  /** Maximum analyses executing at once in this process. */
  maxConcurrent: number;
  /** Maximum analyses waiting for a slot before new requests are refused. */
  maxQueued?: number;
  /** A QUEUED/RUNNING run with no heartbeat for this long is considered interrupted. */
  staleAfterMs: number;
  clock?: () => Date;
  sleep?: Sleep;
}

const SAFE_MESSAGES: Record<string, string> = {
  AI_UNAVAILABLE:
    'The AI model could not be reached or kept failing. Please try again in a few minutes.',
  AI_INVALID_OUTPUT: 'The AI model returned output PrepFlow could not validate. Please try again.',
  AI_AUTH_FAILED:
    'The AI provider rejected the configured credentials. Check the server configuration.',
  AI_MODEL_NOT_FOUND: 'The configured AI model was not found. Check the server configuration.',
  AI_BAD_REQUEST: 'The AI provider rejected the request. Check the server configuration.',
  NO_TOPICS_FOUND:
    'No topics with verifiable evidence could be extracted from this material. Is it study content with selectable text?',
  PERSISTENCE_FAILED: 'The analysis finished but could not be saved. Please try again.',
  ANALYSIS_INTERRUPTED:
    'The analysis was interrupted (the server restarted or stopped responding). Start it again.',
  ANALYSIS_ERROR: 'The analysis failed unexpectedly. Please try again.',
};

export function toRunSummary(run: AnalysisRunRecord): AnalysisRunSummary {
  return {
    id: run.id,
    examId: run.examId,
    status: run.status,
    stage: run.stage,
    provider: run.provider,
    model: run.model,
    materialCount: run.materialCount,
    totalChunks: run.totalChunks,
    processedChunks: run.processedChunks,
    failedChunks: run.failedChunks,
    topicCount: run.topicCount,
    droppedTopics: run.droppedTopics,
    warnings: run.warnings,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    latencyMs: run.latencyMs,
  };
}

/** Everything that determines an analysis result. Same fingerprint + current result = no AI calls. */
export function computeFingerprint(input: {
  provider: string;
  model: string;
  chunkConfig: ChunkConfig;
  materials: readonly Pick<AnalysisMaterial, 'contentHash'>[];
  weakTopicHints: readonly string[];
}): string {
  const payload = JSON.stringify({
    schema: ANALYSIS_SCHEMA_VERSION,
    prompt: PROMPT_VERSION,
    chunker: CHUNKER_VERSION,
    provider: input.provider,
    model: input.model,
    chunk: [input.chunkConfig.targetChars, input.chunkConfig.maxChars],
    materials: input.materials.map((m) => m.contentHash).sort(),
    weak: input.weakTopicHints.map(nameKey).filter(Boolean).sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

const isActive = (run: AnalysisRunRecord) => run.status === 'QUEUED' || run.status === 'RUNNING';

/** Safe, user-facing description of why a run failed. Never includes provider or prompt detail. */
function failureOf(error: unknown): { code: string } {
  if (error instanceof AiProviderFailure) return { code: error.code };
  return { code: 'ANALYSIS_ERROR' };
}

/**
 * Orchestrates one analysis: load → chunk → analyze (model) → validate → merge → persist.
 * Runs in this process, in the background; HTTP requests only start it and poll its persisted state.
 */
export function createAnalysisService(deps: AnalysisServiceDeps) {
  const { repo, provider, chunkConfig, retry } = deps;
  const clock = deps.clock ?? (() => new Date());
  const maxQueued = deps.maxQueued ?? 10;

  const localRuns = new Set<string>(); // runs executing or waiting in THIS process
  const inflight = new Set<Promise<void>>();
  const waiters: (() => void)[] = [];
  let running = 0;

  async function acquireSlot(): Promise<void> {
    if (running < deps.maxConcurrent) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  function releaseSlot(): void {
    const next = waiters.shift();
    if (next)
      next(); // hand the slot over directly
    else running -= 1;
  }

  async function requireExam(examId: string): Promise<ExamRecord> {
    const exam = await deps.setupRepo.findExam(examId);
    if (!exam)
      throw new NotFoundError(
        'We couldn’t find that study setup. Start a new one to continue.',
        'EXAM_NOT_FOUND',
      );
    return exam;
  }

  /** Marks a run FAILED if it claims to be active but nothing is working on it. */
  async function reconcile(run: AnalysisRunRecord): Promise<AnalysisRunRecord> {
    if (!isActive(run) || localRuns.has(run.id)) return run;
    const last = (run.heartbeatAt ?? run.createdAt).getTime();
    if (clock().getTime() - last < deps.staleAfterMs) return run;
    await repo.updateRun(run.id, {
      status: 'FAILED',
      errorCode: 'ANALYSIS_INTERRUPTED',
      errorMessage: SAFE_MESSAGES.ANALYSIS_INTERRUPTED,
      finishedAt: clock(),
    });
    return (await repo.findRun(run.id)) ?? run;
  }

  async function execute(runId: string, examId: string): Promise<void> {
    const started = clock();
    let patch: AnalysisRunPatch = {};
    const update = async (p: AnalysisRunPatch) => {
      patch = { ...patch, ...p };
      await repo.updateRun(runId, { ...p, heartbeatAt: clock() });
    };
    const log = (message: string, fields: Record<string, unknown> = {}) =>
      logger.info(message, {
        analysisRunId: runId,
        examId,
        provider: provider.name,
        model: provider.model,
        ...fields,
      });

    try {
      await update({ status: 'RUNNING', stage: 'LOADING', startedAt: started });
      const exam = await requireExam(examId);
      const materials = await repo.loadMaterials(examId);
      if (materials.length === 0) {
        await update({
          status: 'FAILED',
          stage: null,
          errorCode: 'ANALYSIS_NO_MATERIALS',
          errorMessage: 'Add study material before analyzing.',
          finishedAt: clock(),
        });
        return;
      }

      await update({ stage: 'CHUNKING', materialCount: materials.length });
      const chunks = chunkMaterials(materials, chunkConfig);
      if (chunks.length > chunkConfig.maxChunks) {
        await update({
          status: 'FAILED',
          errorCode: 'ANALYSIS_TOO_LARGE',
          errorMessage: `This material needs ${chunks.length} AI passes, more than the limit of ${chunkConfig.maxChunks}. Remove some material and try again.`,
          finishedAt: clock(),
        });
        return;
      }
      await update({ totalChunks: chunks.length });
      log('analysis chunked', { stage: 'CHUNKING', chunkCount: chunks.length });

      // ---- ANALYZING: one model call (plus bounded retries/repair) per chunk, sequentially.
      await update({ stage: 'ANALYZING' });
      const topics: ValidatedTopic[] = [];
      const subjectNames: string[] = [];
      const warnings = new Set<string>();
      let processed = 0,
        failed = 0,
        dropped = 0,
        retries = 0,
        validationFailures = 0,
        promptTokens = 0,
        completionTokens = 0;
      let lastFailureCode: string | null = null;

      for (const chunk of chunks) {
        const outcome = await analyzeChunk(
          chunk,
          { weakTopicHints: exam.weakTopicHints, knownSubjects: [...new Set(subjectNames)] },
          { provider, retry, sleep: deps.sleep },
        );
        processed += 1;
        retries += outcome.stats.retries;
        validationFailures += outcome.stats.validationFailures;
        dropped += outcome.stats.droppedTopics;
        promptTokens += outcome.stats.promptTokens;
        completionTokens += outcome.stats.completionTokens;
        if (outcome.ok) {
          topics.push(...outcome.topics);
          subjectNames.push(...outcome.topics.map((t) => t.subject));
        } else {
          failed += 1;
          lastFailureCode = outcome.code;
          warnings.add('CHUNK_FAILED');
        }
        if (outcome.stats.droppedTopics > 0) warnings.add('TOPICS_DROPPED');
        await update({
          processedChunks: processed,
          failedChunks: failed,
          droppedTopics: dropped,
          retryCount: retries,
          validationFailures,
          promptTokens,
          completionTokens,
          warnings: [...warnings],
        });
        log('chunk analyzed', {
          stage: 'ANALYZING',
          chunkId: chunk.id,
          ok: outcome.ok,
          topics: outcome.ok ? outcome.topics.length : 0,
          retries: outcome.stats.retries,
          repairs: outcome.stats.repairs,
          droppedEvidence: outcome.stats.droppedEvidence,
        });
      }

      if (failed === chunks.length) {
        const code = lastFailureCode ?? 'AI_UNAVAILABLE';
        await update({
          status: 'FAILED',
          errorCode: code,
          errorMessage: SAFE_MESSAGES[code],
          finishedAt: clock(),
          latencyMs: clock().getTime() - started.getTime(),
        });
        return;
      }

      // ---- VALIDATING: second, independent check of every evidence snippet against the FULL material.
      await update({ stage: 'VALIDATING' });
      const { kept, removed } = verifyAgainstMaterials(topics, materials);
      dropped += removed;
      if (removed > 0) warnings.add('TOPICS_DROPPED');

      // ---- MERGING
      await update({ stage: 'MERGING', droppedTopics: dropped, warnings: [...warnings] });
      const merged = mergeTopics(kept, exam.weakTopicHints);
      const subjects: PersistedSubject[] = merged.map((subject) => ({
        name: subject.name,
        topics: subject.topics.map((t) => ({
          name: t.name,
          parent: t.parent,
          description: t.description,
          difficulty: t.difficulty,
          importance: t.importance,
          effortClass: t.effort,
          revisionWeight: t.revisionWeight,
          estimatedMinutes: t.estimatedMinutes,
          origin: t.origin,
          statedEmphasis: t.statedEmphasis,
          confidence: t.confidence,
          prerequisites: t.prerequisites,
          isWeak: t.isWeak,
          weakHint: t.weakHint,
          evidence: t.evidence,
        })),
      }));
      const topicCount = subjects.reduce((sum, s) => sum + s.topics.length, 0);
      if (topicCount === 0) {
        await update({
          status: 'FAILED',
          errorCode: 'NO_TOPICS_FOUND',
          errorMessage: SAFE_MESSAGES.NO_TOPICS_FOUND,
          finishedAt: clock(),
          latencyMs: clock().getTime() - started.getTime(),
        });
        return;
      }

      // ---- PERSISTING (single transaction: topics + final run state)
      await update({ stage: 'PERSISTING' });
      const status = failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
      try {
        await repo.saveResult(runId, examId, subjects, {
          ...patch,
          status,
          stage: 'COMPLETED',
          topicCount,
          warnings: [...warnings],
          droppedTopics: dropped,
          finishedAt: clock(),
          heartbeatAt: clock(),
          latencyMs: clock().getTime() - started.getTime(),
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        logger.error('analysis persistence failed', {
          analysisRunId: runId,
          examId,
          errorName: (error as Error).name,
        });
        await update({
          status: 'FAILED',
          errorCode: 'PERSISTENCE_FAILED',
          errorMessage: SAFE_MESSAGES.PERSISTENCE_FAILED,
          finishedAt: clock(),
        });
        return;
      }
      log('analysis finished', {
        stage: 'COMPLETED',
        status,
        chunkCount: chunks.length,
        topicCount,
        droppedTopics: dropped,
        durationMs: clock().getTime() - started.getTime(),
      });
    } catch (error) {
      const { code } = failureOf(error);
      // Only the error name/code is logged: messages can contain request details.
      logger.error('analysis failed', {
        analysisRunId: runId,
        examId,
        errorCategory: code,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      await repo
        .updateRun(runId, {
          status: 'FAILED',
          errorCode: code,
          errorMessage: SAFE_MESSAGES[code] ?? SAFE_MESSAGES.ANALYSIS_ERROR,
          finishedAt: clock(),
          latencyMs: clock().getTime() - started.getTime(),
        })
        .catch(() => undefined);
    }
  }

  function schedule(runId: string, examId: string): void {
    localRuns.add(runId);
    const task = (async () => {
      await acquireSlot();
      try {
        await execute(runId, examId);
      } finally {
        releaseSlot();
        localRuns.delete(runId);
      }
    })();
    inflight.add(task);
    void task.finally(() => inflight.delete(task));
  }

  return {
    /** Starts (or reuses, or joins) the analysis of an exam. Returns immediately. */
    async start(examId: string): Promise<StartAnalysisResponse> {
      const exam = await requireExam(examId);
      const materials = await repo.loadMaterials(examId);
      if (materials.length === 0)
        throw new AppError(
          'ANALYSIS_NO_MATERIALS',
          'Add at least one study material before analyzing.',
          422,
          'validation',
        );
      // Cheap deterministic pre-check so oversized input is refused before anything is queued.
      const chunkCount = chunkMaterials(materials, chunkConfig).length;
      if (chunkCount > chunkConfig.maxChunks)
        throw new AppError(
          'ANALYSIS_TOO_LARGE',
          `This material needs ${chunkCount} AI passes, more than the limit of ${chunkConfig.maxChunks}. Remove some material and try again.`,
          422,
          'validation',
        );

      const fingerprint = computeFingerprint({
        provider: provider.name,
        model: provider.model,
        chunkConfig,
        materials,
        weakTopicHints: exam.weakTopicHints,
      });

      const current = await repo.findCurrentResultRun(examId);
      const latest = await repo.findLatestRun(examId);
      if (
        current &&
        current.fingerprint === fingerprint &&
        latest &&
        !isActive(latest) &&
        latest.id === current.id
      ) {
        return { run: toRunSummary(current), reused: true, alreadyRunning: false };
      }
      if (waiters.length >= maxQueued)
        throw new AppError(
          'ANALYSIS_BUSY',
          'PrepFlow is busy analyzing other material. Please try again in a few minutes.',
          429,
          'infrastructure',
        );

      const { run, created } = await repo.createRunIfNoActive({
        examId,
        fingerprint,
        provider: provider.name,
        model: provider.model,
        materialCount: materials.length,
      });
      if (!created) {
        const live = await reconcile(run);
        if (isActive(live)) return { run: toRunSummary(live), reused: false, alreadyRunning: true };
        // The "active" run was a ghost from a previous process; start a fresh one.
        const retried = await repo.createRunIfNoActive({
          examId,
          fingerprint,
          provider: provider.name,
          model: provider.model,
          materialCount: materials.length,
        });
        schedule(retried.run.id, examId);
        return { run: toRunSummary(retried.run), reused: false, alreadyRunning: !retried.created };
      }
      schedule(run.id, examId);
      return { run: toRunSummary(run), reused: false, alreadyRunning: false };
    },

    async getRun(runId: string): Promise<{ run: AnalysisRunSummary }> {
      const run = await repo.findRun(runId);
      if (!run) throw new NotFoundError('We couldn’t find that analysis.', 'ANALYSIS_NOT_FOUND');
      return { run: toRunSummary(await reconcile(run)) };
    },

    async getLatest(examId: string): Promise<LatestAnalysisResponse> {
      await requireExam(examId);
      const run = await repo.findLatestRun(examId);
      return { run: run ? toRunSummary(await reconcile(run)) : null };
    },

    async getResult(examId: string): Promise<AnalysisResultResponse> {
      await requireExam(examId);
      const [run, stored, materials] = await Promise.all([
        repo.findCurrentResultRun(examId),
        repo.loadResult(examId),
        repo.loadMaterials(examId),
      ]);
      const names = new Map(materials.map((m) => [m.id, m.filename]));
      const byId = new Map(stored.flatMap((s) => s.topics).map((t) => [t.id, t.name]));
      const subjects = stored.map((subject) => ({
        id: subject.id,
        name: subject.name,
        topics: subject.topics.map((t) => ({
          id: t.id,
          name: t.name,
          parent: t.parent,
          description: t.description,
          difficulty: t.difficulty,
          importance: t.importance,
          effort: t.effortClass,
          estimatedMinutes: t.estimatedMinutes,
          revisionWeight: t.revisionWeight,
          origin: t.origin,
          statedEmphasis: t.statedEmphasis,
          confidence: t.confidence,
          isWeak: t.isWeak,
          weakHint: t.weakHint,
          prerequisites: t.prerequisiteIds
            .map((id) => byId.get(id))
            .filter((n): n is string => !!n),
          evidence: t.evidence.map((e) => ({
            materialId: e.materialId,
            materialName: names.get(e.materialId) ?? null,
            page: e.page,
            pageEnd: e.pageEnd,
            snippet: e.snippet,
          })),
        })),
      }));
      return {
        run: run ? toRunSummary(run) : null,
        subjects,
        totalEstimatedMinutes: subjects.reduce(
          (sum, s) => sum + s.topics.reduce((a, t) => a + t.estimatedMinutes, 0),
          0,
        ),
      };
    },

    async updateReviewedTopic(
      examId: string,
      topicId: string,
      patch: ReviewTopicInput,
    ): Promise<void> {
      await requireExam(examId);
      const changed = await repo.updateReviewedTopic(examId, topicId, patch);
      if (!changed) throw new NotFoundError('We couldn’t find that topic.', 'TOPIC_NOT_FOUND');
    },

    async deleteReviewedTopic(examId: string, topicId: string): Promise<void> {
      await requireExam(examId);
      const deleted = await repo.deleteReviewedTopic(examId, topicId);
      if (!deleted) throw new NotFoundError('We couldn’t find that topic.', 'TOPIC_NOT_FOUND');
    },

    /** Call once at startup: runs left QUEUED/RUNNING by a previous process can never finish. */
    async recoverInterrupted(): Promise<number> {
      const count = await repo.failActiveRuns(
        null,
        { code: 'ANALYSIS_INTERRUPTED', message: SAFE_MESSAGES.ANALYSIS_INTERRUPTED as string },
        clock(),
      );
      if (count > 0) logger.warn('marked interrupted analyses as failed', { count });
      return count;
    },

    /** Resolves when every started analysis has finished. For tests and graceful shutdown. */
    async whenIdle(): Promise<void> {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;

/**
 * Second evidence check: every kept snippet must occur in its material's FULL text (not just its
 * chunk). Topics left without evidence are removed. Deterministic and independent of the model.
 */
export function verifyAgainstMaterials(
  topics: readonly ValidatedTopic[],
  materials: readonly Pick<AnalysisMaterial, 'id' | 'extractedText' | 'sourceType'>[],
): { kept: ValidatedTopic[]; removed: number } {
  const haystacks = new Map<string, string>();
  const haystackFor = (id: string): string | undefined => {
    if (!haystacks.has(id)) {
      const material = materials.find((m) => m.id === id);
      if (!material) return undefined;
      // Pages are separated by form feeds; evidence never spans more than the joined text anyway.
      haystacks.set(
        id,
        normalizeWithMap(material.extractedText.replace(/\f/g, '\n\n'))
          .map((c) => c.ch)
          .join(''),
      );
    }
    return haystacks.get(id);
  };
  const kept: ValidatedTopic[] = [];
  let removed = 0;
  for (const topic of topics) {
    const evidence = topic.evidence.filter((e) => {
      const hay = haystackFor(e.materialId);
      const needle = normalizeWithMap(e.snippet)
        .map((c) => c.ch)
        .join('');
      return hay !== undefined && hay.includes(needle);
    });
    if (evidence.length === 0) removed += 1;
    else kept.push({ ...topic, evidence });
  }
  return { kept, removed };
}
