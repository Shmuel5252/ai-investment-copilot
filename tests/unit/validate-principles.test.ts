import { describe, expect, it } from "vitest";
import {
  validateProposedDeclaredPrinciples,
  validateProposedObservedPrinciples,
} from "@/lib/strategy/validate-principles";
import type { ProposedDeclaredPrinciple, ProposedObservedPrinciple } from "@/lib/ai/strategy";
import { resolverFromCaseKeys } from "../helpers/independence";

// Each answer id is its own independent case (id -> id) unless a test
// explicitly wants two ids to resolve to the same underlying transaction.
function identityCaseKeys(ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, id]));
}

describe("validateProposedDeclaredPrinciples", () => {
  it("keeps a principle whose citations all resolve to real answer ids", () => {
    const validIds = new Set(["a1", "a2"]);
    const proposed: ProposedDeclaredPrinciple[] = [
      {
        statementText: "I keep position sizes below 10% of the portfolio.",
        rationaleText: "Stated directly in answer a1.",
        citedAnswerIds: ["a1"],
      },
    ];
    const result = validateProposedDeclaredPrinciples(proposed, validIds);
    expect(result).toHaveLength(1);
    expect(result[0]?.citedAnswerIds).toEqual(["a1"]);
  });

  it("drops a hallucinated citation but keeps the principle if another citation is real", () => {
    const validIds = new Set(["a1"]);
    const proposed: ProposedDeclaredPrinciple[] = [
      {
        statementText: "I only buy after a pullback.",
        rationaleText: "x",
        citedAnswerIds: ["a1", "made-up-id"],
      },
    ];
    const result = validateProposedDeclaredPrinciples(proposed, validIds);
    expect(result[0]?.citedAnswerIds).toEqual(["a1"]);
  });

  it("drops a principle entirely if every citation is invalid", () => {
    const validIds = new Set(["a1"]);
    const proposed: ProposedDeclaredPrinciple[] = [
      { statementText: "Invented rule.", rationaleText: "x", citedAnswerIds: ["fake-1"] },
      { statementText: "Real rule.", rationaleText: "x", citedAnswerIds: ["a1"] },
    ];
    const result = validateProposedDeclaredPrinciples(proposed, validIds);
    expect(result).toHaveLength(1);
    expect(result[0]?.statementText).toBe("Real rule.");
  });

  it("rejects a principle with empty statement text", () => {
    const validIds = new Set(["a1"]);
    const proposed = [
      { statementText: "", rationaleText: "x", citedAnswerIds: ["a1"] },
    ] as ProposedDeclaredPrinciple[];
    expect(validateProposedDeclaredPrinciples(proposed, validIds)).toEqual([]);
  });

  it("returns an empty list for an empty proposal (no explicit rule stated is a normal outcome)", () => {
    expect(validateProposedDeclaredPrinciples([], new Set())).toEqual([]);
  });
});

describe("validateProposedObservedPrinciples", () => {
  it("computes evidenceStrength from validated counts only, not the AI's raw citation count", () => {
    const caseKeys = identityCaseKeys(["a1", "a2", "a3"]);
    const proposed: ProposedObservedPrinciple[] = [
      {
        statement: "You tend to size new positions consistently.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "x" },
          { interviewAnswerId: "a2", stance: "supporting", description: "x" },
          { interviewAnswerId: "a3", stance: "supporting", description: "x" },
          { interviewAnswerId: "fake-1", stance: "supporting", description: "x" },
        ],
      },
    ];
    const result = validateProposedObservedPrinciples(proposed, resolverFromCaseKeys(caseKeys));
    expect(result[0]?.supportingCount).toBe(3);
    expect(result[0]?.evidenceStrength).toBe("moderate"); // 3 total, ratio 1.0, but total<5
  });

  it("drops individual hallucinated citations and drops principles left with zero evidence", () => {
    const caseKeys = identityCaseKeys(["a1"]);
    const proposed: ProposedObservedPrinciple[] = [
      {
        statement: "No real evidence behind this one.",
        evidence: [{ interviewAnswerId: "fake-1", stance: "supporting", description: "x" }],
      },
      {
        statement: "Real evidence behind this one.",
        evidence: [{ interviewAnswerId: "a1", stance: "supporting", description: "x" }],
      },
    ];
    const result = validateProposedObservedPrinciples(proposed, resolverFromCaseKeys(caseKeys));
    expect(result).toHaveLength(1);
    expect(result[0]?.statement).toBe("Real evidence behind this one.");
  });

  it("returns an empty list for an empty proposal", () => {
    expect(validateProposedObservedPrinciples([], resolverFromCaseKeys(new Map()))).toEqual([]);
  });

  // Regression coverage for the same real gap as validate-hypotheses.test.ts:
  // two interview answers about the same underlying transaction must
  // count as one independent case, not two.
  it("counts two interview answers about the same transaction as one independent case, not two", () => {
    const caseKeys = new Map([
      ["a1", "txn-123"],
      ["a2", "txn-123"],
      ["a3", "txn-456"],
    ]);
    const proposed: ProposedObservedPrinciple[] = [
      {
        statement: "You tend to size new positions consistently.",
        evidence: [
          { interviewAnswerId: "a1", stance: "supporting", description: "x" },
          { interviewAnswerId: "a2", stance: "supporting", description: "Same transaction, different session." },
          { interviewAnswerId: "a3", stance: "supporting", description: "x" },
        ],
      },
    ];
    const result = validateProposedObservedPrinciples(proposed, resolverFromCaseKeys(caseKeys));
    expect(result[0]?.evidence).toHaveLength(3);
    expect(result[0]?.supportingCount).toBe(2);
  });
});
