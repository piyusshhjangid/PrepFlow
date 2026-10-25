import { AiError } from './errors';
import type { AiProvider, GenerateRequest } from './provider';

export interface OllamaOptions {
  /** `/ollama` in the browser (same-origin proxy to Ollama), or `http://127.0.0.1:11434` from Node. */
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  /** Fixed sampling seed, so a repeated run on the same model and prompt can be compared. */
  seed?: number;
  /** Upper bound on generated tokens, so a runaway reply cannot hang the app. */
  numPredict?: number;
  /** Ask the runtime not to spend tokens on "thinking" for this extraction task. Retried without if the runtime rejects it. */
  think?: boolean;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MODEL = 'gemma4:e4b';
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_NUM_CTX = 8192;
export const DEFAULT_SEED = 42;
export const DEFAULT_NUM_PREDICT = 3000;

/**
 * Models the app suggests in its picker. Any other model installed in Ollama can also be chosen; it is
 * labelled "not tested" because only the Gemma 4 family is what this project targets.
 */
export const RECOMMENDED_MODELS: { tag: string; label: string }[] = [
  { tag: 'gemma4:e4b', label: 'Gemma 4 E4B (default)' },
  { tag: 'gemma4:e2b', label: 'Gemma 4 E2B (lighter)' },
  { tag: 'gemma4:26b', label: 'Gemma 4 26B (needs a strong GPU)' },
  { tag: 'gemma4:31b', label: 'Gemma 4 31B (needs a strong GPU)' },
];

export interface ModelInfo {
  digest: string;
  parameterSize?: string;
  quantization?: string;
}

export interface ModelCheck {
  reachable: boolean;
  installed: boolean;
  models: string[];
  /** Details of the selected model when the runtime reports them (used to record exactly what ran). */
  info?: ModelInfo;
}

export interface OllamaStats {
  calls: number;
  promptTokens: number;
  generatedTokens: number;
  /** Seconds the runtime reported for generation (sum over calls). */
  seconds: number;
}

export function modelInstalled(models: string[], wanted: string): boolean {
  const w = wanted.trim();
  return models.some((m) => m === w || m === `${w}:latest`);
}

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly numCtx: number;
  private readonly seed: number;
  private readonly numPredict: number;
  private sendThink: boolean;
  private readonly fetchImpl: typeof fetch;
  /** Running totals from the runtime's own counters; zero if it does not report them. */
  readonly stats: OllamaStats = { calls: 0, promptTokens: 0, generatedTokens: 0, seconds: 0 };

  constructor(options: OllamaOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.numCtx = options.numCtx ?? DEFAULT_NUM_CTX;
    this.seed = options.seed ?? DEFAULT_SEED;
    this.numPredict = options.numPredict ?? DEFAULT_NUM_PREDICT;
    this.sendThink = options.think ?? true;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  /** Is the runtime up, and is the selected model installed? Never throws. */
  async check(signal?: AbortSignal): Promise<ModelCheck> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
        signal: withTimeout(signal, 5000).signal,
      });
      if (!res.ok) return { reachable: false, installed: false, models: [] };
      const body = (await res.json()) as {
        models?: {
          name?: unknown;
          digest?: unknown;
          details?: { parameter_size?: unknown; quantization_level?: unknown };
        }[];
      };
      const entries = body.models ?? [];
      const models = entries.map((m) => String(m.name ?? '')).filter(Boolean);
      const installed = modelInstalled(models, this.model);
      const chosen = entries.find(
        (m) => m.name === this.model || m.name === `${this.model}:latest`,
      );
      const digest = typeof chosen?.digest === 'string' ? chosen.digest : '';
      const size = chosen?.details?.parameter_size;
      const quant = chosen?.details?.quantization_level;
      const info: ModelInfo | undefined = digest
        ? {
            digest: digest.slice(0, 12),
            ...(typeof size === 'string' ? { parameterSize: size } : {}),
            ...(typeof quant === 'string' ? { quantization: quant } : {}),
          }
        : undefined;
      return { reachable: true, installed, models, ...(info ? { info } : {}) };
    } catch {
      return { reachable: false, installed: false, models: [] };
    }
  }

  /** Settings recorded with every analysis so a run can be reproduced. */
  settings(): Record<string, string | number | boolean> {
    return {
      temperature: 0,
      seed: this.seed,
      num_ctx: this.numCtx,
      num_predict: this.numPredict,
      think: this.sendThink ? false : 'not sent',
    };
  }

  /** The runtime's version string (for example "0.20.2"), or null. Never throws. */
  async version(signal?: AbortSignal): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/version`, {
        signal: withTimeout(signal, 5000).signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: unknown };
      return typeof body.version === 'string' ? body.version : null;
    } catch {
      return null;
    }
  }

  private async post(request: GenerateRequest, withThink: boolean): Promise<Response> {
    const timed = withTimeout(request.signal, this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: timed.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: request.schema,
          ...(withThink ? { think: false } : {}),
          options: {
            temperature: 0,
            seed: this.seed,
            num_ctx: this.numCtx,
            num_predict: this.numPredict,
          },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AiError('ABORTED');
      if (timed.timedOut()) throw new AiError('TIMEOUT');
      void error;
      throw new AiError('UNREACHABLE');
    } finally {
      timed.clear();
    }
  }

  async generate(request: GenerateRequest): Promise<string> {
    let res = await this.post(request, this.sendThink);
    if (res.status === 400 && this.sendThink) {
      // Some runtimes or models reject the `think` field. Stop sending it and try once more.
      const detail = (
        await res
          .clone()
          .text()
          .catch(() => '')
      ).toLowerCase();
      if (detail.includes('think')) {
        this.sendThink = false;
        res = await this.post(request, false);
      }
    }
    if (!res.ok) throw await classify(res);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiError('INVALID_OUTPUT');
    }
    const record = body as {
      message?: { content?: unknown };
      prompt_eval_count?: unknown;
      eval_count?: unknown;
      eval_duration?: unknown;
    } | null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    this.stats.calls++;
    this.stats.promptTokens += num(record?.prompt_eval_count);
    this.stats.generatedTokens += num(record?.eval_count);
    this.stats.seconds += num(record?.eval_duration) / 1e9;
    const content = record?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new AiError('INVALID_OUTPUT');
    return content;
  }
}

async function classify(res: Response): Promise<AiError> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300).toLowerCase();
  } catch {
    detail = '';
  }
  if (res.status === 404 || detail.includes('not found')) return new AiError('MODEL_NOT_FOUND');
  if (res.status >= 400 && res.status < 500) return new AiError('BAD_REQUEST');
  return new AiError('SERVER');
}

function withTimeout(external: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}
