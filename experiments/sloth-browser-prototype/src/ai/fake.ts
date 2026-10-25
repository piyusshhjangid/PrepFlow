import type { AiProvider, GenerateRequest } from './provider';

/**
 * TEST-ONLY scripted provider. It is not a model and must never be presented as one: it is not imported by
 * the application, only by unit tests, so it is not part of the production bundle.
 */
export class ScriptedProvider implements AiProvider {
  readonly id = 'scripted-test-double';
  readonly model = 'none';
  readonly requests: GenerateRequest[] = [];
  constructor(
    private readonly script: (request: GenerateRequest, call: number) => string | Promise<string>,
  ) {}
  async generate(request: GenerateRequest): Promise<string> {
    this.requests.push(request);
    return this.script(request, this.requests.length);
  }
}
