import type { Effort, Level, Topic } from './types';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter((t) => t.length > 1),
  );
}

/** Token-set similarity of two topic names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size < 2 || tb.size < 2) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** True when every word of the shorter name appears in the longer one ("Joins" in "Joins in SQL"). */
export function nameContains(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export const SAME_TOPIC_THRESHOLD = 0.8;

export function slug(name: string): string {
  const s = normalizeName(name).replace(/\s+/g, '-').slice(0, 60);
  return s || 'topic';
}

export function uniqueId(name: string, taken: Set<string>): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const BASE_MINUTES: Record<Effort, number> = { short: 30, medium: 60, long: 120 };
const DIFFICULTY_FACTOR: Record<1 | 2 | 3, number> = { 1: 0.85, 2: 1, 3: 1.25 };
export const MIN_TOPIC_MINUTES = 15;
export const MAX_TOPIC_MINUTES = 600;

/** The study estimate is arithmetic on two coarse model labels. It is an estimate, never a measurement. */
export function estimateMinutes(effort: Effort, difficulty: 1 | 2 | 3): number {
  const raw = BASE_MINUTES[effort] * DIFFICULTY_FACTOR[difficulty];
  return Math.min(MAX_TOPIC_MINUTES, Math.max(MIN_TOPIC_MINUTES, Math.round(raw / 5) * 5));
}

export function roundToFive(n: number): number {
  return Math.round(n / 5) * 5;
}

export function clampMinutes(n: number): number {
  const r = roundToFive(Number.isFinite(n) ? n : MIN_TOPIC_MINUTES);
  return Math.min(MAX_TOPIC_MINUTES, Math.max(MIN_TOPIC_MINUTES, r));
}

const LEVEL_RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
export const higherLevel = (a: Level, b: Level): Level => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

/**
 * Removes prerequisite edges that would form a cycle (the later-listed topic's edge is dropped first),
 * so the planner always sees a DAG. Returns how many edges were removed.
 */
export function breakCycles(topics: Topic[]): number {
  const byId = new Map(topics.map((t) => [t.id, t]));
  let removed = 0;
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (t: Topic) => {
    state.set(t.id, 1);
    for (const pid of [...t.prerequisites]) {
      const p = byId.get(pid);
      if (!p) continue;
      const s = state.get(pid) ?? 0;
      if (s === 1) {
        t.prerequisites = t.prerequisites.filter((x) => x !== pid);
        removed++;
      } else if (s === 0) visit(p);
    }
    state.set(t.id, 2);
  };
  for (const t of [...topics].sort((a, b) => a.order - b.order)) {
    if ((state.get(t.id) ?? 0) === 0) visit(t);
  }
  return removed;
}

/**
 * Marks topics the student says they already understand. `known` is free text: one name per line or comma-separated.
 * A name matches a topic if the normalized names are equal, one contains the other (3+ letters), or they are similar.
 */
export function applyKnownTopics(topics: Topic[], known: string): Topic[] {
  const names = known
    .split(/[\n,;]/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) return topics;
  return topics.map((t) => {
    const nt = normalizeName(t.name);
    const hit = names.some((n) => {
      const nn = normalizeName(n);
      if (nn.length < 3) return false;
      return nn === nt || nt.includes(nn) || nn.includes(nt) || nameSimilarity(n, t.name) >= 0.6;
    });
    return hit ? { ...t, done: true } : t;
  });
}
