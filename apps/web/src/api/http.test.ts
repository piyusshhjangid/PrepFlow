import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, resolveApiBase } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveApiBase', () => {
  it('defaults to same-origin and strips trailing slashes', () => {
    expect(resolveApiBase(undefined)).toBe('');
    expect(resolveApiBase('')).toBe('');
    expect(resolveApiBase('  https://api.example.com//  ')).toBe('https://api.example.com');
  });
});

describe('apiRequest', () => {
  it('calls same-origin paths when no base URL is configured', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/api/health');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('turns a network failure into a readable ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(apiRequest('/api/health')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('does not leak a non-JSON error page to the user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502</html>', { status: 502 })),
    );
    const error = await apiRequest('/api/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('SERVER_ERROR');
    expect((error as ApiError).message).not.toContain('<html>');
  });
});
