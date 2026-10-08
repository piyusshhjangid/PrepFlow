import { z } from 'zod';
import { ENV_FILE_CANDIDATES, loadEnvFiles } from './load-env.js';

const loadedFiles = loadEnvFiles();

const positiveInt = (max: number) => z.coerce.number().int().positive().max(max);
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

/**
 * All configuration is read once, here, and validated. The rest of the app imports `env`
 * and never touches process.env directly. Only variables the code actually uses are listed.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Development / production database. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Dedicated database for integration tests. Never the same database as DATABASE_URL. */
  TEST_DATABASE_URL: optionalString,
  /** Optional overrides for the material limits; defaults live in @prepflow/shared. */
  MAX_PDF_MB: z.coerce.number().positive().max(100).optional(),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(1000).optional(),
  MAX_MATERIAL_CHARS: z.coerce.number().int().positive().max(2_000_000).optional(),
  MAX_MATERIALS_PER_EXAM: z.coerce.number().int().positive().max(100).optional(),
  /** Comma-separated list of allowed browser origins. */
  CLIENT_URL: z
    .string()
    .min(1, 'CLIENT_URL is required')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // ---- AI (Checkpoint C) ----
  /** Which provider implementation to use. `fake` is deterministic and for tests/demos only. */
  AI_PROVIDER: z.enum(['ollama', 'gemini', 'fake']).default('ollama'),
  /** Overrides the provider's default model. */
  AI_MODEL: optionalString,
  AI_REQUEST_TIMEOUT_MS: positiveInt(600_000).default(180_000),
  /** Attempts per model call for transient failures (network, 5xx, 429, timeout). */
  AI_MAX_ATTEMPTS: positiveInt(5).default(3),
  AI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('gemma4:e4b'),
  /** Context window requested from Ollama (num_ctx). */
  OLLAMA_NUM_CTX: positiveInt(262_144).default(16_384),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default('gemma-4-26b-a4b-it'),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  /** Chunk sizing in characters. Defaults depend on the provider (see config/ai.ts). */
  AI_CHUNK_TARGET_CHARS: positiveInt(200_000).optional(),
  AI_CHUNK_MAX_CHARS: positiveInt(250_000).optional(),
  AI_MAX_CHUNKS: positiveInt(500).default(40),
  /** Maximum analyses running at once in this process. */
  ANALYSIS_MAX_CONCURRENT: positiveInt(10).default(1),
  /** A RUNNING analysis whose heartbeat is older than this is considered interrupted. */
  ANALYSIS_STALE_AFTER_MS: positiveInt(24 * 60 * 60_000).default(15 * 60_000),
  /** Per-IP limit on POST /analysis calls. */
  ANALYSIS_RATE_LIMIT: positiveInt(1000).default(10),
  ANALYSIS_RATE_WINDOW_MINUTES: positiveInt(1440).default(60),
});

export type Env = z.infer<typeof envSchema>;

export class EnvironmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentConfigError';
  }
}

export function parseEnv(
  source: Record<string, string | undefined>,
  options: { files?: readonly string[] } = {},
): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    const files = options.files ?? [];
    const where =
      files.length > 0
        ? `Loaded: ${files.join(', ')}`
        : `No .env file found. Looked for:\n${ENV_FILE_CANDIDATES.map((f) => `    ${f}`).join('\n')}`;
    throw new EnvironmentConfigError(
      `Invalid environment configuration:\n${problems}\n\n${where}\n` +
        'Fix: copy apps/api/.env.example to apps/api/.env and edit it (see README, "Configuration").',
    );
  }
  const env = result.data;
  if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    throw new EnvironmentConfigError(
      'Invalid environment configuration:\n  - GEMINI_API_KEY: required when AI_PROVIDER=gemini\n' +
        'Get a key at https://aistudio.google.com/apikey and put it in apps/api/.env (never commit it).',
    );
  }
  if (env.NODE_ENV === 'production' && env.AI_PROVIDER === 'fake') {
    throw new EnvironmentConfigError(
      'Invalid environment configuration:\n  - AI_PROVIDER: fake is only allowed outside production. Configure a real AI provider.',
    );
  }
  return env;
}

/** Tests run against TEST_DATABASE_URL, never against the development database. */
function selectSource(): Record<string, string | undefined> {
  const source = { ...process.env };
  if (source.NODE_ENV === 'test' && source.TEST_DATABASE_URL) {
    source.DATABASE_URL = source.TEST_DATABASE_URL;
  }
  return source;
}

export const env: Env = parseEnv(selectSource(), { files: loadedFiles });
