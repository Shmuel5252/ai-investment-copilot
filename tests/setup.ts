import "dotenv/config";
import "@testing-library/jest-dom/vitest";
import { beforeAll, expect, inject, vi } from "vitest";
import { isIntegrationTestPath, NOT_CONFIGURED_MESSAGE, UNCONFIGURED_TEST_DATABASE_URL } from "./support/test-database";

// Test DB Safety (tests/support/test-database.ts, tests/support/global-setup.ts).
// `dotenv/config` above may have just loaded the APPLICATION's DATABASE_URL
// from .env into this worker. Overwrite it, before any test file is
// imported, with either the verified test database or an unreachable URL —
// so no test code (including raw `postgres(process.env.DATABASE_URL!)`) can
// ever reach the application's database.
const testDatabase = inject("testDatabase");
process.env.DATABASE_URL = testDatabase.state === "authorized" ? testDatabase.url : UNCONFIGURED_TEST_DATABASE_URL;

// Test AI Safety: `dotenv/config` above may also have loaded the REAL
// ANTHROPIC_API_KEY. No test may reach the real API — replace the key with an
// inert placeholder and replace the SDK itself, for every test file, with a
// client whose every call rejects. A test that needs AI output mocks its
// boundary explicitly (vi.mock("@/lib/ai/<module>") or "@/lib/ai/client"),
// which sits above this guard and is unaffected by it.
process.env.ANTHROPIC_API_KEY = "test-placeholder-not-a-real-key";
delete process.env.ANTHROPIC_BASE_URL;
vi.mock("@anthropic-ai/sdk", () => {
  class BlockedAnthropic {
    messages = {
      create: async () => {
        throw new Error("Real AI call blocked in tests — mock the AI boundary explicitly.");
      },
    };
  }
  return { default: BlockedAnthropic, Anthropic: BlockedAnthropic };
});

beforeAll(() => {
  if (testDatabase.state === "authorized") return;
  if (isIntegrationTestPath(expect.getState().testPath)) throw new Error(NOT_CONFIGURED_MESSAGE);
});
