import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeTestDatabase,
  checkDatabaseIdentity,
  evaluateTestDatabaseConfig,
  isIntegrationTestPath,
  TEST_DATABASE_MARKER,
  TestDatabaseNotAuthorizedError,
  UNCONFIGURED_TEST_DATABASE_URL,
} from "../support/test-database";

// Test DB Safety — DB-free coverage of the authorization rules. The end-to-end
// behavior (real Vitest runs that must fail before any write) is in
// tests/unit/test-database-fail-closed.test.ts; the connected-database side is
// in tests/integration/test-database-guard.test.ts.

const APP_URL = "postgres://appuser:APP-SECRET-pw@localhost:5432/ai_investment_copilot";
const evaluate = (testUrl: string | undefined, appUrl: string | undefined = APP_URL) => evaluateTestDatabaseConfig({ testUrl, appUrl });
const reasonOf = (v: ReturnType<typeof evaluate>) => (v.ok ? "" : v.reason);

describe("evaluateTestDatabaseConfig — the application DATABASE_URL can never authorize tests", () => {
  it("A/C. no TEST_DATABASE_URL (unset, empty, whitespace) authorizes nothing — the application URL is not a fallback", () => {
    for (const testUrl of [undefined, "", "   ", "\n"]) {
      const v = evaluate(testUrl);
      expect(v.ok, JSON.stringify(testUrl)).toBe(false);
      expect(reasonOf(v)).toMatch(/TEST_DATABASE_URL is not set/);
    }
    // ...whatever the application URL is, including none at all
    expect(evaluate(undefined, undefined).ok).toBe(false);
  });

  it("B. a TEST_DATABASE_URL that IS the application database is rejected — also through aliases and credential/parameter changes", () => {
    const sameTarget = [
      APP_URL,
      "postgres://appuser:APP-SECRET-pw@localhost:5432/ai_investment_copilot?sslmode=disable",
      "postgres://someone:else@localhost/ai_investment_copilot", // default port
      "postgresql://appuser:x@LOCALHOST:5432/ai_investment_copilot", // scheme + case
      "postgres://appuser:x@127.0.0.1:5432/ai_investment_copilot", // loopback alias
      "postgres://appuser:x@[::1]:5432/ai_investment_copilot",
      "postgres://appuser:x@localhost:5432/ai_investment_copilot?options=-c%20search_path%3Dpublic",
      "postgres://appuser:x@localhost:5432/ai%5Finvestment%5Fcopilot", // percent-encoded name
      `  ${APP_URL}  `,
    ];
    for (const testUrl of sameTarget) {
      const v = evaluate(testUrl);
      expect(v.ok, testUrl.replace(/:[^:@/]+@/, ":***@")).toBe(false);
      expect(reasonOf(v)).toMatch(/same database/);
    }
  });

  it("malformed / non-postgres / nameless URLs are rejected without echoing them", () => {
    for (const testUrl of ["not a url", "mysql://u:p@localhost/db", "http://localhost/db", "postgres://u:p@localhost:5432", "postgres://u:p@localhost:5432/", "postgres:///db"]) {
      expect(evaluate(testUrl).ok, testUrl).toBe(false);
    }
  });

  it("D (config layer). a different database on the same server, or the same name on another server/port, is a candidate — the marker still decides", () => {
    expect(evaluate("postgres://appuser:x@localhost:5432/aic_test_1")).toEqual({ ok: true, databaseName: "aic_test_1" });
    expect(evaluate("postgres://appuser:x@db.example.internal:5432/ai_investment_copilot")).toEqual({ ok: true, databaseName: "ai_investment_copilot" });
    expect(evaluate("postgres://appuser:x@localhost:5544/ai_investment_copilot")).toEqual({ ok: true, databaseName: "ai_investment_copilot" });
    // no application URL configured at all (fresh CI): still only a candidate
    expect(evaluate("postgres://u:p@localhost:5432/aic_test_1", undefined).ok).toBe(true);
  });
});

