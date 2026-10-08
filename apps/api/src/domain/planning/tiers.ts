import type { PriorityTier } from '@prepflow/shared';
import { PLAN_TUNING } from './config.js';
import { ancestorsOf, type DependencyGraph } from './graph.js';

export interface TierAssignment {
  tiers: Map<string, PriorityTier>;
  /** Topics pulled in only because something more important depends on them. */
  includedFor: Map<string, string>;
}

/**
 * Decides what is protected when time is short.
 *
 * Topics are visited in priority order. Adding a topic also adds every prerequisite that is not
 * already included (you cannot study it without them), and the cost of the whole bundle is added
 * to a running total. The band the total lands in decides the tier:
 *
 *   total <= 50% of study capacity  -> MUST     (protected)
 *   total <= 80%                    -> SHOULD
 *   total <= 100%                   -> IF_TIME  (first to go if the plan changes)
 *   beyond                          -> DEFER    (does not fit; surfaced to the student)
 *
 * A deferred topic does not stop cheaper, lower-priority topics from fitting in what is left.
 * A topic bigger than the entire capacity is counted only up to the capacity that remains, so the
 * student still studies the part that fits (the summary reports it as deferred, with how much fits).
 * When everything fits, the bands simply describe how much of the capacity each slice uses.
 */
export function assignTiers(input: {
  /** Topic ids, highest priority first. */
  ranked: readonly string[];
  /** Study minutes still needed per topic (0 for topics already done). */
  minutes: ReadonlyMap<string, number>;
  graph: Pick<DependencyGraph, 'prerequisites'>;
  studyCapacityMinutes: number;
}): TierAssignment {
  const { ranked, minutes, graph, studyCapacityMinutes: cap } = input;
  const bands = PLAN_TUNING.tierBands;
  const tiers = new Map<string, PriorityTier>();
  const includedFor = new Map<string, string>();
  let total = 0;

  const bandFor = (value: number): PriorityTier => {
    if (value <= cap * bands.MUST) return 'MUST';
    if (value <= cap * bands.SHOULD) return 'SHOULD';
    if (value <= cap * bands.IF_TIME) return 'IF_TIME';
    return 'DEFER';
  };

  for (const id of ranked) {
    if (tiers.has(id)) continue;
    // The topic plus every prerequisite not already part of the plan.
    const members = [
      id,
      ...ancestorsOf(graph, id).filter((a) => {
        const tier = tiers.get(a);
        return tier === undefined || tier === 'DEFER';
      }),
    ];
    const cost = members.reduce((sum, m) => sum + (minutes.get(m) ?? 0), 0);
    // A bundle larger than the whole capacity can never fit, but the part that does should still be
    // studied rather than leaving the student with nothing; it is counted up to the capacity left.
    const counted = cost > cap ? Math.max(0, cap - total) : cost;
    const tier = counted === 0 && cost > 0 ? 'DEFER' : bandFor(total + counted);
    if (tier === 'DEFER') {
      tiers.set(id, 'DEFER');
      continue;
    }
    total += counted;
    for (const m of members) {
      tiers.set(m, tier);
      if (m !== id) includedFor.set(m, id);
    }
  }
  return { tiers, includedFor };
}
