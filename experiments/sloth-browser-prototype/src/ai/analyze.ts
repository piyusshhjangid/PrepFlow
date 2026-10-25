import {
  EVIDENCE_FAILURE_TEXT,
  normalizeWithMap,
  verifyQuote,
  type EvidenceFailure,
} from '../core/evidence';
import {
  SAME_TOPIC_THRESHOLD,
  breakCycles,
  estimateMinutes,
  higherLevel,
  nameContains,
  nameSimilarity,
  normalizeName,
  uniqueId,
} from '../core/topics';
import { extractOutline } from '../core/outline';
import { decideImportance, supportOf } from '../core/support';
import type { Evidence, Origin, Topic } from '../core/types';
import { chunkText, MAX_CHUNKS, validateMaterial } from './chunk';
import { AiError, isAiError, type AiErrorCode } from './errors';
import { extractJsonObject, salvageTopicObjects } from './json';
import {
  promptFingerprint,
  randomNonce,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  userPrompt,
} from './prompts';
import type { AiProvider } from './provider';
import { RawTopicSchema, ResponseShape, TOPICS_JSON_SCHEMA, type RawTopic } from './schema';

export interface AnalysisProgress {
  phase: 'chunking' | 'analyzing' | 'verifying';
  chunk: number;
  chunks: number;
}

export interface AnalysisReport {
  /** Optional so reports saved by earlier versions still load. Absent means a model run. */
  mode?: Origin;
  provider: string;
  model: string;
  /** Identifies the exact prompt and output schema used, so a run can be reproduced. */
  promptVersion?: string;
  promptHash?: string;
  /** Generation settings the provider reported (temperature, seed, context size…). */
  providerSettings?: Record<string, string | number | boolean>;
  /** Digest of the installed model, when the runtime reported one. */
  modelDigest?: string;
  /** Topics recovered one by one from a reply that was cut off or not valid JSON as a whole. */
  salvagedTopics?: number;
  /** Candidate topics (before merging duplicates) whose quote was not found in the material. */
  candidatesUnverified?: number;
  /** Verified topics whose quote does not use the topic's words (see core/support.ts). */
  weakSupport?: number;
  /** Times the model said "high" importance and the material did not back it up. */
  importanceDowngrades?: number;
  inputChars: number;
  chunks: number;
  chunkFailures: { chunk: number; code: AiErrorCode }[];
  candidateTopics: number;
  invalidTopics: number;
  verifiedTopics: number;
  unverifiedTopics: number;
  unverifiedReasons: Partial<Record<EvidenceFailure, number>>;
  duplicatesMerged: number;
  unresolvedPrerequisites: number;
  cyclesBroken: number;
  repairs: number;
  retries: number;
  durationMs: number;
}

export interface AnalysisResult {
  topics: Topic[];
  report: AnalysisReport;
}

export interface AnalyzeOptions {
  text: string;
  goal: string;
  provider: AiProvider;
  signal?: AbortSignal;
  onProgress?: (p: AnalysisProgress) => void;
  /** Attempts per request for transient failures (timeout, server error, unreachable). Bounded: never retries forever. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  nonce?: () => string;
  now?: () => number;
  /** Digest of the installed model if the runtime reported one; recorded in the report. */
  modelDigest?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ChunkOutcome {
  topics: RawTopic[];
  invalid: number;
  repaired: boolean;
  retries: number;
  salvaged: number;
}

export async function analyzeMaterial(options: AnalyzeOptions): Promise<AnalysisResult> {
  const { text, goal, provider, signal, onProgress } = options;
  const now = options.now ?? Date.now;
  const started = now();
  const problem = validateMaterial(text);
  if (problem) throw new RangeError(problem);

  onProgress?.({ phase: 'chunking', chunk: 0, chunks: 0 });
  const chunks = chunkText(text);
  if (chunks.length > MAX_CHUNKS) {
    throw new RangeError(
      'That material is too long to analyze in one go. Keep only the chapters you need.',
    );
  }

  const report: AnalysisReport = {
    ...emptyReport('model', provider.id, provider.model, text.length),
    chunks: chunks.length,
    promptVersion: PROMPT_VERSION,
    promptHash: promptFingerprint(),
    salvagedTopics: 0,
    ...(options.modelDigest ? { modelDigest: options.modelDigest } : {}),
    ...(provider.settings ? { providerSettings: provider.settings() } : {}),
  };

  const candidates: RawTopic[] = [];
  let lastError: AiError | undefined;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new AiError('ABORTED');
    onProgress?.({ phase: 'analyzing', chunk: i + 1, chunks: chunks.length });
    try {
      const outcome = await analyzeChunk(chunks[i]!, goal, options);
      candidates.push(...outcome.topics);
      report.invalidTopics += outcome.invalid;
      report.retries += outcome.retries;
      if (outcome.repaired) report.repairs++;
      report.salvagedTopics = (report.salvagedTopics ?? 0) + outcome.salvaged;
    } catch (error) {
      if (!isAiError(error)) throw error;
      // Wrong model, bad request or cancellation will fail every chunk the same way: stop at once.
      if (
        error.code === 'MODEL_NOT_FOUND' ||
        error.code === 'BAD_REQUEST' ||
        error.code === 'ABORTED'
      )
        throw error;
      lastError = error;
      report.chunkFailures.push({ chunk: i + 1, code: error.code });
    }
  }
  if (report.chunkFailures.length === chunks.length) {
    throw new AiError('ANALYSIS_FAILED', lastError ? `${lastError.message}` : undefined);
  }

