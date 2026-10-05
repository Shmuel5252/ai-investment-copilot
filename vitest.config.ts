import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const shared = {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
};

// Options the root and both projects use (see `projects` below for why the
// projects repeat them instead of extending the root).
const commonTest = {
  // Node, not jsdom, by default: this is a backend-heavy app (DB,
  // repositories, AI orchestration, import parsing) with no React
  // component tests yet. The Anthropic SDK actively refuses to
  // initialize under jsdom's browser-like globals (a real safety
  // check against leaking API keys client-side) — respecting that
  // rather than working around it. Add `// @vitest-environment jsdom`
  // as the first line of a future component test file to opt back in
  // per-file.
  environment: "node" as const,
  setupFiles: ["./tests/setup.ts"],
  globals: true,
  exclude: ["node_modules", ".next", "tests/e2e/**/*"],
  // Generous default: this repo lives under a OneDrive-synced folder,
  // and OneDrive's background sync/indexing over node_modules'
  // tens of thousands of files causes real, occasional multi-second
  // CPU starvation unrelated to the code under test (see README's
  // "Known environment issue" note). 5s (vitest's default) is too
  // tight here; a genuine infinite loop still gets caught well before
  // this.
  testTimeout: 20_000,
};

export default defineConfig({
  ...shared,
  test: {
    ...commonTest,
    // Test DB Safety: authorizes TEST_DATABASE_URL (or pins an unreachable
    // DATABASE_URL) once, before any worker or test file starts. The
    // application's DATABASE_URL (.env) is never visible to tests.
    globalSetup: ["./tests/support/global-setup.ts"],
    // Two projects, one global setup. Unit tests are pure and run in
    // parallel. Integration files all share ONE test database and assert on
    // whole-table counts, so they must never run in parallel with each other
    // (a parallel run produced timeouts and count mismatches); the unit
    // project touches no database, so the two may overlap. A plain `npm test`
    // therefore needs no extra flags.
    //
    // The projects deliberately do NOT `extends` this config: that would
    // re-run `globalSetup` once per project, and the second run would see the
    // DATABASE_URL the first one pinned and refuse it as "the application
    // database". So `globalSetup` lives only here.
    projects: [
      { ...shared, test: { ...commonTest, name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"] } },
      { ...shared, test: { ...commonTest, name: "integration", include: ["tests/integration/**/*.test.{ts,tsx}"], fileParallelism: false } },
    ],
  },
});
