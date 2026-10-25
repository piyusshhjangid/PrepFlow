import { describe, expect, it, vi } from 'vitest';
import { isAiError } from './errors';
import { modelInstalled, OllamaProvider } from './ollama';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const request = { system: 's', user: 'u', schema: { type: 'object' } };
const make = (fetchImpl: typeof fetch, extra = {}) =>
  new OllamaProvider({ baseUrl: '/ollama/', model: 'gemma4:e4b', fetchImpl, ...extra });

describe('OllamaProvider.generate', () => {
  it('sends a deterministic, schema-constrained, non-streaming chat request and returns the content', async () => {
    const fetchImpl = vi.fn(async () => json({ message: { content: '{"topics": []}' } }));
    const reply = await make(fetchImpl as unknown as typeof fetch).generate(request);
    expect(reply).toBe('{"topics": []}');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/ollama/api/chat');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'gemma4:e4b', stream: false, format: { type: 'object' } });
    expect(body.options.temperature).toBe(0);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });
  it('maps failures to safe error codes', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => json({ error: "model 'x' not found" }, 404), 'MODEL_NOT_FOUND'],
      [async () => json({ error: 'bad' }, 400), 'BAD_REQUEST'],
      [async () => json({ error: 'boom' }, 500), 'SERVER'],
      [async () => json({ message: {} }), 'INVALID_OUTPUT'],
      [async () => new Response('not json', { status: 200 }), 'INVALID_OUTPUT'],
      [
        async () => {
          throw new TypeError('Failed to fetch');
        },
        'UNREACHABLE',
      ],
    ];
    for (const [impl, code] of cases) {
      const error = await make(vi.fn(impl) as unknown as typeof fetch)
        .generate(request)
        .catch((e: unknown) => e);
      expect(isAiError(error) && error.code, code).toBe(code);
    }
  });
  it('never puts provider response text in the error message', async () => {
    const impl = vi.fn(async () => json({ error: 'secret prompt text leaked' }, 500));
    const error = (await make(impl as unknown as typeof fetch)
      .generate(request)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('secret');
  });
  it('times out and can be cancelled', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
      )) as unknown as typeof fetch;
    const timeout = await make(hang, { timeoutMs: 20 })
      .generate(request)
      .catch((e: unknown) => e);
    expect(isAiError(timeout) && timeout.code).toBe('TIMEOUT');
    const controller = new AbortController();
    const pending = make(hang)
      .generate({ ...request, signal: controller.signal })
      .catch((e: unknown) => e);
    controller.abort();
    const aborted = await pending;
    expect(isAiError(aborted) && aborted.code).toBe('ABORTED');
  });
});

describe('OllamaProvider.check', () => {
  it('reports reachable and whether the model is installed', async () => {
    const ok = make((async () =>
      json({
        models: [{ name: 'gemma4:e4b' }, { name: 'llama3:latest' }],
      })) as unknown as typeof fetch);
    expect(await ok.check()).toEqual({
      reachable: true,
      installed: true,
      models: ['gemma4:e4b', 'llama3:latest'],
    });
    const missing = make((async () =>
      json({ models: [{ name: 'llama3:latest' }] })) as unknown as typeof fetch);
    expect(await missing.check()).toMatchObject({ reachable: true, installed: false });
  });
  it('never throws when the runtime is down', async () => {
    const down = make((async () => {
      throw new TypeError('nope');
    }) as unknown as typeof fetch);
    expect(await down.check()).toEqual({ reachable: false, installed: false, models: [] });
    const proxyError = make(
      (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    );
    expect((await proxyError.check()).reachable).toBe(false);
  });
  it('matches an untagged name to :latest', () => {
    expect(modelInstalled(['gemma4:latest'], 'gemma4')).toBe(true);
    expect(modelInstalled(['gemma4:e2b'], 'gemma4:e4b')).toBe(false);
  });
});

describe('OllamaProvider reproducibility and safety settings', () => {
  const okBody = {
    message: { content: '{"topics": []}' },
    prompt_eval_count: 120,
    eval_count: 30,
    eval_duration: 2_000_000_000,
  };
  it('sends a fixed seed, an output cap and think:false, and reports them', async () => {
    const fetchImpl = vi.fn(async () => json(okBody));
    const p = make(fetchImpl as unknown as typeof fetch, {
      seed: 7,
      numPredict: 999,
      numCtx: 4096,
    });
    await p.generate(request);
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.options).toEqual({ temperature: 0, seed: 7, num_ctx: 4096, num_predict: 999 });
    expect(body.think).toBe(false);
    expect(p.settings()).toEqual({
      temperature: 0,
      seed: 7,
      num_ctx: 4096,
      num_predict: 999,
      think: false,
    });
  });
  it('accumulates the runtime’s own token and time counters', async () => {
    const p = make((async () => json(okBody)) as unknown as typeof fetch);
    await p.generate(request);
    await p.generate(request);
    expect(p.stats).toEqual({ calls: 2, promptTokens: 240, generatedTokens: 60, seconds: 4 });
  });
  it('stops sending think when the runtime rejects it, and retries once without it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const impl = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return 'think' in body
        ? json({ error: '"gemma4:e4b" does not support the think parameter' }, 400)
        : json(okBody);
    });
    const p = make(impl as unknown as typeof fetch);
    expect(await p.generate(request)).toBe('{"topics": []}');
    expect(bodies.map((b) => 'think' in b)).toEqual([true, false]);
    await p.generate(request);
    expect(bodies.map((b) => 'think' in b)).toEqual([true, false, false]);
    expect(p.settings().think).toBe('not sent');
  });
  it('does not retry an unrelated 400', async () => {
    const impl = vi.fn(async () => json({ error: 'bad format' }, 400));
    const error = await make(impl as unknown as typeof fetch)
      .generate(request)
      .catch((e: unknown) => e);
    expect(isAiError(error) && error.code).toBe('BAD_REQUEST');
    expect(impl).toHaveBeenCalledTimes(1);
  });
  it('reads the installed model’s digest and size when the runtime reports them', async () => {
    const p = make((async () =>
      json({
        models: [
          {
            name: 'gemma4:e4b',
            digest: 'abcdef0123456789abcdef',
            details: { parameter_size: '8.0B', quantization_level: 'Q4_K_M' },
          },
        ],
      })) as unknown as typeof fetch);
    expect((await p.check()).info).toEqual({
      digest: 'abcdef012345',
      parameterSize: '8.0B',
      quantization: 'Q4_K_M',
    });
  });
  it('reads the runtime version and returns null when it is unavailable', async () => {
    expect(
      await make((async () => json({ version: '0.20.2' })) as unknown as typeof fetch).version(),
    ).toBe('0.20.2');
    expect(await make((async () => json({}, 404)) as unknown as typeof fetch).version()).toBeNull();
    expect(
      await make((async () => {
        throw new TypeError('down');
      }) as unknown as typeof fetch).version(),
    ).toBeNull();
  });
});
