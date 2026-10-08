import { useParams, Navigate, Link } from 'react-router';
import { api } from '../api/endpoints';
import { LevelBadge, TierBadge } from '../components/PlanBits';
import { TaskRow } from '../components/TaskRow';
import { EvidenceList } from '../components/Evidence';
import { Alert, Button, Card } from '../components/ui';
import { formatMinutes, localIsoDate, titleCase } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { getExamId } from '../workspace';

export function TopicPage() {
  const examId = getExamId();
  const { topicId } = useParams();
  if (!examId) return <Navigate to="/setup" replace />;
  if (!topicId) return <Navigate to="/plan" replace />;
  return <TopicScreen examId={examId} topicId={topicId} />;
}

function TopicScreen({ examId, topicId }: { examId: string; topicId: string }) {
  const { state, reload } = useLoad(() => api.getTopic(examId, topicId, localIsoDate()));
  if (state.kind === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (state.kind === 'error')
    return (
      <Card title="We couldn’t load this topic">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <div className="flex gap-2">
          <Button onClick={() => void reload()}>Try again</Button>
          <Link to="/plan" className="self-center text-sm font-medium text-indigo-700 underline">
            Back to plan
          </Link>
        </div>
      </Card>
    );

  const { topic, subjectName, insight, progress, tasks, dependents } = state.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link to="/plan" className="font-medium text-indigo-700 underline">
            ← Plan
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{topic.name}</h1>
        <p className="text-sm text-slate-600">{subjectName}</p>
        {topic.description && <p className="mt-2 text-sm text-slate-700">{topic.description}</p>}
      </div>

      <Card title="Classification and priority">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-slate-200 px-1.5 py-0.5">
            Difficulty: {titleCase(topic.difficulty)}
          </span>
          <span className="rounded border border-slate-200 px-1.5 py-0.5">
            Importance: {titleCase(topic.importance)}
          </span>
          <span className="rounded border border-slate-200 px-1.5 py-0.5">
            ~{formatMinutes(topic.estimatedMinutes)} of study
          </span>
          {topic.isWeak && (
            <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-800">
              Weak topic
            </span>
          )}
          {insight && <LevelBadge level={insight.level} />}
          {insight && <TierBadge tier={insight.tier} />}
          {progress && (
            <span className="rounded border border-slate-200 px-1.5 py-0.5">
              Status: {titleCase(progress.status)}
            </span>
          )}
        </div>
        {insight ? (
          <>
            <p className="mt-3 text-sm text-slate-700">{insight.placement}</p>
            <h3 className="mt-3 text-sm font-semibold">
              Why this priority? (score {insight.score}/100)
            </h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {insight.reasons.map((r) => (
                <li key={r.code}>{r.text}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            This topic has no priority yet.{' '}
            <Link to="/plan" className="font-medium text-indigo-700 underline">
              Build your plan
            </Link>
            .
          </p>
        )}
      </Card>

      <Card title="Order">
        <p className="text-sm text-slate-700">
          Needs first: {topic.prerequisites.length > 0 ? topic.prerequisites.join(', ') : 'nothing'}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          Needed by: {dependents.length > 0 ? dependents.join(', ') : 'no other topic'}
        </p>
      </Card>

      <Card title="Evidence from your material">
        {topic.evidence.length > 0 ? (
          <EvidenceList evidence={topic.evidence} />
        ) : (
          <p className="text-sm text-slate-600">No quote was kept for this topic.</p>
        )}
      </Card>

      <Card title="Planned tasks">
        {progress && (
          <p className="mb-2 text-sm text-slate-600">
            Study {formatMinutes(progress.studyMinutesCompleted)} of{' '}
            {formatMinutes(progress.studyMinutesPlanned)} done · revision{' '}
            {progress.revisionsCompleted} of {progress.revisionsPlanned} done
          </p>
        )}
        {tasks.length === 0 ? (
          <Alert kind="info">Nothing is scheduled for this topic.</Alert>
        ) : (
          <ol className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} showDate />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
