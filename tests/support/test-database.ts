import postgres from "postgres";

// Test DB Safety.
//
// DB-backed tests (tests/integration/**) create synthetic investors and
// insert into insert-only history tables, so they can never be cleaned up.
// They must therefore only ever run against a database that was EXPLICITLY
// created for tests — never against whatever the application's DATABASE_URL
// (.env) happens to point at. History: plain `vitest run` runs wrote dozens
// of synthetic investors into the real development database before this
// guard existed.
//
// Authorization = ALL of:
//   1. TEST_DATABASE_URL is set (the application DATABASE_URL never counts),
//   2. it does not resolve to the same host/port/database as DATABASE_URL,
//   3. the database it connects to carries TEST_DATABASE_MARKER in its own
//      metadata (COMMENT ON DATABASE) — written only by `npm run db:test:create`,
//      never inherited from .env, and NOT inferred from the database name
//      (a name that merely looks like "test"/"scratch" authorizes nothing).
// Anything else fails BEFORE the first write. Failure text never contains a
// connection string, host, user or password.

export const TEST_DATABASE_ENV = "TEST_DATABASE_URL";

/** Written into a database's own metadata by `npm run db:test:create`. */
export const TEST_DATABASE_MARKER = "ai-investment-copilot:test-database:v1";

/**
 * What DATABASE_URL is pinned to while no test database is authorized: a
 * name that can never resolve (RFC 6761 `.invalid`) with dummy credentials,
 * so any accidental connection fails closed instead of reaching a real DB.
 */
export const UNCONFIGURED_TEST_DATABASE_URL = "postgres://test:test@test-database-url-not-configured.invalid:5432/test";

export const NOT_CONFIGURED_MESSAGE =
  "DB-backed tests are blocked: no authorized test database is configured. " +
  "Set TEST_DATABASE_URL to a database created with `npm run db:test:create` " +
  "(the application DATABASE_URL is never used for tests). " +
  "Pure unit tests need no database: `npm run test:unit`.";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabase: { state: "unconfigured" } | { state: "authorized"; url: string; name: string };
  }
}

export class TestDatabaseNotAuthorizedError extends Error {
  constructor(reason: string) {
    super(`Test database NOT authorized — ${reason}. Nothing was written.`);
    this.name = "TestDatabaseNotAuthorizedError";
  }
}

export type TestDatabaseVerdict = { ok: true; databaseName: string } | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

interface Target {
  host: string;
  port: string;
  database: string;
}

function parseTarget(raw: string): Target | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  if (!database || !url.hostname) return null;
  const host = url.hostname.toLowerCase();
  return { host: LOOPBACK_HOSTS.has(host) ? "loopback" : host, port: url.port || "5432", database };
}

/** Pure, no I/O: can this URL even be a candidate test database? */
export function evaluateTestDatabaseConfig(input: { testUrl: string | undefined; appUrl: string | undefined }): TestDatabaseVerdict {
  const testUrl = input.testUrl?.trim();
  if (!testUrl) return { ok: false, reason: "TEST_DATABASE_URL is not set" };
  const test = parseTarget(testUrl);
  if (!test) return { ok: false, reason: "TEST_DATABASE_URL is not a valid postgres:// connection URL with a database name" };
  const app = input.appUrl ? parseTarget(input.appUrl) : null;
  if (app && app.host === test.host && app.port === test.port && app.database === test.database) {
    return { ok: false, reason: "TEST_DATABASE_URL targets the same database (host, port, name) as the application DATABASE_URL" };
  }
  return { ok: true, databaseName: test.database };
}

export interface DatabaseIdentity {
  name: string;
  marker: string | null;
}

/** What the connected database says about itself (a read-only SELECT). */
export async function readDatabaseIdentity(sql: postgres.Sql): Promise<DatabaseIdentity | undefined> {
  const rows = await sql<DatabaseIdentity[]>`
    select current_database() as name, shobj_description(d.oid, 'pg_database') as marker
    from pg_database d
    where d.datname = current_database()
  `;
  return rows[0];
}

/** Pure: does the identity a connection reported authorize tests? */
export function checkDatabaseIdentity(identity: DatabaseIdentity | undefined, expectedName: string): TestDatabaseVerdict {
  if (!identity) return { ok: false, reason: "could not read the connected database's identity" };
  if (identity.name !== expectedName) {
    return { ok: false, reason: "the connected database's name differs from the one in TEST_DATABASE_URL" };
  }
  if (identity.marker !== TEST_DATABASE_MARKER) {
    return {
      ok: false,
      reason: `database "${identity.name}" does not carry the test-database marker (only databases created with \`npm run db:test:create\` are authorized; the name is irrelevant)`,
    };
  }
  return { ok: true, databaseName: identity.name };
}

/**
 * Full authorization: config check, connect, marker check. Returns the
 * database name or throws TestDatabaseNotAuthorizedError. The underlying
 * driver error is deliberately NOT propagated (it can carry host/user).
 */
export async function authorizeTestDatabase(testUrl: string | undefined, appUrl: string | undefined): Promise<{ databaseName: string }> {
  const config = evaluateTestDatabaseConfig({ testUrl, appUrl });
  if (!config.ok) throw new TestDatabaseNotAuthorizedError(config.reason);

  const sql = postgres(testUrl!.trim(), { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const verdict = checkDatabaseIdentity(await readDatabaseIdentity(sql), config.databaseName);
    if (!verdict.ok) throw new TestDatabaseNotAuthorizedError(verdict.reason);
    return { databaseName: verdict.databaseName };
  } catch (err) {
    if (err instanceof TestDatabaseNotAuthorizedError) throw err;
    const code = (err as { code?: unknown } | null)?.code;
    throw new TestDatabaseNotAuthorizedError(`could not connect to the test database (${typeof code === "string" ? code : "unknown error"})`);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

export function isIntegrationTestPath(testPath: string | undefined): boolean {
  return /[\\/]tests[\\/]integration[\\/]/.test(testPath ?? "");
}
