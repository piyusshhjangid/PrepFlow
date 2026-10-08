import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CLIENT_URL: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('applies defaults and parses the client origin list', () => {
    const env = parseEnv({ ...valid, CLIENT_URL: 'http://a.test, http://b.test ' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CLIENT_URL).toEqual(['http://a.test', 'http://b.test']);
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails with a readable message when required variables are missing', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseEnv({ ...valid, PORT: '99999' })).toThrowError(/PORT/);
  });

  it('names the .env files it looked for, so a misplaced file is obvious', () => {
    expect(() => parseEnv({})).toThrowError(/apps[\\/]api[\\/]\.env/);
    expect(() => parseEnv({}, { files: ['/x/.env'] })).toThrowError(/Loaded: \/x\/\.env/);
  });

  it('keeps TEST_DATABASE_URL optional and blank-tolerant', () => {
    expect(parseEnv({ ...valid, TEST_DATABASE_URL: '  ' }).TEST_DATABASE_URL).toBeUndefined();
  });

  it('rejects invalid AI settings with readable errors', () => {
    expect(() => parseEnv({ ...valid, AI_PROVIDER: 'openai' })).toThrowError(/AI_PROVIDER/);
    expect(() => parseEnv({ ...valid, AI_MAX_ATTEMPTS: '0' })).toThrowError(/AI_MAX_ATTEMPTS/);
  });

  it('refuses the canned fake provider in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', AI_PROVIDER: 'fake' })).toThrowError(
      /fake is only allowed outside production/,
    );
  });
});
