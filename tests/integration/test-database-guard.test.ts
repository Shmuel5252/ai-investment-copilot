import { spawn } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  authorizeTestDatabase,
  checkDatabaseIdentity,
  readDatabaseIdentity,
  TEST_DATABASE_MARKER,
  TestDatabaseNotAuthorizedError,
} from "../support/test-database";

// Test DB Safety — the connected-database side. This file only ever runs
// after the global setup authorized the database (otherwise setup.ts fails
// it before the first hook), so reaching here already proves the guard let an
// authorized, marked database through.

const authorized = inject("testDatabase");
const url = process.env.DATABASE_URL!;
const client = postgres(url, { max: 2 });
function runDropTool(name: string): Promise<{ code: number | null; out: string }> {
  const env = { ...process.env, DATABASE_URL: url } as NodeJS.ProcessEnv; // the pinned test URL: same server, never the application database
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "tests/support/create-test-db.ts", "drop", name], { cwd: process.cwd(), env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}
const sibling = (database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("the authorized test database", () => {
  it("D. is what the run was pinned to: DATABASE_URL is the verified test URL, and the server agrees on its name and marker", async () => {
    expect(authorized.state).toBe("authorized");
    if (authorized.state !== "authorized") return;
    expect(process.env.DATABASE_URL).toBe(authorized.url);

    const identity = await readDatabaseIdentity(client);
    expect(identity).toEqual({ name: authorized.name, marker: TEST_DATABASE_MARKER });
    expect(checkDatabaseIdentity(identity, authorized.name)).toEqual({ ok: true, databaseName: authorized.name });
  });

  it("D. authorizeTestDatabase accepts it end to end (config + connection + marker)", async () => {
    await expect(authorizeTestDatabase(url, undefined)).resolves.toEqual({ databaseName: (await readDatabaseIdentity(client))!.name });
  });

  it("B. ...and refuses the very same URL when it is also the application database (rejected before connecting)", async () => {
    const err = await authorizeTestDatabase(url, url).catch((e) => e);
    expect(err).toBeInstanceOf(TestDatabaseNotAuthorizedError);
    expect(err.message).toMatch(/same database/);
    expect(err.message).not.toContain(new URL(url).password || "\u0000never");
  });

  it("E. the server's maintenance database ('postgres') is reachable from here yet NOT authorized: no marker, whatever its name", async (ctx) => {
    const maintenance = postgres(sibling("postgres"), { max: 1, connect_timeout: 5 });
    try {
      const identity = await readDatabaseIdentity(maintenance).catch(() => "unreachable" as const);
      if (identity === "unreachable") return ctx.skip(true, "maintenance database not reachable with these credentials");
      // (Postgres gives this database its own default description — an exact-match marker is unaffected by that.)
      expect(identity!.marker).not.toBe(TEST_DATABASE_MARKER);
      expect(checkDatabaseIdentity(identity, "postgres").ok).toBe(false);
    } finally {
      await maintenance.end({ timeout: 2 });
    }
    const err = await authorizeTestDatabase(sibling("postgres"), undefined).catch((e) => e);
    expect(err).toBeInstanceOf(TestDatabaseNotAuthorizedError);
    expect(err.message).toMatch(/marker/);
  });

  it("E. a database whose NAME says test/scratch but that carries no marker is refused end to end (created here, dropped in finally)", async (ctx) => {
    const name = `aic_test_scratch_unmarked_${Date.now()}`;
    const maintenance = postgres(sibling("postgres"), { max: 1, connect_timeout: 5 });
    try {
      try {
        await maintenance.unsafe(`CREATE DATABASE "${name}"`);
      } catch {
        return ctx.skip(true, "cannot create a database with these credentials");
      }
      const err = await authorizeTestDatabase(sibling(name), undefined).catch((e) => e);
      expect(err).toBeInstanceOf(TestDatabaseNotAuthorizedError);
      expect(err.message).toMatch(/does not carry the test-database marker/);
      expect(err.message).toContain(name); // the database NAME may be shown; nothing else about the connection
      expect(err.message).not.toContain(new URL(url).password || "\u0000never");

      // Marking it explicitly (what `npm run db:test:create` does) is what authorizes it — not the name.
      await maintenance.unsafe(`COMMENT ON DATABASE "${name}" IS '${TEST_DATABASE_MARKER}'`);
      await expect(authorizeTestDatabase(sibling(name), undefined)).resolves.toEqual({ databaseName: name });
    } finally {
      await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
      await maintenance.end({ timeout: 2 });
    }
  });

  it("db:test:drop refuses a database without the marker (it still exists afterwards) and drops one that has it", async (ctx) => {
    const name = `aic_test_drop_probe_${Date.now()}`;
    const maintenance = postgres(sibling("postgres"), { max: 1, connect_timeout: 5 });
    const exists = async () => (await maintenance`select 1 from pg_database where datname = ${name}`).length === 1;
    try {
      try {
        await maintenance.unsafe(`CREATE DATABASE "${name}"`);
      } catch {
        return ctx.skip(true, "cannot create a database with these credentials");
      }
      const refused = await runDropTool(name);
      expect(refused.code).not.toBe(0);
      expect(refused.out).toMatch(/does not carry the test-database marker/);
      expect(await exists()).toBe(true);

      await maintenance.unsafe(`COMMENT ON DATABASE "${name}" IS '${TEST_DATABASE_MARKER}'`);
      const dropped = await runDropTool(name);
      expect(dropped.code).toBe(0);
      expect(await exists()).toBe(false);
    } finally {
      await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => {});
      await maintenance.end({ timeout: 2 });
    }
  }, 60_000);
});
