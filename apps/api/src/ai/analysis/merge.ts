import type { Difficulty, Importance } from '@prepflow/shared';
import type { ValidatedTopic } from './analyze-chunk.js';
import { estimateMinutes, revisionWeightFor } from './effort.js';
import type { VerifiedEvidence } from './evidence.js';
import type { EffortClass } from './schema.js';

/** Lowercase, strip accents/punctuation, collapse whitespace: the identity used to detect duplicates. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'to',
  'for',
  'on',
  'with',
  'is',
  'are',
]);
/** Minimal plural folding ("deadlocks" = "deadlock"); deliberately not a full stemmer. */
const fold = (token: string) =>
  token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
const tokens = (key: string) =>
  new Set(
    key
      .split(' ')
      .filter((t) => t && !STOPWORDS.has(t))
      .map(fold),
  );
/** nameKey with plural folding, for containment checks. */
const foldedKey = (name: string) => [...tokens(nameKey(name))].join(' ');

export function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(nameKey(a));
  const tb = tokens(nameKey(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Two topic names denote the same topic: identical keys, or very high token overlap. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b) || tokenSimilarity(a, b) >= 0.8;
}

const DIFF: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
const IMP: Importance[] = ['LOW', 'MEDIUM', 'HIGH'];
const EFFORT: EffortClass[] = ['QUICK', 'STANDARD', 'EXTENSIVE'];
const NEED = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** Index of the rounded-up mean ordinal: merging "easy" and "hard" yields "medium"-or-higher, deterministically. */
function meanOrdinal<T>(values: readonly T[], scale: readonly T[]): T {
  const mean = values.reduce((sum, v) => sum + scale.indexOf(v), 0) / values.length;
  return scale[Math.min(scale.length - 1, Math.ceil(mean - 1e-9))] as T;
}
const maxOrdinal = <T>(values: readonly T[], scale: readonly T[]): T =>
  scale[Math.max(...values.map((v) => scale.indexOf(v)))] as T;

/** Subject/topic names as the user will see them: the most frequent spelling, ties broken alphabetically. */
function canonicalName(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n.trim(), (counts.get(n.trim()) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    names[0] ??
    ''
  );
}

export interface MergedTopic {
  name: string;
  parent: string | null;
  description: string;
  difficulty: Difficulty;
  importance: Importance;
  effort: EffortClass;
  revisionWeight: number;
  estimatedMinutes: number;
  origin: 'EXTRACTED' | 'INFERRED';
  statedEmphasis: boolean;
  confidence: number;
  prerequisites: string[];
  isWeak: boolean;
  weakHint: string | null;
  evidence: VerifiedEvidence[];
}

export interface MergedSubject {
  name: string;
  topics: MergedTopic[];
}

const MAX_EVIDENCE_PER_TOPIC = 5;

/** Does `topic` match one of the student's weak hints? Model claim must be corroborated by overlap. */
export function matchWeakHint(
  topic: { name: string; weakTopicMatch: string | null },
  hints: readonly string[],
): string | null {
  const claimed = topic.weakTopicMatch
    ? hints.find((h) => nameKey(h) === nameKey(topic.weakTopicMatch ?? ''))
    : undefined;
  if (claimed && tokenSimilarity(claimed, topic.name) > 0) return claimed;
  // Deterministic check, independent of the model.
  for (const hint of hints) {
    const hk = foldedKey(hint);
    const tk = foldedKey(topic.name);
    if (
      hk.length >= 4 &&
      (tk === hk || tk.includes(hk) || tokenSimilarity(hint, topic.name) >= 0.6)
    )
      return hint;
  }
  return null;
}

/**
 * Deterministic merge of per-chunk topics (possibly from several materials) into the final set.
 * Output order does not depend on chunk completion order: everything is sorted by name key.
 */
export function mergeTopics(
  topics: readonly ValidatedTopic[],
  weakHints: readonly string[],
): MergedSubject[] {
  // 1. Group subjects (similar names fold together).
  const subjectGroups: { names: string[]; topics: ValidatedTopic[] }[] = [];
  for (const topic of [...topics].sort((a, b) =>
    nameKey(a.subject).localeCompare(nameKey(b.subject)),
  )) {
    const group = subjectGroups.find((g) => g.names.some((n) => sameName(n, topic.subject)));
    if (group) {
      group.names.push(topic.subject);
      group.topics.push(topic);
    } else subjectGroups.push({ names: [topic.subject], topics: [topic] });
  }

  const subjects: MergedSubject[] = subjectGroups.map((group) => {
    // 2. Group topics within the subject.
    const topicGroups: ValidatedTopic[][] = [];
    for (const topic of [...group.topics].sort((a, b) =>
      nameKey(a.name).localeCompare(nameKey(b.name)),
    )) {
      const found = topicGroups.find((g) => g.some((t) => sameName(t.name, topic.name)));
      if (found) found.push(topic);
      else topicGroups.push([topic]);
    }
    const merged: MergedTopic[] = topicGroups.map((g) => {
      const name = canonicalName(g.map((t) => t.name));
      const weakHint =
        g
          .map((t) => matchWeakHint({ name, weakTopicMatch: t.weakTopicMatch }, weakHints))
          .find(Boolean) ?? null;
      const isWeak = weakHint !== null;
      const difficulty = meanOrdinal(
        g.map((t) => t.difficulty),
        DIFF,
      );
      const importance = maxOrdinal(
        g.map((t) => t.importance),
        IMP,
      );
      const effort = maxOrdinal(
        g.map((t) => t.effort),
        EFFORT,
      );
      const need = maxOrdinal(
        g.map((t) => t.revisionNeed),
        NEED,
      );
      const revisionWeight = revisionWeightFor(need, isWeak);
      const seen = new Set<string>();
      const evidence: VerifiedEvidence[] = [];
      for (const e of g.flatMap((t) => t.evidence)) {
        const key = `${e.materialId}|${e.page}|${nameKey(e.snippet)}`;
        if (!seen.has(key)) {
          seen.add(key);
          evidence.push(e);
        }
      }
      evidence.sort(
        (a, b) =>
          a.materialId.localeCompare(b.materialId) ||
          (a.page ?? 0) - (b.page ?? 0) ||
          a.snippet.localeCompare(b.snippet),
      );
      const descriptions = g
        .map((t) => t.summary)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
      return {
        name,
        parent:
          g
            .map((t) => t.parent)
            .filter((p): p is string => !!p)
            .sort()[0] ?? null,
        description: descriptions[0] ?? '',
        difficulty,
        importance,
        effort,
        revisionWeight,
        estimatedMinutes: estimateMinutes({ effort, difficulty, importance, revisionWeight }),
        origin: g.some((t) => t.origin === 'EXTRACTED') ? 'EXTRACTED' : 'INFERRED',
        statedEmphasis: g.some((t) => t.statedEmphasis),
        confidence: Math.round((g.reduce((s, t) => s + t.confidence, 0) / g.length) * 100) / 100,
        prerequisites: [...new Set(g.flatMap((t) => t.prerequisites.map((p) => p.trim())))].sort(
          (a, b) => a.localeCompare(b),
        ),
        isWeak,
        weakHint,
        evidence: evidence.slice(0, MAX_EVIDENCE_PER_TOPIC),
      };
    });
    return { name: canonicalName(group.names), topics: merged };
  });

  return subjects.sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
}
