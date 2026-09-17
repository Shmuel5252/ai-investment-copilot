// Strategy Grounding — tested with an INJECTED, deterministic grounding
// function, never a real Anthropic call (same convention as
// ground-evidence.test.ts). groundValidatedObservedPrinciples() itself —
// the real production loop, filtering, and recomputation — is what's
// under test; it calls straight through to the real
// countIndependentCases()/calculateEvidenceStrength(), never a test-only
// reimplementation of either.
import { describe, expect, it } from "vitest";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import type { ValidatedObservedPrinciple } from "@/lib/strategy/validate-principles";

function principle(statement: string, evidence: ValidatedObservedPrinciple["evidence"]): ValidatedObservedPrinciple {
  return {
    statement,
    evidence,
    supportingCount: evidence.length,
    contradictingCount: 0,
    evidenceStrength: "insufficient_evidence",
  };
}

describe("groundValidatedObservedPrinciples", () => {
  it("supporting citation that genuinely establishes the claim is accepted", async () => {
    const principles = [
      principle("Avoids leveraged instruments without concrete supporting information.", [
        { interviewAnswerId: "a1", stance: "supporting", description: "closed a leveraged trade after one day" },
      ]),
    ];
    const checkGrounding = async () => ({ verdict: "supported" as const, reason: "matches" });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([["a1", "text"]]),
      new Map([["a1", "X#1"]]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(1);
    expect(result.principles[0]?.supportingCount).toBe(1);
    expect(result.droppedPrinciples).toEqual([]);
  });

  it("supporting citation that does not genuinely establish the claim is rejected and excluded from counts", async () => {
    const principles = [
      principle("Sells a profitable position for a more attractive opportunity, thesis intact.", [
        { interviewAnswerId: "a1", stance: "supporting", description: "overclaimed description" },
      ]),
    ];
    const checkGrounding = async () => ({
      verdict: "unsupported" as const,
      reason: "describes selling a losing position, not a profitable one",
    });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([["a1", "declining stock text"]]),
      new Map([["a1", "X#1"]]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(0);
    expect(result.droppedPrinciples).toEqual(["Sells a profitable position for a more attractive opportunity, thesis intact."]);
    expect(result.excluded).toHaveLength(1);
  });

  // The critical contradicting-evidence regression (diagnostic citation
  // d29a3897's semantic shape) — NOT the real investor's answer or a
  // hard-coded verdict, a generic fixture proving the ORCHESTRATOR
  // correctly accepts a contradicting citation whose source shows a
  // behavioral counter-example without describing an alternative motive.
  // The grounding rubric text itself (checkEvidenceGrounding's own
  // system prompt) requires exactly this: "genuinely showing the investor
  // did the opposite, or something clearly inconsistent with it" — never
  // requiring the source to also state a motive. This test proves the
  // orchestration layer doesn't second-guess or reverse that verdict, not
  // that any particular real citation should or shouldn't ground.
  it("a genuine behavioral counter-example is accepted as contradicting evidence even without a stated alternative motive", async () => {
    const principles = [
      principle(
        "Tends to exit winning positions after a large run-up because of fear of a pullback, rather than using a price target or technical signal.",
        [
          {
            interviewAnswerId: "a1",
            stance: "contradicting",
            description: "held a large run-up position without a target",
          },
        ]
      ),
    ];
    // Injected verdict simulating the CORRECT application of the rubric
    // for this shape (a real, held-open question per the architecture
    // investigation — this fixture encodes the desired mechanism
    // behavior, not a claim about what the real model always returns).
    const checkGrounding = async () => ({
      verdict: "supported" as const,
      reason: "the investor held through the run-up instead of exiting, a genuine behavioral counter-example, even though no alternative exit motive is described",
    });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([["a1", "I didn't wait for a target or signal; I stayed as long as it rose because I believe in the company."]]),
      new Map([["a1", "X#1"]]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(1);
    expect(result.principles[0]?.contradictingCount).toBe(1);
    expect(result.principles[0]?.supportingCount).toBe(0);
  });

  it("a contradicting citation that is actually consistent with the claim (not against it) is rejected, never flipped into supportingCount", async () => {
    const principles = [
      principle("Cuts losing positions when the thesis fails.", [
        { interviewAnswerId: "a1", stance: "contradicting", description: "mismatched stance" },
      ]),
    ];
    const checkGrounding = async () => ({
      verdict: "unsupported" as const,
      reason: "the answer actually supports the claim, not against it",
    });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([["a1", "text"]]),
      new Map([["a1", "X#1"]]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(0);
    expect(result.droppedPrinciples).toHaveLength(1);
  });

  it("ambiguity/failure in the injected grounding function fails closed to unsupported, never silently included", async () => {
    const principles = [
      principle("Some claim.", [{ interviewAnswerId: "a1", stance: "supporting", description: "d" }]),
    ];
    const checkGrounding = async () => {
      throw new Error("network error");
    };

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([["a1", "text"]]),
      new Map([["a1", "X#1"]]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(0);
    expect(result.droppedPrinciples).toHaveLength(1);
  });

  it("no evidence survives grounding => the whole principle is dropped, never persisted with zero evidence", async () => {
    const principles = [
      principle("A claim with two citations, both bad.", [
        { interviewAnswerId: "a1", stance: "supporting", description: "d1" },
        { interviewAnswerId: "a2", stance: "supporting", description: "d2" },
      ]),
    ];
    const checkGrounding = async () => ({ verdict: "unsupported" as const, reason: "no" });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([
        ["a1", "t1"],
        ["a2", "t2"],
      ]),
      new Map([
        ["a1", "X#1"],
        ["a2", "Y#1"],
      ]),
      checkGrounding
    );

    expect(result.principles).toHaveLength(0);
    expect(result.droppedPrinciples).toHaveLength(1);
    expect(result.excluded).toHaveLength(2);
  });

  it("recomputes independent-case counts from surviving evidence via the real production countIndependentCases, not raw citation count", async () => {
    const principles = [
      principle("Claim with two citations from the same case.", [
        { interviewAnswerId: "a1", stance: "supporting", description: "d1" },
        { interviewAnswerId: "a2", stance: "supporting", description: "d2" },
      ]),
    ];
    const checkGrounding = async () => ({ verdict: "supported" as const, reason: "ok" });

    const result = await groundValidatedObservedPrinciples(
      principles,
      new Map([
        ["a1", "t1"],
        ["a2", "t2"],
      ]),
      // Both citations resolve to the SAME independent case.
      new Map([
        ["a1", "MP#1"],
        ["a2", "MP#1"],
      ]),
      checkGrounding
    );

    expect(result.principles[0]?.supportingCount).toBe(1);
  });
});
