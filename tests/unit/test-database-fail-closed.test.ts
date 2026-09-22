import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Test DB Safety, end to end: real, nested `vitest run` processes started with
// the SAME vitest.config.ts / global setup / setup file a developer gets.
// Every child is given ONLY inert connection URLs (reserved `.invalid` hosts)
// as its "application" and "test" databases, so even a broken guard could not
// reach any database — what is asserted is that each configuration is
// refused before a single test executes, with no credential in the output.

const root = process.cwd();
const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
const APP_URL = "postgres://appuser:APP-SECRET-pw-9131@app-host.invalid:5432/app_real";

interface Outcome {
  code: number | null;
  out: string;
}

// TEST_DATABASE_URL: undefined = not in the child's environment at all (empty string = present but blank).
function runVitest(files: string[], env: { DATABASE_URL: string; TEST_DATABASE_URL: string | undefined }): Promise<Outcome> {
  const childEnv = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("VITEST") && key !== "DATABASE_URL" && key !== "TEST_DATABASE_URL") childEnv[key] = value;
  Object.assign(childEnv, { DATABASE_URL: env.DATABASE_URL, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" });
  if (env.TEST_DATABASE_URL !== undefined) childEnv.TEST_DATABASE_URL = env.TEST_DATABASE_URL;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestCli, "run", ...files], { cwd: root, env: childEnv });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out: out.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

const noSecrets = (out: string) => {
  for (const forbidden of ["APP-SECRET-pw-9131", "appuser", "app-host", "TEST-SECRET-pw-2208", "testuser", "test-host"]) expect(out, forbidden).not.toContain(forbidden);
};
const noTestExecuted = (out: string) => {
  expect(out).not.toMatch(/Test Files\s+\d+ passed/);
  expect(out).not.toMatch(/✓/);
};

function runCreateTool(args: string[], databaseUrl: string): Promise<Outcome> {
  const childEnv = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("VITEST") && key !== "DATABASE_URL" && key !== "TEST_DATABASE_URL") childEnv[key] = value;
  childEnv.DATABASE_URL = databaseUrl;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "tests/support/create-test-db.ts", ...args], { cwd: root, env: childEnv });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe.concurrent("db:test:create / db:test:drop can never be pointed at the application or maintenance database", () => {
  // The URL is inert (.invalid): these refusals happen BEFORE any connection, and even a broken refusal could not reach a database.
  it("refuses to create or drop the application database's name, and the maintenance database", async () => {
    for (const args of [["create", "app_real"], ["drop", "app_real"], ["drop", "postgres"], ["create", "postgres"]]) {
      const { code, out } = await runCreateTool(args, APP_URL);
      expect(code, args.join(" ")).not.toBe(0);
      expect(out, args.join(" ")).toMatch(/refusing to touch/);
      noSecrets(out);
    }
  }, 120_000);

  it("rejects names that are not plain lower-case identifiers (no quoting tricks reach the DDL)", async () => {
    for (const name of ['x"; DROP DATABASE app_real; --', "Has-Caps", "ab", "1starts_with_digit", "a b"]) {
      const { code, out } = await runCreateTool(["create", name], APP_URL);
      expect(code, name).not.toBe(0);
      expect(out, name).toMatch(/database name must match/);
      noSecrets(out);
    }
  }, 120_000);

  it("failure output never carries the connection details (unreachable server)", async () => {
    const { code, out } = await runCreateTool(["create", "aic_test_never_created"], APP_URL);
    expect(code).not.toBe(0);
    expect(out).toMatch(/db:test failed/);
    noSecrets(out);
  }, 120_000);
});

describe.concurrent("a plain `vitest run` cannot reach a database it was not explicitly authorized for", () => {
  it("A/C/I. no TEST_DATABASE_URL: a DB-backed test file FAILS CLOSED with the how-to message — the application DATABASE_URL is not a fallback", async () => {
    const { code, out } = await runVitest(["tests/integration/manual-entry.test.ts"], { DATABASE_URL: APP_URL, TEST_DATABASE_URL: "" });
    expect(code).not.toBe(0);
    expect(out).toMatch(/DB-backed tests are blocked/);
    expect(out).toMatch(/TEST_DATABASE_URL/);
    expect(out).not.toMatch(/Tests\s+\d+ passed/);
    noSecrets(out);
  }, 120_000);

  it("A/C/I. ...even when TEST_DATABASE_URL is absent from the environment entirely (not just empty)", async (ctx) => {
    // .env is loaded by the global setup too: a developer who keeps TEST_DATABASE_URL there has (legitimately) configured one.
    if (existsSync(".env") && /^\s*TEST_DATABASE_URL\s*=/m.test(readFileSync(".env", "utf8"))) return ctx.skip(true, ".env defines TEST_DATABASE_URL");
    const { code, out } = await runVitest(["tests/integration/decisions-repository.test.ts"], { DATABASE_URL: APP_URL, TEST_DATABASE_URL: undefined });
    expect(code).not.toBe(0);
    expect(out).toMatch(/DB-backed tests are blocked/);
    noSecrets(out);
  }, 120_000);

  it("B. TEST_DATABASE_URL equal to the application database (different credentials) aborts the whole run before any test", async () => {
    const { code, out } = await runVitest(["tests/integration/manual-entry.test.ts"], {
      DATABASE_URL: APP_URL,
      TEST_DATABASE_URL: "postgres://testuser:TEST-SECRET-pw-2208@APP-HOST.invalid:5432/app_real?sslmode=disable",
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/Test database NOT authorized/);
    expect(out).toMatch(/same database/);
    noTestExecuted(out);
    noSecrets(out);
  }, 120_000);

  it("H. an unreachable / unverifiable TEST_DATABASE_URL aborts before any test and leaks neither password, user nor host", async () => {
    const { code, out } = await runVitest(["tests/integration/manual-entry.test.ts"], {
      DATABASE_URL: APP_URL,
      TEST_DATABASE_URL: "postgres://testuser:TEST-SECRET-pw-2208@test-host.invalid:5432/aic_test_x",
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/Test database NOT authorized/);
    expect(out).toMatch(/could not connect/);
    noTestExecuted(out);
    noSecrets(out);
  }, 120_000);

  it("H. a malformed TEST_DATABASE_URL is rejected without being echoed", async () => {
    const { code, out } = await runVitest(["tests/integration/manual-entry.test.ts"], {
      DATABASE_URL: APP_URL,
      TEST_DATABASE_URL: "mysql://testuser:TEST-SECRET-pw-2208@test-host.invalid/db",
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/not a valid postgres/);
    noTestExecuted(out);
    noSecrets(out);
  }, 120_000);

  it("F. pure unit tests need no database configuration at all — they run and pass with nothing authorized", async () => {
    const { code, out } = await runVitest(["tests/unit/link-facts.test.ts"], { DATABASE_URL: APP_URL, TEST_DATABASE_URL: "" });
    expect(out).toMatch(/Test Files\s+1 passed/);
    expect(code).toBe(0);
    noSecrets(out);
  }, 120_000);
});
