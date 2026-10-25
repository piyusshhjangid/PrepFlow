import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The browser talks to Ollama through a same-origin `/ollama` proxy, so no CORS configuration
 * (OLLAMA_ORIGINS) is needed and the study material only ever travels to the machine running Ollama.
 * Override the target with OLLAMA_URL (for example a second machine on your LAN).
 */
const ollamaTarget = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const proxy = {
  '/ollama': {
    target: ollamaTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ollama/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'eval/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 20000,
  },
});
