import type { Difficulty, Importance } from '@prepflow/shared';
import type { EffortClass } from './schema.js';

/**
 * Deterministic effort estimation. The model only CLASSIFIES (effort class, difficulty,
 * importance, revision need); the minutes are computed here, so they can never be invented.
 */
export const BASE_MINUTES: Record<EffortClass, number> = { QUICK: 20, STANDARD: 45, EXTENSIVE: 90 };
export const DIFFICULTY_FACTOR: Record<Difficulty, number> = { EASY: 0.8, MEDIUM: 1, HARD: 1.3 };
export const IMPORTANCE_FACTOR: Record<Importance, number> = { LOW: 0.9, MEDIUM: 1, HIGH: 1.15 };
export const REVISION_WEIGHT: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.8,
};
/** Time added per unit of revision weight (a topic needing a lot of revision costs a bit more first time). */
const REVISION_TIME_FACTOR = 0.2;
export const MIN_TOPIC_MINUTES = 10;
export const MAX_TOPIC_MINUTES = 240;

export function revisionWeightFor(need: 'LOW' | 'MEDIUM' | 'HIGH', isWeak: boolean): number {
  return Math.round(Math.min(1, REVISION_WEIGHT[need] + (isWeak ? 0.15 : 0)) * 100) / 100;
}

export function estimateMinutes(input: {
  effort: EffortClass;
  difficulty: Difficulty;
  importance: Importance;
  revisionWeight: number;
}): number {
  const raw =
    BASE_MINUTES[input.effort] *
    DIFFICULTY_FACTOR[input.difficulty] *
    IMPORTANCE_FACTOR[input.importance] *
    (1 + REVISION_TIME_FACTOR * input.revisionWeight);
  const rounded = Math.round(raw / 5) * 5;
  return Math.min(MAX_TOPIC_MINUTES, Math.max(MIN_TOPIC_MINUTES, rounded));
}
