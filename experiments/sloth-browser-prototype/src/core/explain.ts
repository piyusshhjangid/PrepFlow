import { formatDay } from './dates';
import type { Plan, PlanSettings, PlanTask } from './planner';
import { priorityOf, effectiveScores, isActive } from './priority';
import { SUPPORT_TEXT } from './support';
import type { ProgressMap, Topic } from './types';

/**
 * "Why is this topic here, and why now?" as data. Every line says where it came from, because a plan mixes
 * five different kinds of statements and a student should be able to tell them apart:
 *  - material: copied from the student's own text
 *  - you:      something the student entered (exam date, daily time, flags, edits)
 *  - model:    a judgement by the language model (summary, effort, difficulty, importance suggestion)
 *  - code:     arithmetic or a rule applied by deterministic code
 *  - caveat:   an assumption or a limit that makes the line above less certain
 */
export type Source = 'material' | 'you' | 'model' | 'code' | 'caveat';

export interface ExplainLine {
  source: Source;
  text: string;
  /** A passage copied from the material, shown as a quotation. */
  quote?: string;
}

export const SOURCE_LABEL: Record<Source, string> = {
  material: 'Your material',
  you: 'You',
  model: 'Model’s guess',
  code: 'Calculated',
  caveat: 'Caveat',
};

const originName = (t: Topic) =>
  t.origin === 'outline'
    ? 'the outline rules (no AI)'
    : t.origin === 'sample'
      ? 'the hand-written sample'
      : 'the model';

const LEVEL_WORD = { low: 'low', medium: 'medium', high: 'high' } as const;

export function explainTopic(
  topic: Topic,
  topics: Topic[],
  settings: PlanSettings,
  progress: ProgressMap,
  plan: Plan | null,
): ExplainLine[] {
  const lines: ExplainLine[] = [];
  const name = (id: string) => topics.find((t) => t.id === id)?.name ?? id;

  // 1. What the material says
  if (topic.evidence) {
    lines.push({
      source: 'material',
      text: `Quoted from your material${topic.evidence.page ? ` (PDF page ${topic.evidence.page})` : ''}:`,
      quote: topic.evidence.quote,
    });
    if (topic.support) lines.push({ source: 'code', text: SUPPORT_TEXT[topic.support] });
  } else {
    lines.push({
      source: 'caveat',
      text: 'No passage in your material backs this topic, so it is not planned unless you include it.',
    });
  }
  if (topic.importanceCue) {
    lines.push({
      source: 'material',
      text: 'Wording in your material that signals importance:',
      quote: topic.importanceCue,
    });
  }

  // 2. What the model (or rule, or sample) proposed
  const proposer = originName(topic);
  if (topic.description) {
    lines.push({ source: 'model', text: `Summary written by ${proposer}: ${topic.description}` });
  }
  lines.push({
    source: topic.origin === 'outline' ? 'code' : 'model',
    text: `Effort “${topic.effort}” and difficulty ${topic.difficulty} of 3 were set by ${proposer}${
      topic.origin === 'outline' ? ' from the length of the section' : ''
    }.`,
  });
  const suggested = topic.suggestedImportance ?? topic.importance;
  if (topic.importanceBasis === 'student') {
    lines.push({
      source: 'you',
      text: `You set importance to ${LEVEL_WORD[topic.importance]}${
        suggested !== topic.importance ? ` (it was suggested as ${LEVEL_WORD[suggested]})` : ''
      }.`,
    });
  } else if (topic.importanceBasis === 'material') {
    lines.push({
      source: 'code',
      text: 'Importance is high because the material itself signals it (see the wording above).',
    });
  } else if (suggested === 'high' && topic.importance !== 'high') {
    lines.push({
      source: 'code',
      text: `${proposer} suggested high importance, but nothing in your material says so, so it was lowered to ${LEVEL_WORD[topic.importance]}. You can raise it.`,
    });
  } else {
    lines.push({
      source: topic.importanceBasis === 'model' ? 'model' : 'code',
      text: `Importance is ${LEVEL_WORD[topic.importance]}${
        topic.importanceBasis === 'default'
          ? ' by default: the material does not say how much this matters.'
          : ` as suggested by ${proposer}.`
      }`,
    });
  }
  if (topic.prerequisites.length > 0) {
    lines.push({
      source: 'model',
      text: `Suggested to understand first: ${topic.prerequisites.map(name).join(', ')}.`,
    });
  }

  // 3. What the student told us
  if (topic.weak)
    lines.push({ source: 'you', text: 'You marked this as a weak spot (+12 priority).' });
  if (topic.done)
    lines.push({ source: 'you', text: 'You said you already know this, so it is not scheduled.' });
  if (topic.autoMinutes !== undefined && topic.autoMinutes !== topic.minutes) {
    lines.push({
      source: 'you',
      text: `You changed the estimate from ${topic.autoMinutes} to ${topic.minutes} minutes.`,
    });
  } else {
    lines.push({
      source: 'code',
      text: `${topic.minutes} minutes = a base time for “${topic.effort}” effort, scaled by difficulty ${topic.difficulty}, rounded to 5. It is an estimate, not a measurement.`,
    });
  }

  // 4. How code ranked and scheduled it
  if (isActive(topic)) {
    const pr = priorityOf(topic, topics);
    lines.push({
      source: 'code',
      text: `Priority score ${pr.score} (${pr.level}): ${
        pr.reasons.map((r) => `${r.label} +${r.points}`).join(', ') || 'no signals'
      }.`,
    });
    const scores = effectiveScores(topics);
    const own = scores.get(topic.id) ?? pr.score;
    if (own > pr.score) {
      lines.push({
        source: 'code',
        text: `It is ordered as if it scored ${own}, because a topic that builds on it scores that high and a prerequisite is never scheduled after the topic it unlocks.`,
      });
    }
    if (plan) {
      const studyDays = plan.days.filter((d) =>
        d.tasks.some((t) => t.topicId === topic.id && t.kind === 'study'),
      );
      const left = plan.unscheduled.find((u) => u.topicId === topic.id);
      if (studyDays.length > 0) {
        const total = studyDays.reduce(
          (sum, d) =>
            sum + d.tasks.filter((t) => t.topicId === topic.id && t.kind === 'study').length,
          0,
        );
        lines.push({
          source: 'code',
          text: `Scheduled from ${formatDay(studyDays[0]!.date)} in ${total} session${total === 1 ? '' : 's'}, finishing ${formatDay(studyDays[studyDays.length - 1]!.date)}. Higher-priority topics are placed first, within ${settings.minutesPerDay} minutes a day and sessions of at most ${settings.sessionMinutes}.`,
        });
      }
      if (left) {
        lines.push({
          source: 'caveat',
          text: `${left.minutes} minutes of this topic do not fit before the exam at your current daily time.`,
        });
      }
    }
    const progressed = progress[topic.id]?.studiedMinutes ?? 0;
    if (progressed > 0) {
      lines.push({ source: 'you', text: `You have studied it for ${progressed} minutes so far.` });
    }
  }

  // 5. What limits the certainty
  lines.push({
    source: 'caveat',
    text: 'Priority is a simple heuristic. It does not predict what will be on your exam.',
  });
  return lines;
}

