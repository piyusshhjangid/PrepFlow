import type { Env } from '../config/env.js';
import type { AiProvider } from './provider.js';
import { FakeAiProvider } from './providers/fake-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';

/** Canned, valid response used when AI_PROVIDER=fake outside tests (UI demos without a model). */
const DEMO_RESPONSE = JSON.stringify({ subjects: [] });

/** The only place that picks a concrete provider. Everything else depends on `AiProvider`. */
export function createAiProvider(env: Env): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'ollama':
      return new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        model: env.AI_MODEL ?? env.OLLAMA_MODEL,
        numCtx: env.OLLAMA_NUM_CTX,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      });
    case 'gemini':
      return new GeminiProvider({
        apiKey: env.GEMINI_API_KEY as string, // presence is enforced by parseEnv
        model: env.AI_MODEL ?? env.GEMINI_MODEL,
        baseUrl: env.GEMINI_BASE_URL,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      });
    case 'fake':
      return new FakeAiProvider(() => DEMO_RESPONSE, env.AI_MODEL ?? 'fake-model');
  }
}
