/**
 * Real-model evaluation. Requires a running Ollama with the chosen model installed; there is deliberately no
 * fake mode here, so every number this script writes came from a real model run on this machine.
 *
 *   npm run eval -- --model gemma4:e4b                  # 1 run over all samples
 *   npm run eval -- --model gemma4:e4b --runs 3         # repeat; reports mean and spread
 *   npm run eval -- --model gemma4:e2b --num-ctx 8192
 *   npm run eval -- --smoke                              # one tiny call: is everything wired up?
 *
 * Writes eval/results/live-<model>-<timestamp>.json and live-latest.md. The same metrics are computed for
 * the rule-based outline baseline on the same samples, so the two can be compared fairly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyReport, outlineMaterial } from '../src/ai/analyze';
import { PROMPT_VERSION, promptFingerprint } from '../src/ai/prompts';
import { OllamaProvider } from '../src/ai/ollama';
import { metricsTable, pct } from './format';
import { computeMetrics, mean, type Gold, type SampleMetrics } from './metrics';
import { runEval, type Sample, type SampleResult } from './runner';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const model = arg('model', 'gemma4:e4b');
const baseUrl = arg('base-url', 'http://127.0.0.1:11434');
const numCtx = Number(arg('num-ctx', '8192'));
const seed = Number(arg('seed', '42'));
const runs = Math.max(1, Number(arg('runs', '1')));
const outDir = arg('out-dir', join(here, 'results'));

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')) as {
  samples: {
    id: string;
    kind: string;
    file: string;
    expectedKeywords: string[];
    expectedTopicRange: [number, number];
  }[];
};
const gold = JSON.parse(readFileSync(join(here, 'gold.json'), 'utf8')) as {
  version: string;
  samples: Record<string, Gold>;
};
const samples: Sample[] = manifest.samples.map((s) => ({
  id: s.id,
  kind: s.kind,
  text: readFileSync(join(here, s.file), 'utf8'),
  expectedKeywords: s.expectedKeywords,
  expectedTopicRange: s.expectedTopicRange,
}));

const provider = new OllamaProvider({ baseUrl, model, numCtx, seed });
const check = await provider.check();
if (!check.reachable) {
  console.error(`Ollama is not reachable at ${baseUrl}. Start it (ollama serve) and try again.`);
  process.exit(2);
}
if (!check.installed) {
  console.error(`Model "${model}" is not installed. Run: ollama pull ${model}`);
  process.exit(2);
}
const ollamaVersion = await provider.version();

if (flag('smoke')) {
  const t0 = Date.now();
  try {
    const reply = await provider.generate({
      system: 'Reply with the JSON object {"ok": true} and nothing else.',
      user: 'ping',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    });
    console.log(
      `Smoke test OK in ${((Date.now() - t0) / 1000).toFixed(1)} s. Reply: ${reply.slice(0, 120)}`,
    );
    console.log(`Ollama ${ollamaVersion ?? '?'}; settings: ${JSON.stringify(provider.settings())}`);
    process.exit(0);
  } catch (e) {
    console.error(`Smoke test FAILED: ${(e as Error).message}`);
    process.exit(1);
  }
}

interface RunOutcome {
  results: SampleResult[];
  metrics: { id: string; m: SampleMetrics; seconds: number; ok: boolean; errorCode?: string }[];
}
const all: RunOutcome[] = [];
for (let run = 1; run <= runs; run++) {
  console.log(`\nRun ${run} of ${runs} with ${model}`);
  const results = await runEval(
    provider,
    samples,
    Date.now,
    (r) =>
      console.log(`  ${r.id}: ${r.ok ? `${r.seconds.toFixed(1)} s` : `failed ${r.errorCode}`}`),
    check.info?.digest ? { modelDigest: check.info.digest } : {},
  );
  all.push({
    results,
    metrics: results.map((r) => ({
      id: r.id,
      ok: r.ok,
      ...(r.errorCode ? { errorCode: r.errorCode } : {}),
      seconds: r.seconds,
      m: computeMetrics(r.topics ?? [], r.report ?? emptyFailed(r), gold.samples[r.id]!),
    })),
  });
}

function emptyFailed(r: SampleResult) {
  // A failed run still counts: no topics, so recall is 0 and the failure is visible in the table.
  const report = emptyReport('model', 'ollama', model, r.inputChars);
  report.chunks = 1;
  report.chunkFailures = [{ chunk: 1, code: 'ANALYSIS_FAILED' }];
  return report;
}

const baseline = samples.map((s) => {
  const { topics, report } = outlineMaterial(s.text);
  return { id: s.id, m: computeMetrics(topics, report, gold.samples[s.id]!) };
});

const env = {
  when: new Date().toISOString(),
  model,
  modelDigest: check.info?.digest ?? null,
  modelSize: check.info?.parameterSize ?? null,
  quantization: check.info?.quantization ?? null,
  ollamaVersion,
  baseUrl: baseUrl.replace(/\/\/[^/@]*@/, '//'),
  settings: provider.settings(),
  promptVersion: PROMPT_VERSION,
  promptHash: promptFingerprint(),
  goldVersion: gold.version,
  samples: samples.length,
  runs,
  tokens: provider.stats,
  machine: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemGB: Math.round(os.totalmem() / 2 ** 30),
  },
};

const lines: string[] = [
  `# Live evaluation: ${model}`,
  '',
  `Run on ${env.when} with Ollama ${env.ollamaVersion ?? '?'}, model digest ${env.modelDigest ?? '?'}, prompt ${PROMPT_VERSION}/${env.promptHash}, gold set ${gold.version}, ${runs} run(s) over ${samples.length} samples. Settings: ${JSON.stringify(env.settings)}. Machine: ${env.machine.cpu}, ${env.machine.cpuCount} cores, ${env.machine.totalMemGB} GB RAM (GPU not recorded: add it by hand).`,
  '',
];
all.forEach((run, i) => {
  lines.push(`## Run ${i + 1}: Gemma pipeline`, '', metricsTable(run.metrics), '');
  const secs = run.metrics.map((x) => x.seconds);
  lines.push(
    `Wall-clock per sample: ${secs.map((s) => s.toFixed(1)).join(', ')} s. Failed samples: ${
      run.metrics
        .filter((x) => !x.ok)
        .map((x) => `${x.id} (${x.errorCode})`)
        .join(', ') || 'none'
    }.`,
    '',
  );
});
const flat = (pick: (m: SampleMetrics) => number | null) =>
  mean(all.flatMap((r) => r.metrics.map((x) => pick(x.m))));
const flatB = (pick: (m: SampleMetrics) => number | null) => mean(baseline.map((x) => pick(x.m)));
const rows: [string, (m: SampleMetrics) => number | null][] = [
  ['Topic recall', (m) => m.recall],
  ['Topic precision', (m) => m.precision],
  ['Evidence pass rate', (m) => m.evidencePassRate],
  ['Fabricated-quote rate', (m) => m.fabricatedRate],
  ['Weakly linked rate', (m) => m.weakSupportRate],
  ['High-importance recall', (m) => m.highRecall],
  ['High-importance precision', (m) => m.highPrecision],
  ['Order agreement', (m) => m.orderAgreement],
];
lines.push(
  '## Gemma pipeline vs rule-based outline baseline (mean over samples where the metric is defined)',
  '',
  '| Metric | Gemma pipeline | Outline baseline |',
  '| --- | ---: | ---: |',
  ...rows.map(([label, pick]) => `| ${label} | ${pct(flat(pick), 1)} | ${pct(flatB(pick), 1)} |`),
  `| First-try valid output | ${pct(
    flat((m) => m.firstTryValidRate),
    1,
  )} | n/a |`,
  '',
  `Generated tokens ${env.tokens.generatedTokens}, prompt tokens ${env.tokens.promptTokens}, ${env.tokens.calls} calls.`,
  '',
  '## Topics returned (first run), for qualitative review',
  '',
);
for (const r of all[0]!.results) {
  lines.push(
    `### ${r.id}`,
    '',
    r.ok ? `Verified: ${r.topicNames.join('; ') || '(none)'}` : `FAILED: ${r.errorCode}`,
  );
  const held = (r.topics ?? []).filter((t) => t.status === 'unverified');
  if (held.length)
    lines.push('', `Held back: ${held.map((t) => `${t.name} (${t.unverifiedReason})`).join('; ')}`);
  lines.push('');
}
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = `live-${model.replace(/[^\w.-]/g, '_')}-${stamp}`;
writeFileSync(
  join(outDir, `${base}.json`),
  JSON.stringify(
    { env, runs: all.map((r) => ({ metrics: r.metrics, results: r.results })), baseline },
    null,
    2,
  ),
);
writeFileSync(join(outDir, 'live-latest.md'), `${lines.join('\n')}\n`);
console.log(`\n${lines.join('\n')}\nSaved ${join(outDir, `${base}.json`)} and live-latest.md`);
