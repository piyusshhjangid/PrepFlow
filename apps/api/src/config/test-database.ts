/**
 * Safety rails for the test database. Integration tests delete data, so they must never be able to
 * touch the development database, even by misconfiguration.
 */
export class TestDatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseConfigError';
  }
}

function parse(url: string, label: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new TestDatabaseConfigError(`${label} is not a valid PostgreSQL URL.`);
  }
}

function identity(url: URL): string {
  return `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`;
}

/** Returns the test URL if it is safe to use; throws a descriptive error otherwise. */
export function assertSafeTestDatabase(
  testUrl: string | undefined,
  devUrl: string | undefined,
): string {
  if (!testUrl) {
    throw new TestDatabaseConfigError(
      'TEST_DATABASE_URL is not set. Add it to apps/api/.env, e.g.\n' +
        '  TEST_DATABASE_URL=postgresql://prepflow:prepflow@localhost:5432/prepflow_test?schema=public\n' +
        'and create the database (README: "Test database").',
    );
  }
  const test = parse(testUrl, 'TEST_DATABASE_URL');
  const dbName = test.pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new TestDatabaseConfigError(
      `Refusing to run tests against database "${dbName}": the test database name must contain "test" (e.g. prepflow_test).`,
    );
  }
  if (devUrl && identity(parse(devUrl, 'DATABASE_URL')) === identity(test)) {
    throw new TestDatabaseConfigError(
      'TEST_DATABASE_URL points at the same database as DATABASE_URL. Use a separate database for tests.',
    );
  }
  return testUrl;
}
