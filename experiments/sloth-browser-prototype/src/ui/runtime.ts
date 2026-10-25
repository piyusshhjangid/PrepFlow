import { OllamaProvider, type ModelCheck } from '../ai/ollama';
import type { AiProvider } from '../ai/provider';
import type { PdfLib } from '../core/pdf';

export interface Runtime {
  provider: AiProvider;
  check(): Promise<ModelCheck>;
}
export type RuntimeFactory = (model: string) => Runtime;

/** Same-origin `/ollama` is proxied to the Ollama server by Vite (dev and preview), so no CORS setup is needed. */
export const ollamaRuntime: RuntimeFactory = (model) => {
  const provider = new OllamaProvider({ baseUrl: '/ollama', model });
  return { provider, check: () => provider.check() };
};

/** pdf.js is loaded only when a PDF is chosen, so the first page load stays small. */
export async function loadPdfLib(): Promise<PdfLib> {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib as unknown as PdfLib;
}
