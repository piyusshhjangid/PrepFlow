export interface GenerateRequest {
  system: string;
  user: string;
  /** JSON Schema the reply should follow. Providers that support constrained output use it; others ignore it. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

/** The only thing the analysis pipeline knows about a model runtime. */
export interface AiProvider {
  readonly id: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<string>;
  /** Generation settings worth recording with a run (temperature, seed, context size…). */
  settings?(): Record<string, string | number | boolean>;
}
