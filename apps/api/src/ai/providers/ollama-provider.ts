import { z } from 'zod';
import { postJson, type FetchLike } from '../http-json.js';
import {
  AiProviderFailure,
  type AiCompletion,
  type AiCompletionRequest,
  type AiProvider,
} from '../provider.js';

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  numCtx: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

/**
 * Local Gemma through Ollama's /api/chat. JSON mode (`format: "json"`) is requested as a hint only:
 * the caller still parses tolerantly and validates with Zod, because small local models do not
 * reliably honor it.
 */
export class OllamaProvider implements AiProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  constructor(private readonly options: OllamaOptions) {
    this.model = options.model;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const raw = await postJson(
      this.options.fetchImpl ?? fetch,
      `${this.options.baseUrl.replace(/\/+$/, '')}/api/chat`,
      {
        model: this.options.model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        options: {
          temperature: 0,
          num_ctx: this.options.numCtx,
          ...(request.maxOutputTokens ? { num_predict: request.maxOutputTokens } : {}),
        },
      },
      { provider: 'ollama', timeoutMs: this.options.timeoutMs, signal: request.signal },
    );
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new AiProviderFailure(
        'transient',
        'AI_BAD_RESPONSE',
        'The ollama AI provider returned an unexpected response shape.',
      );
    return {
      text: parsed.data.message.content,
      promptTokens: parsed.data.prompt_eval_count,
      completionTokens: parsed.data.eval_count,
    };
  }
}