/** Explains why one task is on the plan today (the "next step" card). */
export function explainTask(
  task: PlanTask,
  topic: Topic,
  topics: Topic[],
  settings: PlanSettings,
  progress: ProgressMap,
  plan: Plan,
): ExplainLine[] {
  const lines: ExplainLine[] = [];
  const day = formatDay(task.date);
  lines.push({
    source: 'you',
    text: `Your exam is ${formatDay(settings.examDate)} and you have ${settings.minutesPerDay} minutes a day, so this plan covers ${plan.stats.studyDays} study day${plan.stats.studyDays === 1 ? '' : 's'}.`,
  });
  if (task.kind === 'revision') {
    const k = task.reviewIndex ?? 0;
    lines.push({
      source: 'code',
      text: `Review ${k + 1}: a fixed rule schedules a short review ${settings.revisionIntervals[k] ?? '?'} day(s) after the last study session of a topic (${day}). Reviews use at most 40% of a normal day so they cannot crowd out new learning.`,
    });
    lines.push({
      source: 'caveat',
      text: 'The review interval is a simple rule, not an optimised memory model.',
    });
    return lines;
  }
  const blockers = topic.prerequisites
    .map((id) => topics.find((t) => t.id === id))
    .filter((t): t is Topic => !!t && isActive(t));
  if (blockers.length > 0) {
    lines.push({
      source: 'code',
      text: `It comes after ${blockers.map((b) => b.name).join(', ')} because the model suggested those should be understood first.`,
    });
  }
  const ranked = topics
    .filter(isActive)
    .map((t) => ({ t, s: effectiveScores(topics).get(t.id) ?? 0 }))
    .sort((a, b) => b.s - a.s || a.t.order - b.t.order);
  const rank = ranked.findIndex((r) => r.t.id === topic.id) + 1;
  if (rank > 0) {
    lines.push({
      source: 'code',
      text: `It ranks ${rank} of ${ranked.length} planned topics by priority, so it is placed ${rank === 1 ? 'first' : 'early'}.`,
    });
  }
  lines.push(
    ...explainTopic(topic, topics, settings, progress, plan).filter(
      (l) => l.source === 'material' || l.source === 'caveat',
    ),
  );
  return lines;
}
