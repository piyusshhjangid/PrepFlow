import { describe, expect, it } from 'vitest';
import { GeminiProvider } from './gemini-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { createAiProvider } from '../create-provider.js';
import { parseEnv } from '../../config/env.js';

type Call = { url: string; init: RequestInit };
function fetchStub(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}
const req = { system: 'SYS', user: 'USER' };

describe('OllamaProvider', () => {
  const opts = {
    baseUrl: 'http://localhost:11434/',
    model: 'gemma4:e4b',
    numCtx: 16384,
    timeoutMs: 1000,
  };
  it('calls /api/chat with temperature 0, JSON mode as a hint, and returns text and token counts', async () => {
    const calls: Call[] = [];
    const p = new OllamaProvider({
      ...opts,
      fetchImpl: fetchStub(
        200,
        { message: { content: '{"subjects":[]}' }, prompt_eval_count: 10, eval_count: 5 },
        calls,
      ),
    });
    expect(await p.complete(req)).toEqual({
      text: '{"subjects":[]}',
      promptTokens: 10,
      completionTokens: 5,
    });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(body).toMatchObject({
      model: 'gemma4:e4b',
      stream: false,
      format: 'json',
      options: { temperature: 0, num_ctx: 16384 },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
  });
  it('maps a missing model to a permanent error with a pull hint', async () => {
    const p = new OllamaProvider({ ...opts, fetchImpl: fetchStub(404, {}) });
    await expect(p.complete(req)).rejects.toMatchObject({
      kind: 'permanent',
      code: 'AI_MODEL_NOT_FOUND',
      message: expect.stringContaining('ollama pull'),
    });
  });
  it('maps connection failure to a transient error that mentions Ollama', async () => {
    const p = new OllamaProvider({
      ...opts,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(p.complete(req)).rejects.toMatchObject({
      kind: 'transient',
      code: 'AI_UNREACHABLE',
      message: expect.stringContaining('Ollama'),
    });
  });
  it('maps a malformed response shape to a transient error', async () => {
    const p = new OllamaProvider({ ...opts, fetchImpl: fetchStub(200, { nope: true }) });
    await expect(p.complete(req)).rejects.toMatchObject({
      kind: 'transient',
      code: 'AI_BAD_RESPONSE',
    });
  });
  it('times out', async () => {
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      )) as unknown as typeof fetch;
    const p = new OllamaProvider({ ...opts, timeoutMs: 20, fetchImpl: slow });
    await expect(p.complete(req)).rejects.toMatchObject({ kind: 'transient', code: 'AI_TIMEOUT' });
  });
});

describe('GeminiProvider', () => {
  const opts = {
    apiKey: 'SECRET-KEY-123',
    model: 'gemma-4-26b-a4b-it',
    baseUrl: 'https://generativelanguage.googleapis.com',
    timeoutMs: 1000,
  };
  const ok = {
    candidates: [{ content: { parts: [{ text: '{"subjects":' }, { text: '[]}' }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
  };
  it('sends the key in a header (never the URL) and joins response parts', async () => {
    const calls: Call[] = [];
    const p = new GeminiProvider({ ...opts, fetchImpl: fetchStub(200, ok, calls) });
    expect(await p.complete(req)).toEqual({
      text: '{"subjects":[]}',
      promptTokens: 3,
      completionTokens: 4,
    });
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',
    );
    expect(calls[0]?.url).not.toContain('SECRET-KEY-123');
    expect((calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'SECRET-KEY-123',
    );
  });
  it.each([
    [401, 'permanent', 'AI_AUTH_FAILED'],
    [403, 'permanent', 'AI_AUTH_FAILED'],
    [429, 'transient', 'AI_RATE_LIMITED'],
    [503, 'transient', 'AI_PROVIDER_UNAVAILABLE'],
    [400, 'permanent', 'AI_BAD_REQUEST'],
  ])('maps HTTP %i to %s/%s without leaking the key', async (status, kind, code) => {
    const p = new GeminiProvider({
      ...opts,
      fetchImpl: fetchStub(status, { error: { message: 'key SECRET-KEY-123 invalid' } }),
    });
    const error = await p.complete(req).catch((e: Error) => e);
    expect(error).toMatchObject({ kind, code });
    expect((error as Error).message).not.toContain('SECRET-KEY-123');
  });
  it('treats an empty completion as transient', async () => {
    const p = new GeminiProvider({
      ...opts,
      fetchImpl: fetchStub(200, { candidates: [{ content: { parts: [{ text: '  ' }] } }] }),
    });
    await expect(p.complete(req)).rejects.toMatchObject({
      kind: 'transient',
      code: 'AI_EMPTY_RESPONSE',
    });
  });
});

describe('provider selection and configuration', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@h/db', CLIENT_URL: 'http://x' };
  it('defaults to local Gemma through Ollama', () => {
    const p = createAiProvider(parseEnv(base));
    expect(p).toMatchObject({ name: 'ollama', model: 'gemma4:e4b' });
  });
  it('selects hosted Gemma with its recommended model, and AI_MODEL overrides', () => {
    const env = parseEnv({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' });
    expect(createAiProvider(env)).toMatchObject({ name: 'gemini', model: 'gemma-4-26b-a4b-it' });
    expect(
      createAiProvider(
        parseEnv({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', AI_MODEL: 'other' }),
      ).model,
    ).toBe('other');
  });
  it('refuses to start hosted mode without an API key, with a clear message', () => {
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'gemini' })).toThrowError(
      /GEMINI_API_KEY: required when AI_PROVIDER=gemini/,
    );
    expect(() => parseEnv({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: '   ' })).toThrowError(
      /GEMINI_API_KEY/,
    );
  });
  it('provides a deterministic fake provider', () => {
    expect(createAiProvider(parseEnv({ ...base, AI_PROVIDER: 'fake' })).name).toBe('fake');
  });
});
