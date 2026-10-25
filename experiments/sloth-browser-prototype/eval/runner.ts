import type { AiProvider } from '../src/ai/provider';
import { analyzeMaterial, type AnalysisReport } from '../src/ai/analyze';
import { isAiError } from '../src/ai/errors';
import type { Topic } from '../src/core/types';

export interface Sample {
  id: string;
  kind: string;
  text: string;
  expectedKeywords: string[];
  expectedTopicRange: [number, number];
}

export interface SampleResult {
  id: string;
  kind: string;
  inputChars: number;
  ok: boolean;
  /** Set when the run failed (the fixed error code, never provider text). */
  errorCode?: string;
  seconds: number;
  report?: AnalysisReport;
  /** Every topic returned (verified and held back), for metrics and qualitative review. */
  topics?: Topic[];
  topicNames: string[];
  /** Expected keywords found in the verified topic names or descriptions. */
  keywordHits: string[];
  keywordMisses: string[];
  /** Verified topics outside the sample's expected count range (a rough sanity check). */
  topicCountInRange: boolean;
  /** Share of returned topics whose quote was found in the material; null when there were no topics. */
  verifiedShare: number | null;
}

/** Runs each sample through the real analysis pipeline with the given provider and records what happened. */
export async function runEval(
  provider: AiProvider,
  samples: Sample[],
  now: () => number = Date.now,
  onSample?: (r: SampleResult) => void,
  options: { modelDigest?: string } = {},
): Promise<SampleResult[]> {
  const results: SampleResult[] = [];
  for (const s of samples) {
    const started = now();
    let result: SampleResult;
    try {
      const { topics, report } = await analyzeMaterial({
        text: s.text,
        goal: s.kind,
        provider,
        now,
        ...(options.modelDigest ? { modelDigest: options.modelDigest } : {}),
      });
      const verified = topics.filter((t) => t.status === 'verified');
      const haystack = verified.map((t) => `${t.name} ${t.description}`.toLowerCase()).join('\n');
      const hits = s.expectedKeywords.filter((k) => new RegExp(k, 'i').test(haystack));
      result = {
        id: s.id,
        kind: s.kind,
        inputChars: s.text.length,
        ok: true,
        seconds: (now() - started) / 1000,
        report,
        topics,
        topicNames: verified.map((t) => t.name),
        keywordHits: hits,
        keywordMisses: s.expectedKeywords.filter((k) => !hits.includes(k)),
        topicCountInRange:
          verified.length >= s.expectedTopicRange[0] && verified.length <= s.expectedTopicRange[1],
        verifiedShare: topics.length === 0 ? null : verified.length / topics.length,
      };
    } catch (error) {
      result = {
        id: s.id,
        kind: s.kind,
        inputChars: s.text.length,
        ok: false,
        errorCode: isAiError(error)
          ? error.code
          : error instanceof RangeError
            ? 'INPUT_REJECTED'
            : 'UNEXPECTED',
        seconds: (now() - started) / 1000,
        topicNames: [],
        keywordHits: [],
        keywordMisses: s.expectedKeywords,
        topicCountInRange: false,
        verifiedShare: null,
      };
    }
    results.push(result);
    onSample?.(result);
  }
  return results;
}

export function toMarkdownTable(results: SampleResult[]): string {
  const rows = results.map((r) => {
    const rep = r.report;
    const cells = [
      r.id,
      String(r.inputChars),
      r.ok ? `${r.seconds.toFixed(1)}` : `failed (${r.errorCode})`,
      rep ? String(rep.chunks) : '-',
      rep ? `${rep.verifiedTopics}/${rep.candidateTopics}` : '-',
      rep ? String(rep.invalidTopics) : '-',
      rep ? String(rep.unverifiedTopics) : '-',
      rep ? `${rep.repairs}/${rep.retries}` : '-',
      r.ok ? `${r.keywordHits.length}/${r.keywordHits.length + r.keywordMisses.length}` : '-',
    ];
    return `| ${cells.join(' | ')} |`;
  });
  return [
    '| Sample | Chars | Seconds | Chunks | Verified/returned topics | Invalid | Unverified | Repairs/retries | Keywords found |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}
