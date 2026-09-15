import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseIdentityMatchResponse, type HypothesisMatchCandidate } from "@/lib/ai/dna-identity";

const candidates: HypothesisMatchCandidate[] = [
  { id: "existing-1", statementText: "You are cautious about using leverage without conviction." },
  { id: "existing-2", statementText: "You hold winners as long as they keep climbing." },
];

describe("parseIdentityMatchResponse (pure, no network call)", () => {
  it("returns the matched id when it's a real candidate", () => {
    const result = parseIdentityMatchResponse(
      { type: "tool_use", input: { matchedId: "existing-1", reason: "same claim" } },
      candidates
    );
    expect(result).toEqual({ matchedId: "existing-1", reason: "same claim" });
  });

  it("returns null (new identity) for the NONE sentinel", () => {
    const result = parseIdentityMatchResponse(
      { type: "tool_use", input: { matchedId: "NONE", reason: "distinct claim" } },
      candidates
    );
    expect(result.matchedId).toBeNull();
  });

  it("fails closed to a new identity when there is no tool_use block", () => {
    const result = parseIdentityMatchResponse(undefined, candidates);
    expect(result.matchedId).toBeNull();
  });

  it("fails closed to a new identity when the response is malformed", () => {
    const result = parseIdentityMatchResponse({ type: "tool_use", input: { reason: "no matchedId field" } }, candidates);
    expect(result.matchedId).toBeNull();
  });

  it("fails closed to a new identity when the model names an id that was never offered", () => {
    const result = parseIdentityMatchResponse(
      { type: "tool_use", input: { matchedId: "invented-id-not-in-list", reason: "hallucinated" } },
      candidates
    );
    expect(result.matchedId).toBeNull();
  });

  it("with an empty candidate list, an offered id can never be valid — anything but NONE fails closed", () => {
    const result = parseIdentityMatchResponse(
      { type: "tool_use", input: { matchedId: "existing-1", reason: "x" } },
      []
    );
    expect(result.matchedId).toBeNull();
  });
});

vi.mock("@/lib/ai/client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));

describe("classifyHypothesisMatch — exception path fails closed to a new identity (mocked client, no real API call)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when the underlying API call throws", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network error"));
    const { classifyHypothesisMatch } = await import("@/lib/ai/dna-identity");

    const result = await classifyHypothesisMatch("A new proposed statement.", candidates);
    expect(result.matchedId).toBeNull();
  });

  it("short-circuits with no API call at all when there are no candidates", async () => {
    const { anthropic } = await import("@/lib/ai/client");
    const { classifyHypothesisMatch } = await import("@/lib/ai/dna-identity");

    const result = await classifyHypothesisMatch("A new proposed statement.", []);
    expect(result.matchedId).toBeNull();
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });
});
