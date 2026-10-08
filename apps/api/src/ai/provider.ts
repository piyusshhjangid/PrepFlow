/**
 * The ONLY AI interface the rest of the application depends on. Concrete providers (Ollama, Gemini,
 * fake) live in ./providers and are chosen in the composition root (container.ts).
 */
export interface AiCompletionRequest {
  /** Trusted instructions written by PrepFlow. Never contains uploaded material. */
  system: string;
  /** The task, including the (untrusted, delimited) study material. */
  user: string;
  /** Hard cap on generated tokens. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiCompletion {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiProvider {
  readonly name: 'ollama' | 'gemini' | 'fake';
  readonly model: string;
  /** Returns raw text. Parsing and validation are NOT the provider's job. */
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

export type AiFailureKind =
  /** Worth retrying: network failure, timeout, 5xx, 429. */
  | 'transient'
  /** Never retry: bad credentials, missing model, bad request/configuration. */
  | 'permanent';

/** Error thrown by providers. `message` is safe to show; never contains keys or prompts. */
export class AiProviderFailure extends Error {
  constructor(
    public readonly kind: AiFailureKind,
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderFailure';
  }
}
