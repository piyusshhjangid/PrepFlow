import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from './test-database.js';

const dev = 'postgresql://u:p@localhost:5432/prepflow?schema=public';

describe('assertSafeTestDatabase', () => {
  it('accepts a separate database whose name contains "test"', () => {
    const url = 'postgresql://u:p@localhost:5432/prepflow_test?schema=public';
    expect(assertSafeTestDatabase(url, dev)).toBe(url);
  });
  it('requires TEST_DATABASE_URL', () => {
    expect(() => assertSafeTestDatabase(undefined, dev)).toThrowError(
      /TEST_DATABASE_URL is not set/,
    );
  });
  it('refuses a database that is not obviously a test database', () => {
    expect(() =>
      assertSafeTestDatabase('postgresql://u:p@localhost:5432/prepflow', dev),
    ).toThrowError(/must contain "test"/);
  });
  it('refuses the development database even if its name contains "test"', () => {
    const same = 'postgresql://u:p@localhost:5432/prepflow_test';
    expect(() => assertSafeTestDatabase(same, same)).toThrowError(/same database/);
  });
  it('rejects malformed URLs', () => {
    expect(() => assertSafeTestDatabase('not a url', dev)).toThrowError(/not a valid/);
  });
});