describe("checkDatabaseIdentity — what the connected database says about itself, never its name", () => {
  const marked = (name: string) => ({ name, marker: TEST_DATABASE_MARKER });

  it("D. the exact marker on the expected database authorizes", () => {
    expect(checkDatabaseIdentity(marked("aic_test_1"), "aic_test_1")).toEqual({ ok: true, databaseName: "aic_test_1" });
  });

  it("E. misleading names authorize nothing: 'test', 'scratch', 'aic_test_…' WITHOUT the marker are all rejected", () => {
    for (const name of ["test", "scratch", "aic_test_real", "aic_scratch_test", "ai_investment_copilot_test", "TEST_DATABASE", "ai_investment_copilot"]) {
      const v = checkDatabaseIdentity({ name, marker: null }, name);
      expect(v.ok, name).toBe(false);
      expect(v.ok ? "" : v.reason).toMatch(/marker/);
    }
  });

  it("E. only the EXACT marker counts: near-misses, another product's marker, empty string", () => {
    for (const marker of ["", "test", "ai-investment-copilot:test-database", `${TEST_DATABASE_MARKER} `, ` ${TEST_DATABASE_MARKER}`, TEST_DATABASE_MARKER.toUpperCase(), "ai-investment-copilot:test-database:v2"]) {
      expect(checkDatabaseIdentity({ name: "aic_test_1", marker }, "aic_test_1").ok, JSON.stringify(marker)).toBe(false);
    }
  });

  it("a connection that lands on a different database than the URL named (proxy/pooler surprise) is rejected even with the marker", () => {
    const v = checkDatabaseIdentity(marked("something_else"), "aic_test_1");
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.reason).toMatch(/differs/);
    expect(checkDatabaseIdentity(undefined, "aic_test_1").ok).toBe(false);
  });
});

describe("H. failure output never exposes a connection string, host, user or password", () => {
  const SECRET = "TEST-SECRET-pw-4471";
  const scrubbed = (text: string) => {
    for (const forbidden of [SECRET, "secretuser", "secret-host"]) expect(text, forbidden).not.toContain(forbidden);
    // naming the expected FORMAT ("a valid postgres:// URL") is fine; an actual URL (scheme + content) is not
    expect(text).not.toMatch(/postgres(ql)?:\/\/\S/);
  };

  it("config rejections", () => {
    const urls = [
      `postgres://secretuser:${SECRET}@secret-host.invalid:5432/ai_investment_copilot`,
      `mysql://secretuser:${SECRET}@secret-host.invalid/db`,
      `postgres://secretuser:${SECRET}@secret-host.invalid:5432`,
    ];
    for (const testUrl of urls) {
      const v = evaluate(testUrl, `postgres://secretuser:${SECRET}@secret-host.invalid:5432/ai_investment_copilot`);
      scrubbed(reasonOf(v));
    }
  });

  it("an unreachable test database (the driver error would name host/user) is reported by error code only", async () => {
    const err = await authorizeTestDatabase(`postgres://secretuser:${SECRET}@secret-host.invalid:5432/aic_test_1`, APP_URL).catch((e) => e);
    expect(err).toBeInstanceOf(TestDatabaseNotAuthorizedError);
    expect(err.message).toMatch(/could not connect to the test database/);
    scrubbed(err.message);
    scrubbed(String(err.stack ?? "").split("\n")[0] ?? "");
  }, 30_000);

  it("a same-database rejection happens before any connection attempt (no driver involved)", async () => {
    const err = await authorizeTestDatabase(APP_URL, APP_URL).catch((e) => e);
    expect(err).toBeInstanceOf(TestDatabaseNotAuthorizedError);
    expect(err.message).toMatch(/same database/);
    scrubbed(err.message);
    expect(err.message).not.toContain("APP-SECRET-pw");
  });
});

