import "dotenv/config";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { TestProject } from "vitest/node";
import { authorizeTestDatabase, UNCONFIGURED_TEST_DATABASE_URL } from "./test-database";

// Runs ONCE in the main vitest process, before any worker starts and before
// any test file is imported. See tests/support/test-database.ts for the
// authorization rules.
//
//   TEST_DATABASE_URL unset   -> nothing authorized. DATABASE_URL is pinned to
//                                an unreachable URL, so unit tests run and any
//                                DB-backed test fails closed (setup.ts).
//   set but not authorized    -> this throws: the whole run aborts before a
//                                single test executes. A configured-but-wrong
//                                target is never ignored.
//   set and authorized        -> pending migrations are applied to that test
//                                database (only after it proved itself a test
//                                database) and DATABASE_URL is pinned to it.
//
// Either way the application's DATABASE_URL (.env) stops being visible to the
// workers, which inherit this process's environment.
export default async function setup(project: TestProject) {
  const appUrl = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL?.trim();

  if (!testUrl) {
    process.env.DATABASE_URL = UNCONFIGURED_TEST_DATABASE_URL;
    project.provide("testDatabase", { state: "unconfigured" });
    return;
  }

  const { databaseName } = await authorizeTestDatabase(testUrl, appUrl);

  const migrationClient = postgres(testUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }

  process.env.DATABASE_URL = testUrl;
  project.provide("testDatabase", { state: "authorized", url: testUrl, name: databaseName });
  console.log(`[test-db] authorized test database "${databaseName}" (migrations applied); the application DATABASE_URL is not used`);
}
