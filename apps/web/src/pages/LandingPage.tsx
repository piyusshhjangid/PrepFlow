import { LinkButton } from '../components/ui';
import { getExamId } from '../workspace';

const steps = [
  [
    'Tell PrepFlow your deadline',
    'Your exam date, how much time you have each day, and which topics feel hard.',
  ],
  ['Add your material', 'Paste text or upload a PDF of your syllabus and notes.'],
  [
    'Get a prioritized plan',
    'Topics are identified, ranked and scheduled to fit the time you actually have.',
  ],
  ['Study and revise', 'Follow today’s tasks, tick them off, and come back to revise on schedule.'],
] as const;

export function LandingPage() {
  const hasWorkspace = getExamId() !== null;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Turn your syllabus into a study plan you can actually follow.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          Upload your material, tell PrepFlow your deadline and available time, receive a
          prioritized plan, and track your study and revision.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/setup">{hasWorkspace ? 'Edit my setup' : 'Get started'}</LinkButton>
          {hasWorkspace && (
            <LinkButton to="/material" variant="secondary">
              Continue where I left off
            </LinkButton>
          )}
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Work in progress: setup and material upload work today; analysis and planning are being
          built next.
        </p>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="mb-4 text-lg font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {steps.map(([title, text], index) => (
            <li key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <span className="text-sm font-medium text-indigo-600">Step {index + 1}</span>
              <h3 className="mt-1 font-medium">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
