/**
 * Opt-in smoke test of the REAL configured AI provider (never part of `npm test`):
 *
 *   npm run ai:smoke
 *
 * Steps: configuration → connectivity/model call → response parsing → schema validation → evidence
 * verification, using a tiny built-in study text. Exit code 0 = the whole chain worked, 1 = it did not
 * (the failing step and how to fix it are printed). It never pretends: AI_PROVIDER=fake is refused.
 */
import { createAiProvider } from '../src/ai/create-provider.js';
import { analyzeChunk } from '../src/ai/analysis/analyze-chunk.js';
import { chunkMaterials } from '../src/ai/analysis/chunker.js';
import { AiProviderFailure } from '../src/ai/provider.js';

const SAMPLE = [
  'Database Normalization',
  '',
  'Normalization is the process of organizing the columns and tables of a relational database to reduce data redundancy.',
  'The first normal form requires that every attribute holds only atomic values and has no repeating groups.',
  '',
  'Transactions',
  '',
  'A transaction is a unit of work that must satisfy the ACID properties: atomicity, consistency, isolation and durability.',
].join('\n');

const step = (n: number, message: string) => console.log(`[${n}/5] ${message}`);
function fail(message: string, hint?: string): never {
  console.error(`✗ ${message}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Dynamic import: env validation throws on bad configuration, and that must be reported readably.
  const { env, EnvironmentConfigError } = await import('../src/config/env.js').catch(
    (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
  );
  void EnvironmentConfigError;
  step(1, `Configuration: AI_PROVIDER=${env.AI_PROVIDER}`);
  if (env.AI_PROVIDER === 'fake')
    fail(
      'AI_PROVIDER=fake is not a real model.',
      'Set AI_PROVIDER=ollama (local) or AI_PROVIDER=gemini (hosted) in apps/api/.env.',
    );
  const provider = createAiProvider(env);
  console.log(`      provider=${provider.name} model=${provider.model}`);

  step(2, 'Calling the model with a small study excerpt (this can take a while on first load)...');
  const [chunk] = chunkMaterials(
    [{ id: 'smoke', contentHash: 'smoke', sourceType: 'TEXT', extractedText: SAMPLE }],
    { targetChars: 12_000, maxChars: 15_000, maxChunks: 40 },
  );
  if (!chunk) fail('Internal error: sample did not chunk.');
  const started = Date.now();
  let outcome;
  try {
    outcome = await analyzeChunk(
      chunk,
      { weakTopicHints: ['Normalization'], knownSubjects: [] },
      {
        provider,
        retry: { maxAttempts: env.AI_MAX_ATTEMPTS, baseDelayMs: env.AI_RETRY_BASE_DELAY_MS },
      },
    );
  } catch (error) {
    if (error instanceof AiProviderFailure) {
      const hints: Record<string, string> = {
        AI_AUTH_FAILED:
          'Check GEMINI_API_KEY in apps/api/.env (create one at https://aistudio.google.com/apikey).',
        AI_MODEL_NOT_FOUND:
          provider.name === 'ollama'
            ? `Run: ollama pull ${provider.model}`
            : 'Check GEMINI_MODEL / AI_MODEL spelling and that your key can use it.',
        AI_UNREACHABLE:
          provider.name === 'ollama'
            ? `Start Ollama (ollama serve) and check OLLAMA_BASE_URL=${env.OLLAMA_BASE_URL}.`
            : 'Check your internet connection and GEMINI_BASE_URL.',
      };
      fail(`${error.code}: ${error.message}`, hints[error.code]);
    }
    throw error;
  }
  console.log(
    `      model answered in ${((Date.now() - started) / 1000).toFixed(1)}s (retries=${outcome.stats.retries}, repairs=${outcome.stats.repairs})`,
  );

  step(3, 'Parsing the response');
  if (!outcome.ok && outcome.code === 'AI_UNAVAILABLE') {
    const code = outcome.providerCode ?? 'unknown';
    fail(
      `The provider kept failing (last error: ${code}).`,
      provider.name === 'ollama'
        ? `Is Ollama running at ${env.OLLAMA_BASE_URL}? Start it (ollama serve) and run: ollama pull ${provider.model}`
        : 'Check your network connection, quota and GEMINI_BASE_URL.',
    );
  }
  step(4, 'Validating against the schema');
  if (!outcome.ok)
    fail(
      'The model answered, but its output could not be parsed/validated even after one repair attempt.',
      'Try a larger model (OLLAMA_MODEL / GEMINI_MODEL) — small models sometimes cannot follow the format.',
    );
  step(5, 'Verifying evidence against the source text');
  if (outcome.topics.length === 0)
    fail(
      'The output was valid but contained no topic with verifiable evidence.',
      `Dropped evidence reasons: ${JSON.stringify(outcome.stats.droppedEvidence)}. Try again or use a larger model.`,
    );

  console.log(`\n✓ AI smoke test passed: ${outcome.topics.length} verified topic(s).`);
  for (const topic of outcome.topics)
    console.log(
      `   - ${topic.name} [${topic.difficulty}/${topic.importance}] evidence: "${topic.evidence[0]?.snippet.slice(0, 60)}…"`,
    );
}

main().catch((error: unknown) => {
  fail(`Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
});
