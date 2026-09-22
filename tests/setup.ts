import "dotenv/config";
import "@testing-library/jest-dom/vitest";
import { beforeAll, expect, inject } from "vitest";
import { isIntegrationTestPath, NOT_CONFIGURED_MESSAGE, UNCONFIGURED_TEST_DATABASE_URL } from "./support/test-database";

// Test DB Safety (tests/support/test-database.ts, tests/support/global-setup.ts).
// `dotenv/config` above may have just loaded the APPLICATION's DATABASE_URL
// from .env into this worker. Overwrite it, before any test file is
// imported, with either the verified test database or an unreachable URL —
// so no test code (including raw `postgres(process.env.DATABASE_URL!)`) can
// ever reach the application's database.
const testDatabase = inject("testDatabase");
process.env.DATABASE_URL = testDatabase.state === "authorized" ? testDatabase.url : UNCONFIGURED_TEST_DATABASE_URL;

beforeAll(() => {
  if (testDatabase.state === "authorized") return;
  if (isIntegrationTestPath(expect.getState().testPath)) throw new Error(NOT_CONFIGURED_MESSAGE);
});
