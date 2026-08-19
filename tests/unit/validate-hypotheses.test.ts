import { describe, expect, it } from "vitest";
import { validateProposedHypotheses } from "@/lib/dna/validate-hypotheses";
import type { ProposedHypothesis } from "@/lib/ai/dna";

// Helper: each answer id is its own independent case (id -> id) unless a
// test explicitly wants two answer ids to resolve to the *same*
// underlying case (e.g. two interview answers about the same
// transaction, from two separate sessions).
function identityCaseKeys(ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, id]));
}

describe("validateProposedHypotheses", () => {
  it("keeps a hypothesis whose evidence all cites real answer ids", () => {
    const caseKeys = identityCaseKeys(["a1", "a2"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "You tend to buy after sharp drops.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "Bought AAPL after a drop." },
          { interviewAnswerId: "a2", stance: "supporting", description: "Bought MSFT after a drop too." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, caseKeys);
    expect(result).toHaveLength(1);
    expect(result[0]?.supportingCount).toBe(2);
    expect(result[0]?.contradictingCount).toBe(0);
    expect(result[0]?.evidenceStrength).toBe("insufficient_evidence"); // only 2 pieces of evidence
  });

  it("drops individual citations that reference a hallucinated (non-existent) answer id", () => {
    const caseKeys = identityCaseKeys(["a1"]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "You tend to buy after sharp drops.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "Real citation." },
          { interviewAnswerId: "made-up-id", stance: "supporting", description: "Hallucinated citation." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, caseKeys);
    expect(result[0]?.evidence).toHaveLength(1);
    expect(result[0]?.evidence[0]?.interviewAnswerId).toBe("a1");
  });

  it("drops a hypothesis entirely if every citation is invalid, rather than keeping it with zero evidence", () => {
    const caseKeys = identityCaseKeys(["a1"]);
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
    const result = validateProposedHypotheses(proposed, caseKeys);
    expect(result).toHaveLength(1);
    expect(result[0]?.statement).toBe("A hypothesis with real evidence.");
  });

  it("computes evidenceStrength from validated counts only, not the AI's raw citation count", () => {
    const caseKeys = identityCaseKeys(["a1", "a2", "a3"]);
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
    const result = validateProposedHypotheses(proposed, caseKeys);
    expect(result[0]?.supportingCount).toBe(3);
    expect(result[0]?.evidenceStrength).toBe("moderate"); // 3 total, ratio 1.0, but total<5
  });

  it("preserves an honest contradicting citation rather than dropping it", () => {
    const caseKeys = identityCaseKeys(["a1", "a2", "a3", "a4"]);
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
    const result = validateProposedHypotheses(proposed, caseKeys);
    expect(result[0]?.contradictingCount).toBe(1);
    expect(result[0]?.evidenceStrength).toBe("moderate"); // 4 total, ratio 0.75, but total<5
  });

  it("rejects a hypothesis with no statement text", () => {
    const caseKeys = identityCaseKeys(["a1"]);
    const proposed = [
      { statement: "", evidence: [{ interviewAnswerId: "a1", stance: "supporting", description: "x" }] },
    ] as ProposedHypothesis[];
    expect(validateProposedHypotheses(proposed, caseKeys)).toEqual([]);
  });

  it("returns an empty list for an empty proposal", () => {
    expect(validateProposedHypotheses([], new Map())).toEqual([]);
  });

  // Regression coverage for a real gap the user found: Evidence Strength
  // must count independent investment cases, not raw Evidence rows. Two
  // different InterviewAnswers about the *same* transaction (reachable
  // today — an interview re-run in a later session can re-select a
  // transaction already asked about before) must count as one piece of
  // evidence, not two.
  it("counts two interview answers about the same transaction as one independent case, not two", () => {
    // a1 (session 1) and a2 (session 2) both ended up being about txn-123.
    const caseKeys = new Map([
      ["a1", "txn-123"],
      ["a2", "txn-123"],
      ["a3", "txn-456"],
    ]);
    const proposed: ProposedHypothesis[] = [
      {
        statement: "You tend to buy after sharp drops.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "Asked about txn-123 in session 1." },
          { interviewAnswerId: "a2", stance: "supporting", description: "Asked about the same txn-123 again in session 2." },
          { interviewAnswerId: "a3", stance: "supporting", description: "A genuinely different transaction." },
        ],
      },
    ];
    const result = validateProposedHypotheses(proposed, caseKeys);
    // All 3 raw citations are kept for traceability...
    expect(result[0]?.evidence).toHaveLength(3);
    // ...but the strength-driving count reflects only 2 independent cases.
    expect(result[0]?.supportingCount).toBe(2);
    expect(result[0]?.evidenceStrength).toBe("insufficient_evidence");
  });
});
