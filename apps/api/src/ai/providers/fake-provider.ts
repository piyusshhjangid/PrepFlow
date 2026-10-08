import {
  AiProviderFailure,
  type AiCompletion,
  type AiCompletionRequest,
  type AiProvider,
} from '../provider.js';

export type FakeResponder = (
  request: AiCompletionRequest,
  callIndex: number,
) => string | Promise<string>;

/**
 * Deterministic provider for tests and offline demos. It never calls a network. Give it a list of
 * scripted outcomes (strings are returned, Errors are thrown) or a responder function.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake' as const;
  readonly model: string;
  readonly calls: AiCompletionRequest[] = [];

  constructor(
    private readonly script: FakeResponder | readonly (string | Error)[],
    model = 'fake-model',
    private readonly delayMs = 0,
  ) {
    this.model = model;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const index = this.calls.length;
    this.calls.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    let outcome: string | Error | undefined;
    if (typeof this.script === 'function') outcome = await this.script(request, index);
    else outcome = this.script[Math.min(index, this.script.length - 1)];
    if (outcome instanceof Error) throw outcome;
    if (outcome === undefined)
      throw new AiProviderFailure('permanent', 'FAKE_EMPTY', 'No scripted response.');
    return {
      text: outcome,
      promptTokens: Math.ceil(request.user.length / 4),
      completionTokens: Math.ceil(outcome.length / 4),
    };
  }
}

export const transientFailure = (code = 'AI_UNREACHABLE') =>
  new AiProviderFailure('transient', code, 'Simulated transient failure.');
export const permanentFailure = (code = 'AI_AUTH_FAILED') =>
  new AiProviderFailure('permanent', code, 'Simulated permanent failure.');
