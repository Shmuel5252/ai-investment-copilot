import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Node, not jsdom, by default: this is a backend-heavy app (DB,
    // repositories, AI orchestration, import parsing) with no React
    // component tests yet. The Anthropic SDK actively refuses to
    // initialize under jsdom's browser-like globals (a real safety
    // check against leaking API keys client-side) — respecting that
    // rather than working around it. Add `// @vitest-environment jsdom`
    // as the first line of a future component test file to opt back in
    // per-file.
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    // Generous default: this repo lives under a OneDrive-synced folder,
    // and OneDrive's background sync/indexing over node_modules'
    // tens of thousands of files causes real, occasional multi-second
    // CPU starvation unrelated to the code under test (see README's
    // "Known environment issue" note). 5s (vitest's default) is too
    // tight here; a genuine infinite loop still gets caught well before
    // this.
    testTimeout: 20_000,
  },
});
