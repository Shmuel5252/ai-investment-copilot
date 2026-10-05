import { describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { AI_MAX_RETRIES, AI_TIMEOUT_MS } from "@/lib/ai/client";
import { publicProcedure, router } from "@/server/trpc";

// Unit 3B: the shared client carries an explicit timeout and retry count, and
// a timeout reaches the user as a clear message, not the SDK's generic one.
const constructed = vi.hoisted(() => [] as unknown[]);
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    constructor(opts: unknown) {
      constructed.push(opts);
    }
  }
  class APIConnectionTimeoutError extends Error {}
  return { default: Anthropic, Anthropic, APIConnectionTimeoutError };
});

async function call(path: string, thrown: Error): Promise<{ message: string }> {
  const [ns, name] = path.split(".") as [string, string];
  const appRouter = router({
    [ns]: router({
      [name]: publicProcedure.mutation(() => {
        throw thrown;
      }),
    }),
  });
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    router: appRouter,
    createContext: () => ({ session: {} as never }),
  });
  return (await res.json()).error;
}

describe("AI client timeout policy", () => {
  it("creates the client with a 5-minute timeout and one retry", () => {
    expect(AI_TIMEOUT_MS).toBe(300_000);
    expect(AI_MAX_RETRIES).toBe(1);
    expect(constructed).toEqual([expect.objectContaining({ timeout: 300_000, maxRetries: 1 })]);
  });

  it("turns a timeout into a clear message for a step that saves nothing", async () => {
    const error = await call("dna.generate", new APIConnectionTimeoutError());
    expect(error.message).toBe("AI call timed out (limit: 5 minutes per attempt, 1 retry); nothing was saved by this step.");
  });

  it("says what may already be saved when the step writes before finishing", async () => {
    const error = await call("learning.generate", new APIConnectionTimeoutError());
    expect(error.message).toMatch(/^AI call timed out \(limit: 5 minutes per attempt, 1 retry\); insights .* may already have been saved/);
  });

  it("leaves other errors untouched", async () => {
    const error = await call("dna.generate", new Error("boom"));
    expect(error.message).toBe("boom");
  });
});
