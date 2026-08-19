import { describe, expect, it } from "vitest";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";

describe("countIndependentCases", () => {
  it("counts each independent case once even when cited multiple times", () => {
    const evidence = [
      { stance: "supporting" as const, caseKey: "txn-1" },
      { stance: "supporting" as const, caseKey: "txn-1" }, // same underlying transaction, cited twice
      { stance: "supporting" as const, caseKey: "txn-2" },
    ];
    const result = countIndependentCases(evidence, (e) => e.caseKey);
    expect(result).toEqual({ supportingCount: 2, contradictingCount: 0 });
  });

  it("matches raw counting when every citation is about a genuinely distinct case", () => {
    const evidence = [
      { stance: "supporting" as const, caseKey: "txn-1" },
      { stance: "supporting" as const, caseKey: "txn-2" },
      { stance: "contradicting" as const, caseKey: "txn-3" },
    ];
    const result = countIndependentCases(evidence, (e) => e.caseKey);
    expect(result).toEqual({ supportingCount: 2, contradictingCount: 1 });
  });

  it("resolves a disagreeing duplicate case toward contradicting, not supporting", () => {
    const evidence = [
      { stance: "supporting" as const, caseKey: "txn-1" },
      { stance: "contradicting" as const, caseKey: "txn-1" }, // same case, disagreeing stance
    ];
    const result = countIndependentCases(evidence, (e) => e.caseKey);
    expect(result).toEqual({ supportingCount: 0, contradictingCount: 1 });
  });

  it("is order-independent for the disagreeing-duplicate resolution", () => {
    const evidence = [
      { stance: "contradicting" as const, caseKey: "txn-1" },
      { stance: "supporting" as const, caseKey: "txn-1" },
    ];
    const result = countIndependentCases(evidence, (e) => e.caseKey);
    expect(result).toEqual({ supportingCount: 0, contradictingCount: 1 });
  });

  it("returns zero counts for empty evidence", () => {
    expect(countIndependentCases([], (e: { stance: "supporting" | "contradicting" }) => e.stance)).toEqual({
      supportingCount: 0,
      contradictingCount: 0,
    });
  });

  it("the exact scenario reported: one underlying case cited from three different sources still counts as one", () => {
    // transaction itself + an interview answer about it + a decision
    // review that also touches it — all really "the same case".
    const evidence = [
      { stance: "supporting" as const, caseKey: "case-A" },
      { stance: "supporting" as const, caseKey: "case-A" },
      { stance: "supporting" as const, caseKey: "case-A" },
    ];
    const result = countIndependentCases(evidence, (e) => e.caseKey);
    expect(result.supportingCount).toBe(1);
  });
});
