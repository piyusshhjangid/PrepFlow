import { z } from 'zod';
import { postJson, type FetchLike } from '../http-json.js';
import {
  AiProviderFailure,
  type AiCompletion,
  type AiCompletionRequest,
  type AiProvider,
} from '../provider.js';

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
});

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

/**
 * Hosted Gemma through the Gemini API (generateContent). The API key is sent in a header, never in
 * the URL, so it cannot end up in logs or error messages. No JSON schema is enforced by the provider;
 * output is parsed tolerantly and validated by the caller.
 */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    // Some hosted Gemma variants do not support a separate systemInstruction, so the trusted
    // instructions and the task travel together in one user turn, clearly separated.
    const prompt = `${request.system}\n\n=== TASK ===\n${request.user}`;
    const raw = await postJson(
      this.options.fetchImpl ?? fetch,
      `${base}/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
        },
      },
      {
        provider: 'gemini',
        timeoutMs: this.options.timeoutMs,
        headers: { 'x-goog-api-key': this.options.apiKey },
        signal: request.signal,
      },
    );
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new AiProviderFailure(
        'transient',
        'AI_BAD_RESPONSE',
        'The gemini AI provider returned an unexpected response shape.',
      );
    const text = (parsed.data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');
    if (!text.trim())
      throw new AiProviderFailure(
        'transient',
        'AI_EMPTY_RESPONSE',
        'The gemini AI provider returned an empty response.',
      );
    return {
      text,
      promptTokens: parsed.data.usageMetadata?.promptTokenCount,
      completionTokens: parsed.data.usageMetadata?.candidatesTokenCount,
    };
  }
}