describe("the pinned 'unconfigured' URL", () => {
  it("can never reach a database: reserved .invalid host, dummy credentials", () => {
    const url = new URL(UNCONFIGURED_TEST_DATABASE_URL);
    expect(url.hostname.endsWith(".invalid")).toBe(true);
    expect(`${url.username}:${url.password}`).toBe("test:test");
    expect(evaluate(UNCONFIGURED_TEST_DATABASE_URL).ok).toBe(true); // it is a syntactically valid candidate...
    expect(UNCONFIGURED_TEST_DATABASE_URL).not.toMatch(/localhost|127\.0\.0\.1/); // ...that points nowhere real
  });

  it("isIntegrationTestPath recognises DB-backed test files on both path styles", () => {
    expect(isIntegrationTestPath("C:\\dev\\x\\tests\\integration\\a.test.ts")).toBe(true);
    expect(isIntegrationTestPath("/repo/tests/integration/a.test.ts")).toBe(true);
    expect(isIntegrationTestPath("/repo/tests/unit/a.test.ts")).toBe(false);
    expect(isIntegrationTestPath(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// I/J. Structural: nothing in the test tree can reach a database except
// through the pinned process.env.DATABASE_URL.
// ---------------------------------------------------------------------
describe("structural bypass checks", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const testFiles = walk("tests").filter((f) => /\.tsx?$/.test(f));
  const isGuardFile = (f: string) => /tests[\\/](support|setup\.ts)/.test(f) || /test-database-(guard|fail-closed)\.test\.ts$/.test(f);
  const other = testFiles.filter((f) => !isGuardFile(f));

  it("every test that opens a connection uses process.env.DATABASE_URL (which setup pins) — never a literal, never TEST_DATABASE_URL directly", () => {
    const offenders: string[] = [];
    let connections = 0;
    for (const file of other) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/\bpostgres\(\s*([^,)]*)/g)) {
        connections++;
        if (m[1]!.trim() !== "process.env.DATABASE_URL!") offenders.push(`${file}: postgres(${m[1]!.trim()})`);
      }
      if (/postgres(ql)?:\/\//.test(code)) offenders.push(`${file}: connection-string literal`);
      if (/TEST_DATABASE_URL/.test(code)) offenders.push(`${file}: reads TEST_DATABASE_URL directly`);
    }
    expect(connections).toBeGreaterThan(10); // the scan really saw the integration suites
    expect(offenders).toEqual([]);
  });

  it("the guard is actually wired: vitest.config.ts runs the global setup, setup.ts pins DATABASE_URL and gates integration files", () => {
    const config = stripComments(readFileSync("vitest.config.ts", "utf8"));
    expect(config).toMatch(/globalSetup:\s*\[\s*"\.\/tests\/support\/global-setup\.ts"\s*\]/);
    expect(config).toMatch(/setupFiles:\s*\[\s*"\.\/tests\/setup\.ts"\s*\]/);

    const setup = stripComments(readFileSync("tests/setup.ts", "utf8"));
    expect(setup).toMatch(/process\.env\.DATABASE_URL\s*=\s*testDatabase\.state === "authorized" \? testDatabase\.url : UNCONFIGURED_TEST_DATABASE_URL/);
    expect(setup).toMatch(/isIntegrationTestPath/);

    const globalSetup = stripComments(readFileSync("tests/support/global-setup.ts", "utf8"));
    // authorization precedes migration precedes pinning — and an unauthorized config throws (no catch)
    const order = ["authorizeTestDatabase(", "migrate(", "process.env.DATABASE_URL = testUrl"].map((s) => globalSetup.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(globalSetup).not.toMatch(/catch\s*\(/);
    // DATABASE_URL is pinned on BOTH branches (unconfigured -> unreachable URL, authorized -> the verified URL)
    expect(globalSetup.match(/process\.env\.DATABASE_URL\s*=/g)?.length).toBe(2);
    expect(globalSetup).toMatch(/process\.env\.DATABASE_URL = UNCONFIGURED_TEST_DATABASE_URL/);
  });

  it("the application code never imports the test-support guard, and the guard never imports application code", () => {
    for (const file of walk("src").filter((f) => /\.tsx?$/.test(f))) expect(readFileSync(file, "utf8"), file).not.toMatch(/tests\/support|test-database/);
    for (const file of walk("tests/support")) expect(readFileSync(file, "utf8"), file).not.toMatch(/from "@\/(?!db\/)/);
  });

  it("the ordinary commands are the safe ones: `npm test` has no way to opt out of the guard", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts["test:unit"]).toBe("vitest run tests/unit");
    for (const name of ["test", "test:unit", "test:watch"]) expect(pkg.scripts[name], name).not.toMatch(/DATABASE_URL|--config|--globalSetup|--no-/);
  });
});
