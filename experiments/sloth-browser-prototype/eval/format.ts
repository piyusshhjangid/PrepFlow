import type { SampleMetrics } from './metrics';

export const pct = (v: number | null, digits = 0) =>
  v === null ? 'n/a' : `${(v * 100).toFixed(digits)}%`;

export function metricsTable(rows: { id: string; m: SampleMetrics; seconds?: number }[]): string {
  const head = [
    '| Sample | Gold found | Precision | Evidence pass | Fabricated | Weak link | First-try valid | Dup. proposals | High recall | High precision | Order agreement | Capacity viol. | Fits all |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  const body = rows.map(({ id, m }) =>
    [
      id,
      m.goldTopics === 0 ? `0 (${m.verifiedTopics} returned)` : `${m.goldFound}/${m.goldTopics}`,
      pct(m.precision),
      pct(m.evidencePassRate),
      pct(m.fabricatedRate),
      pct(m.weakSupportRate),
      pct(m.firstTryValidRate),
      pct(m.duplicateProposalRate),
      pct(m.highRecall),
      pct(m.highPrecision),
      pct(m.orderAgreement),
      String(m.scenarios.capacityViolations),
      `${m.scenarios.fitsAll}/${m.scenarios.scenarios}`,
    ].join(' | '),
  );
  return [...head, ...body.map((r) => `| ${r} |`)].join('\n');
}
