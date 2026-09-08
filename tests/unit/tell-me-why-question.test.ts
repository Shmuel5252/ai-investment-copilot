import { describe, expect, it } from "vitest";
import { buildTellMeWhyQuestion } from "@/lib/interview/tell-me-why-question";

// Proves the question is deterministic code, not an AI call: this test
// calls the real exported function synchronously (no await needed on its
// return value — a Promise would fail a strict-equality string
// assertion immediately, since promises never equal strings) and gets a
// plain string back every time for the same input. No mock is needed to
// "prove" no Anthropic call happened, because the source file itself
// (src/lib/interview/tell-me-why-question.ts) never imports the
// Anthropic client at all — verifiable by reading that one small file,
// same reasoning already applied to validateDecisionSynthesis's call
// site (docs/backlog.md).
describe("buildTellMeWhyQuestion", () => {
  it("returns a plain string synchronously, not a Promise", () => {
    const result = buildTellMeWhyQuestion("MP");
    expect(typeof result).toBe("string");
  });

  it("includes the given ticker in the question", () => {
    expect(buildTellMeWhyQuestion("MP")).toContain("MP");
  });

  it("is deterministic — the same ticker always produces the exact same question", () => {
    expect(buildTellMeWhyQuestion("MP")).toBe(buildTellMeWhyQuestion("MP"));
  });

  it("produces a different question text for a different ticker, still containing it", () => {
    const mp = buildTellMeWhyQuestion("MP");
    const aapl = buildTellMeWhyQuestion("AAPL");
    expect(mp).not.toBe(aapl);
    expect(aapl).toContain("AAPL");
  });

  it("invites the full lifecycle (entry, holding, exit), not just \"why did you buy\"", () => {
    const question = buildTellMeWhyQuestion("MP");
    // Loose content check on the real Hebrew template — not asserting
    // exact wording here (that's the toBe() determinism test above),
    // just that the template covers more than entry alone.
    expect(question).toMatch(/נכנסת/);
    expect(question).toMatch(/לצאת|לממש/);
  });
});
