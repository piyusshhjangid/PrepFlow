import { formatDay } from './dates';
import { priorityOf } from './priority';
import type { Plan, PlanSettings } from './planner';
import type { ProgressMap, Topic } from './types';
import type { AnalysisReport } from '../ai/analyze';

export interface ExportInput {
  goal: string;
  settings: PlanSettings;
  topics: Topic[];
  plan: Plan;
  progress: ProgressMap;
  /** How the topics were produced. Absent for state saved by earlier versions (treated as a model run). */
  report?: AnalysisReport | null;
}

/** One sentence, in the export itself, saying where the topics came from. Never claims more than is true. */
export function provenanceNote(report: AnalysisReport | null | undefined): string {
  const mode = report?.mode ?? 'model';
  if (mode === 'sample')
    return '**SAMPLE DATA.** These topics were written by hand to demonstrate the app. They were not produced by a model. Quote checks and scheduling in this file are real.';
  if (mode === 'outline')
    return '_Topics were found by rule-based outline reading (headings, week or section labels), with no AI. Minutes are estimates and priority is a heuristic, not a prediction._';
  const model = report?.model && report.model !== 'none' ? ` (${report.model})` : '';
  const digest = report?.modelDigest ? `, digest ${report.modelDigest}` : '';
  return `_Topics were suggested by a local language model${model}${digest} and every source quote was checked against your material. Minutes are estimates and priority is a heuristic, not a prediction._`;
}

const minutes = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
/** Keeps one-line Markdown cells and list items intact. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function exportMarkdown({
  goal,
  settings,
  topics,
  plan,
  progress,
  report,
}: ExportInput): string {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const name = (id: string) => oneLine(byId.get(id)?.name ?? id);
  const out: string[] = [];
  out.push(`# Study plan${goal.trim() ? `: ${oneLine(goal)}` : ''}`, '');
  out.push(
    `- Exam: ${formatDay(settings.examDate)} (${settings.examDate})`,
    `- Planned from: ${settings.today}`,
    `- Daily time: ${minutes(settings.minutesPerDay)}; longest session ${minutes(settings.sessionMinutes)}`,
    `- Revision: ${settings.revisionIntervals.map((d) => `+${d}d`).join(', ')} after the last study session`,
    '',
    provenanceNote(report),
    '',
  );

  out.push('## Topics', '');
  const planned = topics.filter((t) => t.include || t.done);
  if (planned.length === 0) out.push('_No topics selected._', '');
  for (const t of planned.sort((a, b) => a.order - b.order)) {
    const p = progress[t.id];
    const finished = t.done || (p ? p.studiedMinutes >= t.minutes : false);
    const prio = priorityOf(t, topics);
    out.push(
      `- [${finished ? 'x' : ' '}] **${oneLine(t.name)}** (~${minutes(t.minutes)}, ${prio.level} priority${t.done ? ', already known' : ''})`,
    );
    if (t.support === 'weak')
      out.push(
        '  - ⚠ The quote below does not mention this topic’s words; check it before trusting the topic.',
      );
    if (t.importanceCue)
      out.push(`  - Importance signal in your material: “${oneLine(t.importanceCue)}”`);
    if (t.evidence) {
      const where = t.evidence.page ? `PDF page ${t.evidence.page}` : 'your material';
      const quote = oneLine(t.evidence.quote);
      out.push(
        `  - Source (${where}): “${quote.length > 200 ? `${quote.slice(0, 197)}…` : quote}”`,
      );
    }
  }
  out.push('');

  out.push('## Schedule', '');
  const busy = plan.days.filter((d) => d.tasks.length > 0);
  if (busy.length === 0) out.push('_Nothing scheduled._', '');
  for (const d of busy) {
    out.push(`### ${formatDay(d.date)} (${minutes(d.usedMinutes)} of ${minutes(d.capacity)})`, '');
    for (const t of d.tasks) {
      const label =
        t.kind === 'revision'
          ? `Revise ${name(t.topicId)} (review ${(t.reviewIndex ?? 0) + 1})`
          : `Study ${name(t.topicId)}${t.part && t.part.total > 1 ? ` (part ${t.part.index} of ${t.part.total})` : ''}`;
      out.push(`- [ ] ${label}: ${minutes(t.minutes)}`);
    }
    out.push('');
  }

  out.push('## Does not fit', '');
  if (plan.unscheduled.length === 0 && plan.droppedRevisions.length === 0)
    out.push('_Everything fits before the exam._', '');
  for (const u of plan.unscheduled)
    out.push(`- ${name(u.topicId)}: ${minutes(u.minutes)} of study not scheduled`);
  for (const r of plan.droppedRevisions) {
    out.push(
      `- Review ${r.reviewIndex + 1} of ${name(r.topicId)}: ${r.reason === 'no-room' ? 'no room' : 'too close to the exam'}`,
    );
  }
  if (plan.unscheduled.length > 0 || plan.droppedRevisions.length > 0) out.push('');

  const held = topics.filter((t) => t.status === 'unverified');
  if (held.length > 0) {
    out.push('## Held back (no matching source passage found)', '');
    for (const t of held) out.push(`- ${oneLine(t.name)}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
