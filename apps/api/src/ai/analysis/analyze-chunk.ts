import type { Difficulty, Importance, TopicOrigin } from '@prepflow/shared';
import { AiProviderFailure, type AiProvider } from '../provider.js';
import type { Chunk } from './chunker.js';
import type { RetryConfig } from './config.js';
import {
  prepareChunk,
  verifyQuote,
  type EvidenceRejection,
  type VerifiedEvidence,
} from './evidence.js';
import { parseModelOutput } from './parse.js';
import { buildRepairPrompt, buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { withRetry, type Sleep } from './retry.js';
import type { EffortClass } from './schema.js';

/** A topic that survived parsing, schema validation and evidence verification. */
export interface ValidatedTopic {
  subject: string;
  name: string;
  parent: string | null;
  summary: string;
  difficulty: Difficulty;
  importance: Importance;
  effort: EffortClass;
  revisionNeed: 'LOW' | 'MEDIUM' | 'HIGH';
  origin: TopicOrigin;
  statedEmphasis: boolean;
  confidence: number;
  prerequisites: string[];
  weakTopicMatch: string | null;
  evidence: VerifiedEvidence[];
}

export interface ChunkStats {
  retries: number;
  repairs: number;
  validationFailures: number;
  droppedTopics: number;
  droppedEvidence: Partial<Record<EvidenceRejection, number>>;
  promptTokens: number;
  completionTokens: number;
}

export type ChunkOutcome =
  | { ok: true; topics: ValidatedTopic[]; stats: ChunkStats }
  | {
      ok: false;
      code: 'AI_INVALID_OUTPUT' | 'AI_UNAVAILABLE';
      /** Provider failure code behind AI_UNAVAILABLE, e.g. AI_UNREACHABLE. */ providerCode?: string;
      stats: ChunkStats;
    };

export interface AnalyzeChunkDeps {
  provider: AiProvider;
  retry: RetryConfig;
  sleep?: Sleep;
  signal?: AbortSignal;
}

const MAX_OUTPUT_TOKENS = 4096;

/**
 * One chunk end to end: prompt → model (bounded retries) → tolerant parse → Zod → (one bounded
 * repair attempt if unusable) → evidence verification. Permanent provider failures (bad key, model
 * missing) propagate so the whole run stops instead of hammering a broken configuration.
 */
export async function analyzeChunk(
  chunk: Chunk,
  context: { weakTopicHints: readonly string[]; knownSubjects: readonly string[] },
  deps: AnalyzeChunkDeps,
): Promise<ChunkOutcome> {
  const stats: ChunkStats = {
    retries: 0,
    repairs: 0,
    validationFailures: 0,
    droppedTopics: 0,
    droppedEvidence: {},
    promptTokens: 0,
    completionTokens: 0,
  };
  const { prompt } = buildUserPrompt({ chunk, ...context });

  const call = async (user: string): Promise<string> => {
    const { value, retries } = await withRetry(
      () =>
        deps.provider.complete({
          system: SYSTEM_PROMPT,
          user,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          signal: deps.signal,
        }),
      deps.retry,
      { sleep: deps.sleep, shouldStop: () => deps.signal?.aborted === true },
    );
    stats.retries += retries;
    stats.promptTokens += value.promptTokens ?? 0;
    stats.completionTokens += value.completionTokens ?? 0;
    return value.text;
  };

  let lastProviderCode: string | undefined;
  const attempt = async (user: string) => {
    try {
      return { text: await call(user) };
    } catch (error) {
      if (error instanceof AiProviderFailure && error.kind === 'transient') {
        lastProviderCode = error.code;
        return { failed: true as const };
      }
      throw error; // permanent or unexpected: stop the run
    }
  };

  let first = await attempt(prompt);
  if ('failed' in first)
    return { ok: false, code: 'AI_UNAVAILABLE', providerCode: lastProviderCode, stats };
  let parsed = parseModelOutput(first.text);

  // One bounded repair attempt when nothing usable came back (unparseable, wrong shape, or every topic invalid).
  const unusable = (p: typeof parsed) =>
    !p.ok || (p.value.topics.length === 0 && p.value.invalidTopics > 0);
  if (unusable(parsed)) {
    stats.validationFailures += 1;
    stats.repairs += 1;
    const issues = parsed.ok ? parsed.value.issues : parsed.issues;
    const second = await attempt(buildRepairPrompt(prompt, issues));
    if ('failed' in second)
      return { ok: false, code: 'AI_UNAVAILABLE', providerCode: lastProviderCode, stats };
    first = second;
    parsed = parseModelOutput(second.text);
    if (unusable(parsed)) {
      stats.validationFailures += 1;
      return { ok: false, code: 'AI_INVALID_OUTPUT', stats };
    }
  }
  if (!parsed.ok) return { ok: false, code: 'AI_INVALID_OUTPUT', stats };

  stats.droppedTopics += parsed.value.invalidTopics;
  const source = prepareChunk(chunk);
  const topics: ValidatedTopic[] = [];
  for (const { subject, topic } of parsed.value.topics) {
    const evidence: VerifiedEvidence[] = [];
    for (const item of topic.evidence) {
      if (item.chunkId !== chunk.id) {
        stats.droppedEvidence.UNKNOWN_CHUNK = (stats.droppedEvidence.UNKNOWN_CHUNK ?? 0) + 1;
        continue;
      }
      const result = verifyQuote(chunk, source, item.quote);
      if (result.ok) evidence.push(result.evidence);
      else stats.droppedEvidence[result.reason] = (stats.droppedEvidence[result.reason] ?? 0) + 1;
    }
    if (evidence.length === 0) {
      stats.droppedTopics += 1; // no verifiable evidence → the topic does not exist as far as PrepFlow is concerned
      continue;
    }
    topics.push({
      subject,
      name: topic.name,
      parent: topic.parent?.trim() || null,
      summary: topic.summary,
      difficulty: topic.difficulty,
      importance: topic.importance,
      effort: topic.effort,
      revisionNeed: topic.revisionNeed,
      origin: topic.origin,
      statedEmphasis: topic.statedEmphasis,
      confidence: topic.confidence,
      prerequisites: topic.prerequisites,
      weakTopicMatch: topic.weakTopicMatch?.trim() || null,
      evidence,
    });
  }
  return { ok: true, topics, stats };
}