  onProgress?.({ phase: 'verifying', chunk: chunks.length, chunks: chunks.length });
  const topics = finalizeCandidates({ text, candidates, report, origin: 'model' });
  report.durationMs = now() - started;
  return { topics, report };
}

export interface FinalizeInput {
  text: string;
  candidates: RawTopic[];
  report: AnalysisReport;
  origin: Origin;
}

/**
 * Everything that happens after proposals exist, whoever proposed them (a model, the outline rules or the
 * hand-written sample): every quote is checked against the source, duplicates merged, importance checked
 * against the material, quote support measured, prerequisites resolved and cycles removed.
 * Mutates the counters in `report`.
 */
export function finalizeCandidates({ text, candidates, report, origin }: FinalizeInput): Topic[] {
  report.candidateTopics = candidates.length;
  report.candidatesUnverified = 0;
  const prepared = normalizeWithMap(text);

  interface Candidate {
    raw: RawTopic;
    evidence: Evidence | null;
    reason?: EvidenceFailure;
    prerequisiteNames: string[];
  }
  const merged: Candidate[] = [];
  for (const raw of candidates) {
    const check = verifyQuote(raw.evidence, text, prepared);
    if (!check.ok) report.candidatesUnverified = (report.candidatesUnverified ?? 0) + 1;
    const candidate: Candidate = check.ok
      ? { raw, evidence: check.evidence, prerequisiteNames: raw.prerequisites }
      : { raw, evidence: null, reason: check.reason, prerequisiteNames: raw.prerequisites };
    const twin = merged.find(
      (m) =>
        nameSimilarity(m.raw.name, raw.name) >= SAME_TOPIC_THRESHOLD ||
        // Same passage and one name contains the other ("Joins" / "Joins in SQL"): the same topic.
        (m.evidence !== null &&
          candidate.evidence !== null &&
          m.evidence.start === candidate.evidence.start &&
          nameContains(m.raw.name, raw.name)),
    );
    if (twin) {
      report.duplicatesMerged++;
      if (!twin.evidence && candidate.evidence) {
        twin.evidence = candidate.evidence;
        delete twin.reason;
      }
      twin.raw = { ...twin.raw, importance: higherLevel(twin.raw.importance, raw.importance) };
      twin.prerequisiteNames = [...new Set([...twin.prerequisiteNames, ...raw.prerequisites])];
    } else merged.push(candidate);
  }

  const taken = new Set<string>();
  report.weakSupport = 0;
  report.importanceDowngrades = 0;
  const topics: Topic[] = merged.map((m, order) => {
    const verified = m.evidence !== null;
    if (!verified && m.reason) {
      report.unverifiedReasons[m.reason] = (report.unverifiedReasons[m.reason] ?? 0) + 1;
    }
    const difficulty = m.raw.difficulty as 1 | 2 | 3;
    const minutes = estimateMinutes(m.raw.effort, difficulty);
    const base = {
      id: uniqueId(m.raw.name, taken),
      name: m.raw.name,
      description: m.raw.description,
      effort: m.raw.effort,
      difficulty,
      prerequisites: [] as string[],
      minutes,
      autoMinutes: minutes,
      origin,
      suggestedImportance: m.raw.importance,
      weak: false,
      done: false,
      include: verified,
      order,
    };
    if (!m.evidence) {
      return {
        ...base,
        importance: m.raw.importance,
        importanceBasis: 'model' as const,
        status: 'unverified' as const,
        ...(m.reason ? { unverifiedReason: m.reason } : {}),
        evidence: null,
      };
    }
    const support = supportOf(m.raw.name, m.evidence.quote, text, m.evidence.start, m.evidence.end);
    if (support === 'weak') report.weakSupport = (report.weakSupport ?? 0) + 1;
    const importance = decideImportance(
      m.raw.importance,
      text,
      m.evidence.start,
      m.evidence.end,
      m.raw.name,
    );
    if (importance.downgraded) report.importanceDowngrades = (report.importanceDowngrades ?? 0) + 1;
    return {
      ...base,
      importance: importance.level,
      importanceBasis: importance.basis,
      ...(importance.cue ? { importanceCue: importance.cue } : {}),
      status: 'verified' as const,
      evidence: m.evidence,
      support,
    };
  });
  report.verifiedTopics = topics.filter((t) => t.status === 'verified').length;
  report.unverifiedTopics = topics.length - report.verifiedTopics;

  merged.forEach((m, i) => {
    const self = topics[i]!;
    const ids = new Set<string>();
    for (const name of m.prerequisiteNames) {
      const target = topics.find(
        (t) =>
          normalizeName(t.name) === normalizeName(name) ||
          nameSimilarity(t.name, name) >= SAME_TOPIC_THRESHOLD,
      );
      if (!target || target.id === self.id) report.unresolvedPrerequisites++;
      else ids.add(target.id);
    }
    self.prerequisites = [...ids];
  });
  report.cyclesBroken = breakCycles(topics);
  return topics;
}

