import type { Level, Topic } from './types';

export interface PriorityReason {
  label: string;
  points: number;
}

export interface Priority {
  score: number;
  level: Level;
  reasons: PriorityReason[];
}

const IMPORTANCE_POINTS: Record<Level, number> = { low: 0, medium: 10, high: 20 };
const DIFFICULTY_POINTS = { 1: 0, 2: 3, 3: 6 } as const;
const FOUNDATION_PER_DEPENDENT = 4;
const FOUNDATION_CAP = 12;
const WEAK_POINTS = 12;
export const HIGH_AT = 25;
export const MEDIUM_AT = 12;

export const PRIORITY_DISCLAIMER =
  'Priority is a simple heuristic built from the signals below. It does not predict what will be on your exam.';

/** Topics that are planned, i.e. the ones whose relationships matter. */
export const isActive = (t: Topic) => t.include && !t.done;

function directDependents(topic: Topic, topics: Topic[]): number {
  return topics.filter((t) => isActive(t) && t.prerequisites.includes(topic.id)).length;
}

export function priorityOf(topic: Topic, topics: Topic[]): Priority {
  const reasons: PriorityReason[] = [];
  const importance = IMPORTANCE_POINTS[topic.importance];
  reasons.push({ label: `${topic.importance} importance`, points: importance });
  if (topic.weak) reasons.push({ label: 'you marked it as a weak spot', points: WEAK_POINTS });
  const dependents = directDependents(topic, topics);
  if (dependents > 0) {
    reasons.push({
      label: `${dependents} other topic${dependents === 1 ? '' : 's'} build on it`,
      points: Math.min(FOUNDATION_CAP, dependents * FOUNDATION_PER_DEPENDENT),
    });
  }
  const difficulty = DIFFICULTY_POINTS[topic.difficulty];
  if (difficulty > 0) {
    reasons.push({
      label: topic.difficulty === 3 ? 'looks hard in the material' : 'moderately difficult',
      points: difficulty,
    });
  }
  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const level: Level = score >= HIGH_AT ? 'high' : score >= MEDIUM_AT ? 'medium' : 'low';
  return {
    score,
    level,
    reasons: reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points),
  };
}

/**
 * Score used for ordering: a prerequisite inherits the highest score of anything that depends on it, so it is
 * never scheduled behind the topic it unlocks.
 */
export function effectiveScores(topics: Topic[]): Map<string, number> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const own = new Map(topics.map((t) => [t.id, priorityOf(t, topics).score]));
  const memo = new Map<string, number>();
  const dependentsOf = new Map<string, string[]>();
  for (const t of topics) {
    if (!isActive(t)) continue;
    for (const p of t.prerequisites) {
      const target = byId.get(p);
      if (target && isActive(target)) dependentsOf.set(p, [...(dependentsOf.get(p) ?? []), t.id]);
    }
  }
  const visit = (id: string, seen: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return own.get(id) ?? 0;
    seen.add(id);
    let best = own.get(id) ?? 0;
    for (const d of dependentsOf.get(id) ?? []) best = Math.max(best, visit(d, seen));
    seen.delete(id);
    memo.set(id, best);
    return best;
  };
  for (const t of topics) visit(t.id, new Set());
  return memo;
}
