import {
  priorityLevelOf,
  type PriorityComponents,
  type PriorityLevel,
  type PriorityReason,
} from '@prepflow/shared';
import type { PlanTopic } from './types.js';

/**
 * THE PRIORITY MODEL. Documented in docs/planning.md.
 *
 *   score = clamp( importance + emphasis + weakness + difficulty + foundation
 *                  + urgency + evidence + revision , 0, 100 )
 *
 * Every component is an integer, bounded, and computed from stored topic fields. The language model
 * supplies the classification (importance, difficulty, emphasis, prerequisites, confidence,
 * revision need); it never supplies a number that is used as a priority.
 *
 * Maximum by component: importance 24, emphasis 8, weakness 20, difficulty 12, foundation 14,
 * urgency 10, evidence 6, revision 4 = 98 (so the clamp is a safety net, not a routine event).
 */
export const PRIORITY_MODEL = {
  importance: { LOW: 0, MEDIUM: 10, HIGH: 24 },
  emphasis: 8,
  weakness: 20,
  difficulty: { EASY: 0, MEDIUM: 4, HARD: 8 },
  /** Difficulty counts for more when the student reports low confidence, and for less when high. */
  confidenceFactor: { 1: 1.5, 2: 1.25, 3: 1, 4: 0.75, 5: 0.5 } as Record<number, number>,
  foundation: { perDirectDependent: 4, perIndirectDependent: 1, max: 14 },
  /** Share of (importance + emphasis) added as the exam gets close. */
  urgencyShare: [
    { withinDays: 3, share: 0.3 },
    { withinDays: 7, share: 0.2 },
    { withinDays: 14, share: 0.1 },
  ],
  evidence: { perConfidence: 4, multiEvidenceBonus: 2 },
  revision: { perWeight: 4 },
  max: 100,
} as const;

export interface PriorityContext {
  /** Whole days from the planning date to the exam (0 when it is today or past). */
  daysUntilExam: number;
  learnerConfidence: number | null;
  /** Topics that list this one as a prerequisite. */
  directDependents: number;
  /** All topics that depend on it, directly or through others. */
  transitiveDependents: number;
}

export interface PriorityResult {
  score: number;
  level: PriorityLevel;
  components: PriorityComponents;
  /** Positive contributions only, largest first. Explanations come from here, never from a model. */
  reasons: PriorityReason[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function urgencyShare(daysUntilExam: number): number {
  for (const band of PRIORITY_MODEL.urgencyShare) {
    if (daysUntilExam <= band.withinDays) return band.share;
  }
  return 0;
}

export function computePriority(topic: PlanTopic, ctx: PriorityContext): PriorityResult {
  const m = PRIORITY_MODEL;
  const importance = m.importance[topic.importance];
  const emphasis = topic.statedEmphasis ? m.emphasis : 0;
  const weakness = topic.isWeak ? m.weakness : 0;
  const factor =
    ctx.learnerConfidence === null ? 1 : (m.confidenceFactor[ctx.learnerConfidence] ?? 1);
  const difficulty = Math.round(m.difficulty[topic.difficulty] * factor);
  const indirect = Math.max(0, ctx.transitiveDependents - ctx.directDependents);
  const foundation = Math.min(
    m.foundation.max,
    ctx.directDependents * m.foundation.perDirectDependent +
      indirect * m.foundation.perIndirectDependent,
  );
  const urgency = Math.round((importance + emphasis) * urgencyShare(ctx.daysUntilExam));
  const evidence =
    Math.round(clamp(topic.confidence, 0, 1) * m.evidence.perConfidence) +
    (topic.evidenceCount >= 2 ? m.evidence.multiEvidenceBonus : 0);
  const revision = Math.round(clamp(topic.revisionWeight, 0, 1) * m.revision.perWeight);

  const components: PriorityComponents = {
    importance,
    emphasis,
    weakness,
    difficulty,
    foundation,
    urgency,
    evidence,
    revision,
  };
  const raw = Object.values(components).reduce((a, b) => a + b, 0);
  const score = clamp(raw, 0, m.max);

  const lowConfidence = ctx.learnerConfidence !== null && ctx.learnerConfidence <= 2;
  const candidates: PriorityReason[] = [
    {
      code: 'IMPORTANCE',
      points: importance,
      text:
        topic.importance === 'HIGH'
          ? 'High importance in your material'
          : 'Medium importance in your material',
    },
    { code: 'EMPHASIS', points: emphasis, text: 'Your material stresses this topic' },
    { code: 'WEAK', points: weakness, text: 'You marked this as a weak topic' },
    {
      code: 'DIFFICULTY',
      points: difficulty,
      text:
        topic.difficulty === 'HARD'
          ? lowConfidence
            ? 'Hard topic, and your confidence is low'
            : 'Hard topic'
          : 'Moderately difficult topic',
    },
    {
      code: 'FOUNDATION',
      points: foundation,
      text:
        ctx.directDependents === 1
          ? 'Prerequisite for 1 other topic'
          : `Prerequisite for ${ctx.directDependents} other topics`,
    },
    {
      code: 'URGENCY',
      points: urgency,
      text: `Exam is ${ctx.daysUntilExam} day${ctx.daysUntilExam === 1 ? '' : 's'} away, so important topics move up`,
    },
    { code: 'EVIDENCE', points: evidence, text: 'Clearly present in your material' },
    { code: 'REVISION', points: revision, text: 'Needs more revision than most topics' },
  ];
  const reasons = candidates
    .filter((r) => r.points > 0)
    // A tiny evidence/revision contribution is noise in an explanation.
    .filter((r) => !(r.code === 'REVISION' && r.points < 3))
    .map((r, index) => ({ r, index }))
    .sort((a, b) => b.r.points - a.r.points || a.index - b.index)
    .map(({ r }) => ({ ...r, text: `${r.text} (+${r.points})` }));

  return { score, level: priorityLevelOf(score), components, reasons };
}
