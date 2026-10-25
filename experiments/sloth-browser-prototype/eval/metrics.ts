import type { AnalysisReport } from '../src/ai/analyze';
import { addDays } from '../src/core/dates';
import { buildPlan, suggestAdjustment, type PlanSettings } from '../src/core/planner';
import { nameSimilarity } from '../src/core/topics';
import type { Topic } from '../src/core/types';
import { checkPlan } from './invariants';

export interface GoldTopic {
  id: string;
  match: string;
  high?: boolean;
  ambiguous?: boolean;
}
export interface Gold {
  topics: GoldTopic[];
  referenceOrder: string[];
}

/** Share helpers: null means "not defined for this sample" (never silently 0 or 1). */
const share = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export interface ScenarioSummary {
  scenarios: number;
  capacityViolations: number;
  otherViolations: number;
  /** Scenarios where every planned minute was scheduled before the exam. */
  fitsAll: number;
  overflow: number;
  /** Overflowing scenarios for which "use N minutes a day" would fit everything. */
  overflowFixable: number;
}

export interface SampleMetrics {
  goldTopics: number;
  goldFound: number;
  /** goldFound / goldTopics. */
  recall: number | null;
  verifiedTopics: number;
  /** Verified topics that match some gold topic / verified topics. */
  precision: number | null;
  candidates: number;
  /** Verified / candidate topics, before merging duplicates. */
  evidencePassRate: number | null;
  /** Candidates whose quote was not found in the material (fabricated or altered). */
  fabricatedRate: number | null;
  /** Verified topics whose quote does not mention the topic (flagged, not dropped). */
  weakSupportRate: number | null;
  /** Chunks answered correctly on the first try / chunks. Null for non-model runs. */
  firstTryValidRate: number | null;
  /** Duplicates the model proposed (merged by code) / candidates. */
  duplicateProposalRate: number | null;
  /** Pairs of final topics that are still near-duplicates by name. */
  residualDuplicatePairs: number;
  /** Of gold topics the material marks as high importance that were found: share the app marked high. */
  highRecall: number | null;
  /** Of topics the app marked high (excluding contradictory ones): share that the material really marks high. */
  highPrecision: number | null;
  /** Pairwise order agreement with the reference order, over found gold topics. */
  orderAgreement: number | null;
  scenarios: ScenarioSummary;
}

const matcher = (g: GoldTopic) => new RegExp(g.match, 'i');

export function matchGold(topics: Topic[], gold: Gold): Map<string, Topic> {
  const found = new Map<string, Topic>();
  const verified = topics.filter((t) => t.status === 'verified');
  for (const g of gold.topics) {
    const hit = verified.find((t) => matcher(g).test(t.name));
    if (hit) found.set(g.id, hit);
  }
  return found;
}

export const SCENARIO_DAYS = [3, 7, 14];
export const SCENARIO_MINUTES = [30, 60, 120];
const TODAY = '2026-01-05';

export function scenarioSettings(days: number, minutesPerDay: number): PlanSettings {
  return {
    today: TODAY,
    examDate: addDays(TODAY, days),
    minutesPerDay,
    sessionMinutes: 45,
    revisionIntervals: [1, 3],
  };
}

export function summarizeScenarios(topics: Topic[]): ScenarioSummary {
  const out: ScenarioSummary = {
    scenarios: 0,
    capacityViolations: 0,
    otherViolations: 0,
    fitsAll: 0,
    overflow: 0,
    overflowFixable: 0,
  };
  for (const days of SCENARIO_DAYS)
    for (const minutes of SCENARIO_MINUTES) {
      const s = scenarioSettings(days, minutes);
      const plan = buildPlan(topics, s, {});
      const v = checkPlan(topics, s, plan);
      out.scenarios++;
      out.capacityViolations += v.capacity;
      out.otherViolations += v.other.length;
      if (plan.unscheduled.length === 0) out.fitsAll++;
      else {
        out.overflow++;
        if (suggestAdjustment(topics, s, {}).minutesPerDayToFitAll !== null) out.overflowFixable++;
      }
    }
  return out;
}

/** Order in which the app would start studying the found gold topics (roomy scenario), compared pairwise with the reference. */
function orderAgreement(topics: Topic[], found: Map<string, Topic>, gold: Gold): number | null {
  const ids = gold.referenceOrder.filter((id) => found.has(id));
  if (ids.length < 2) return null;
  const plan = buildPlan(topics, scenarioSettings(14, 120), {});
  const first = new Map<string, number>();
  plan.days
    .flatMap((d) => d.tasks)
    .filter((t) => t.kind === 'study')
    .forEach((t, i) => first.has(t.topicId) || first.set(t.topicId, i));
  let agree = 0;
  let total = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = first.get(found.get(ids[i]!)!.id);
      const b = first.get(found.get(ids[j]!)!.id);
      if (a === undefined || b === undefined) continue;
      total++;
      if (a < b) agree++;
    }
  return share(agree, total);
}

export function computeMetrics(topics: Topic[], report: AnalysisReport, gold: Gold): SampleMetrics {
  const found = matchGold(topics, gold);
  const verified = topics.filter((t) => t.status === 'verified');
  const anyGold = (t: Topic) => gold.topics.some((g) => matcher(g).test(t.name));
  const highGoldFound = gold.topics.filter((g) => g.high && found.has(g.id));
  const highApp = verified.filter((t) => t.importance === 'high');
  const ambiguousIds = new Set(
    gold.topics.filter((g) => g.ambiguous && found.has(g.id)).map((g) => found.get(g.id)!.id),
  );
  const highScored = highApp.filter((t) => !ambiguousIds.has(t.id));
  const highCorrect = highScored.filter((t) =>
    gold.topics.some((g) => g.high && matcher(g).test(t.name)),
  );
  let residual = 0;
  for (let i = 0; i < verified.length; i++)
    for (let j = i + 1; j < verified.length; j++)
      if (nameSimilarity(verified[i]!.name, verified[j]!.name) >= 0.6) residual++;
  const mode = report.mode ?? 'model';
  const firstTry = report.chunks - report.repairs - report.chunkFailures.length;
  return {
    goldTopics: gold.topics.length,
    goldFound: found.size,
    recall: share(found.size, gold.topics.length),
    verifiedTopics: verified.length,
    precision: share(verified.filter(anyGold).length, verified.length),
    candidates: report.candidateTopics,
    evidencePassRate: share(
      report.candidateTopics - (report.candidatesUnverified ?? 0),
      report.candidateTopics,
    ),
    fabricatedRate: share(report.candidatesUnverified ?? 0, report.candidateTopics),
    weakSupportRate: share(report.weakSupport ?? 0, verified.length),
    firstTryValidRate: mode === 'model' ? share(firstTry, report.chunks) : null,
    duplicateProposalRate: share(report.duplicatesMerged, report.candidateTopics),
    residualDuplicatePairs: residual,
    highRecall: share(
      highGoldFound.filter((g) => found.get(g.id)!.importance === 'high').length,
      highGoldFound.length,
    ),
    highPrecision: share(highCorrect.length, highScored.length),
    orderAgreement: orderAgreement(topics, found, gold),
    scenarios: summarizeScenarios(topics.filter((t) => t.status === 'verified')),
  };
}

/** Mean of the defined values (null entries are skipped, not counted as zero); null if none are defined. */
export function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}