/** A report with every counter at zero, for a run that is not a model run (outline, sample). */
export function emptyReport(
  mode: Origin,
  provider: string,
  model: string,
  inputChars: number,
): AnalysisReport {
  return {
    mode,
    provider,
    model,
    inputChars,
    chunks: 0,
    chunkFailures: [],
    candidateTopics: 0,
    invalidTopics: 0,
    verifiedTopics: 0,
    unverifiedTopics: 0,
    unverifiedReasons: {},
    duplicatesMerged: 0,
    unresolvedPrerequisites: 0,
    cyclesBroken: 0,
    repairs: 0,
    retries: 0,
    durationMs: 0,
  };
}

/**
 * Outline mode: topics from plain rules, no model. It goes through the same verification as model output
 * and is labelled `outline` everywhere it is shown or exported.
 */
export function outlineMaterial(text: string, now: () => number = Date.now): AnalysisResult {
  const started = now();
  const problem = validateMaterial(text);
  if (problem) throw new RangeError(problem);
  const report = emptyReport('outline', 'outline-rules', 'none (rule-based)', text.length);
  const topics = finalizeCandidates({
    text,
    candidates: extractOutline(text),
    report,
    origin: 'outline',
  });
  report.durationMs = now() - started;
  return { topics, report };
}

async function analyzeChunk(
  chunk: string,
  goal: string,
  options: AnalyzeOptions,
): Promise<ChunkOutcome> {
  const { provider, signal } = options;
  const attempts = Math.max(1, options.maxAttempts ?? 2);
  const sleep = options.sleep ?? defaultSleep;
  const nonce = (options.nonce ?? randomNonce)();
  let retries = 0;

  const ask = async (repairReason?: string): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.generate({
          system: SYSTEM_PROMPT,
          user: userPrompt(goal, chunk, nonce, repairReason),
          schema: TOPICS_JSON_SCHEMA as unknown as Record<string, unknown>,
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (!isAiError(error) || !error.retryable || attempt >= attempts) throw error;
        retries++;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  };

  const parse = (
    reply: string,
  ): { topics: RawTopic[]; invalid: number; salvaged: number } | null => {
    let items: unknown[] | null = null;
    let salvaged = 0;
    const shape = ResponseShape.safeParse(extractJsonObject(reply));
    if (shape.success) items = shape.data.topics;
    else {
      // A reply cut off by the length limit, or broken after a few good topics: keep the complete ones.
      const rescued = salvageTopicObjects(reply);
      if (rescued.length > 0) {
        items = rescued;
        salvaged = rescued.length;
      }
    }
    if (!items) return null;
    const topics: RawTopic[] = [];
    let invalid = 0;
    for (const item of items) {
      const parsed = RawTopicSchema.safeParse(item);
      if (parsed.success) topics.push(parsed.data);
      else invalid++;
    }
    return { topics, invalid, salvaged: topics.length > 0 ? salvaged : 0 };
  };

  const first = parse(await ask());
  if (first && first.topics.length > 0) return { ...first, repaired: false, retries };
  // One repair attempt with a code-written reason (never the model's own output), then give up on this chunk.
  const second = parse(
    await ask(
      first ? 'it contained no valid topics' : 'it was not valid JSON in the required shape',
    ),
  );
  if (second && second.topics.length > 0) {
    return {
      topics: second.topics,
      invalid: (first?.invalid ?? 0) + second.invalid,
      repaired: true,
      retries,
      salvaged: second.salvaged,
    };
  }
  if (second || first) {
    // The model answered validly but found nothing usable in this chunk: not an error.
    return {
      topics: [],
      invalid: (first?.invalid ?? 0) + (second?.invalid ?? 0),
      repaired: true,
      retries,
      salvaged: 0,
    };
  }
  throw new AiError('INVALID_OUTPUT');
}

export const REASON_TEXT = EVIDENCE_FAILURE_TEXT;
