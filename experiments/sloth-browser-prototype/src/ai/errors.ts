export type AiErrorCode =
  | 'UNREACHABLE'
  | 'MODEL_NOT_FOUND'
  | 'TIMEOUT'
  | 'SERVER'
  | 'BAD_REQUEST'
  | 'INVALID_OUTPUT'
  | 'ABORTED'
  | 'ANALYSIS_FAILED';

/** Messages are fixed, user-safe strings. Raw provider text, prompts and study material never go in them. */
const MESSAGES: Record<AiErrorCode, string> = {
  UNREACHABLE:
    'Could not reach the local model runtime (Ollama). Start Ollama, then try again. Your material is still here.',
  MODEL_NOT_FOUND:
    'The selected model is not installed in Ollama. Run the pull command shown under "Model", then try again.',
  TIMEOUT: 'The model took too long to answer. A smaller model or shorter material may help.',
  SERVER: 'The model runtime returned an error.',
  BAD_REQUEST:
    'The model runtime rejected the request. Check the model name in the Model settings.',
  INVALID_OUTPUT: 'The model did not return usable topics.',
  ABORTED: 'Analysis was cancelled.',
  ANALYSIS_FAILED: 'Analysis failed for every part of the material. Nothing was changed.',
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'AiError';
    this.code = code;
  }
  get retryable(): boolean {
    return this.code === 'TIMEOUT' || this.code === 'SERVER' || this.code === 'UNREACHABLE';
  }
}

export const isAiError = (e: unknown): e is AiError => e instanceof AiError;
