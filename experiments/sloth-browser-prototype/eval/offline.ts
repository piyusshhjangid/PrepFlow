/**
 * Model-free evaluation. Everything here runs without Ollama and is deterministic:
 *   1. the rule-based outline extractor (the baseline) scored against the gold topics;
 *   2. fault injection: scripted bad replies against the analysis pipeline;
 *   3. the evidence verifier against synthetic quotes with known correct verdicts;
 *   4. the planner against thousands of seeded random scenarios.
 * None of it measures Gemma. Run: npm run eval:offline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outlineMaterial } from '../src/ai/analyze';
import { addDays } from '../src/core/dates';
import { buildPlan, suggestAdjustment, type PlanSettings } from '../src/core/planner';
import type { Topic } from '../src/core/types';
import { FAULTS, runFault } from './faults';
import { metricsTable, pct } from './format';
import { checkPlan } from './invariants';
import { computeMetrics, mean, type Gold, type SampleMetrics } from './metrics';
import { CLASSES, runMutations } from './mutations';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')) as {
  samples: { id: string; file: string }[];
};
const gold = JSON.parse(readFileSync(join(here, 'gold.json'), 'utf8')) as {
  version: string;
  samples: Record<string, Gold>;
};
const texts = manifest.samples.map((s) => ({
  id: s.id,
  text: readFileSync(join(here, s.file), 'utf8'),
}));

// 1. Baseline
const baseline: { id: string; m: SampleMetrics }[] = [];
for (const { id, text } of texts) {
  const { topics, report } = outlineMaterial(text);
  baseline.push({ id, m: computeMetrics(topics, report, gold.samples[id]!) });
}

// 2. Fault injection
const faults = [];
for (const f of FAULTS) faults.push({ ...f, ...(await runFault(f)) });

// 3. Verifier vs synthetic quotes
const mutations = runMutations(texts.map((t) => t.text));

// 4. Planner random scenarios
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const SCENARIOS = 2000;
const planner = {
  scenarios: SCENARIOS,
  capacity: 0,
  other: 0,
  overflow: 0,
  overflowFixable: 0,
  unsuggestable: 0,
};
for (let seed = 1; seed <= SCENARIOS; seed++) {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 25);
  const topics: Topic[] = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `Topic ${i}`,
    description: '',
    effort: 'medium',
    difficulty: (1 + Math.floor(r() * 3)) as 1 | 2 | 3,
    importance: (['low', 'medium', 'high'] as const)[Math.floor(r() * 3)]!,
    prerequisites: i > 0 && r() < 0.4 ? [`t${Math.floor(r() * i)}`] : [],
    minutes: 15 + 5 * Math.floor(r() * 40),
    status: 'verified',
    evidence: null,
    weak: r() < 0.2,
    done: r() < 0.1,
    include: r() < 0.9,
    order: i,
  }));
  const s: PlanSettings = {
    today: '2026-01-05',
    examDate: addDays('2026-01-05', Math.floor(r() * 30)),
    minutesPerDay: 15 + 5 * Math.floor(r() * 40),
    sessionMinutes: 15 + 5 * Math.floor(r() * 10),
    revisionIntervals: [1 + Math.floor(r() * 3), 3 + Math.floor(r() * 5)],
  };
  const plan = buildPlan(topics, s, {});
  const v = checkPlan(topics, s, plan);
  planner.capacity += v.capacity;
  planner.other += v.other.length;
  if (plan.unscheduled.length > 0) {
    planner.overflow++;
    if (suggestAdjustment(topics, s, {}).minutesPerDayToFitAll !== null) planner.overflowFixable++;
    else planner.unsuggestable++;
  }
}

// Output
const base = {
  gold: gold.version,
  samples: texts.length,
  baselineMean: {
    recall: mean(baseline.map((b) => b.m.recall)),
    precision: mean(baseline.map((b) => b.m.precision)),
    highRecall: mean(baseline.map((b) => b.m.highRecall)),
    highPrecision: mean(baseline.map((b) => b.m.highPrecision)),
    orderAgreement: mean(baseline.map((b) => b.m.orderAgreement)),
  },
};
const mutationRows = mutations.map((m) => ({
  ...m,
  description: CLASSES.find((c) => c.id === m.id)!.description,
}));
const mutationCorrect = mutations.reduce((a, m) => a + m.correct, 0);
const mutationN = mutations.reduce((a, m) => a + m.n, 0);

const md = [
  '# Offline evaluation results (no model involved)',
  '',
  `Gold set \`${gold.version}\`; ${texts.length} sample materials. Produced by \`npm run eval:offline\`. Nothing below measures Gemma: see docs/evaluation.md for what each part does and does not show.`,
  '',
  '## 1. Rule-based outline baseline vs the gold topics',
  '',
  metricsTable(baseline),
  '',
  `Mean over samples where defined: recall ${pct(base.baselineMean.recall)}, precision ${pct(base.baselineMean.precision)}, high-importance recall ${pct(base.baselineMean.highRecall)}, high-importance precision ${pct(base.baselineMean.highPrecision)}, order agreement ${pct(base.baselineMean.orderAgreement)}.`,
  '',
  '## 2. Fault injection (scripted replies, not a model)',
  '',
  '| Scenario | Injected fault | Requirement | Observed | Result |',
  '| --- | --- | --- | --- | --- |',
  ...faults.map(
    (f) =>
      `| ${f.id} | ${f.fault} | ${f.requirement} | ${f.observed} | ${f.pass ? 'PASS' : 'FAIL'} |`,
  ),
  '',
  `${faults.filter((f) => f.pass).length}/${faults.length} scenarios behaved as required.`,
  '',
  '## 3. Evidence verifier vs synthetic quotes with known verdicts',
  '',
  '| Class | Correct verdict | Description | n | Accepted | Agreement |',
  '| --- | --- | --- | ---: | ---: | ---: |',
  ...mutationRows.map(
    (m) =>
      `| ${m.id} | ${m.expect} | ${m.description} | ${m.n} | ${m.accepted} | ${pct(m.n ? m.correct / m.n : null)} |`,
  ),
  '',
  `Overall agreement with the known verdict: ${mutationCorrect}/${mutationN} (${pct(mutationCorrect / mutationN, 1)}).`,
  '',
  '## 4. Planner invariants over seeded random scenarios',
  '',
  `${planner.scenarios} scenarios (1-25 topics, 0-29 days, 15-210 min/day, random prerequisites, weak spots, known topics). Capacity violations: ${planner.capacity}. Other rule violations: ${planner.other}. Overflowing plans: ${planner.overflow}, of which "use N minutes a day" fixes ${planner.overflowFixable} (${planner.unsuggestable} cannot be fixed within 8 h a day).`,
  '',
].join('\n');

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'offline-latest.json'),
  JSON.stringify(
    {
      node: process.version,
      ...base,
      baseline,
      faults: faults.map(({ id, fault, requirement, observed, pass }) => ({
        id,
        fault,
        requirement,
        observed,
        pass,
      })),
      mutations: mutationRows,
      planner,
    },
    null,
    2,
  ),
);
writeFileSync(join(outDir, 'offline-latest.md'), md);
console.log(md);
const bad = faults.filter((f) => !f.pass).length + planner.capacity + planner.other;
process.exit(bad ? 1 : 0);
