import { describe, expect, it } from "vitest";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import type { ProposedHypothesis } from "@/lib/ai/dna";

describe("validateProposedHypotheses", () => {
  it("keeps a hypothesis whose evidence all cites real answer ids", () => {
    const validIds = new Set(["a1", "a2"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "You tend to buy after sharp drops.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "Bought AAPL after a drop." },
          { interviewAnswerId: "a2", stance: "supporting", description: "Bought MSFT after a drop too." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, validIds);
    expect(result).toHaveLength(1);
    expect(result[0]?.supportingCount).toBe(2);
    expect(result[0]?.contradictingCount).toBe(0);
    expect(result[0]?.evidenceStrength).toBe("insufficient_evidence"); // only 2 pieces of evidence
  });

  it("drops individual citations that reference a hallucinated (non-existent) answer id", () => {
    const validIds = new Set(["a1"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "You tend to buy after sharp drops.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "Real citation." },
          { interviewAnswerId: "made-up-id", stance: "supporting", description: "Hallucinated citation." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, validIds);
    expect(result[0]?.evidence).toHaveLength(1);
    expect(result[0]?.evidence[0]?.interviewAnswerId).toBe("a1");
  });

  it("drops a hypothesis entirely if every citation is invalid, rather than keeping it with zero evidence", () => {
    const validIds = new Set(["a1"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "A hypothesis with no real evidence.",
        evidence: [{ interviewAnswerId: "fake-1", stance: "supporting", description: "Not real." }],
      },
      {
        statement: "A hypothesis with real evidence.",
        evidence: [{ interviewAnswerId: "a1", stance: "supporting", description: "Real." }],
      },
    ];
    const result = validateProposedHypotheses(proposed, validIds);
    expect(result).toHaveLength(1);
    expect(result[0]?.statement).toBe("A hypothesis with real evidence.");
  });

  it("computes evidenceStrength from validated counts only, not the AI's raw citation count", () => {
    const validIds = new Set(["a1", "a2", "a3"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "Looks well-evidenced at a glance.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "x" },
          { interviewAnswerId: "a2", stance: "supporting", description: "x" },
          { interviewAnswerId: "a3", stance: "supporting", description: "x" },
          { interviewAnswerId: "fake-1", stance: "supporting", description: "x" },
          { interviewAnswerId: "fake-2", stance: "supporting", description: "x" },
        ],
      },
    ];
    // 5 citations claimed, but only 3 are real -> strength computed from 3, not 5.
    const result = validateProposedHypotheses(proposed, validIds);
    expect(result[0]?.supportingCount).toBe(3);
    expect(result[0]?.evidenceStrength).toBe("moderate"); // 3 total, ratio 1.0, but total<5
  });

  it("preserves an honest contradicting citation rather than dropping it", () => {
    const validIds = new Set(["a1", "a2", "a3", "a4"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "Mostly buys dips, with one exception.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "x" },
          { interviewAnswerId: "a2", stance: "supporting", description: "x" },
          { interviewAnswerId: "a3", stance: "supporting", description: "x" },
          { interviewAnswerId: "a4", stance: "contradicting", description: "Bought at a high once." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, validIds);
    expect(result[0]?.contradictingCount).toBe(1);
    expect(result[0]?.evidenceStrength).toBe("moderate"); // 4 total, ratio 0.75, but total<5
  });

  it("rejects a hypothesis with no statement text", () => {
    const validIds = new Set(["a1"]);
    const proposed = [
      { statement: "", evidence: [{ interviewAnswerId: "a1", stance: "supporting", description: "x" }] },
    ] as ProposedHypothesis[];
    expect(validateProposedHypotheses(proposed, validIds)).toEqual([]);
  });

  it("returns an empty list for an empty proposal", () => {
    expect(validateProposedHypotheses([], new Set())).toEqual([]);
  });
});
