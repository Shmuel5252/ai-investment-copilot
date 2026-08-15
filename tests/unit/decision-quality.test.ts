import { describe, expect, it } from "vitest";
import { calculateDecisionQualityOverall, type DecisionQuality } from "@/lib/review/decision-quality";

function verdicts(spec: { strong?: number; reasonable?: number; weak?: number; insufficient?: number }): DecisionQuality[] {
  return [
    ...Array(spec.strong ?? 0).fill("strong" as const),
    ...Array(spec.reasonable ?? 0).fill("reasonable" as const),
    ...Array(spec.weak ?? 0).fill("weak" as const),
    ...Array(spec.insufficient ?? 0).fill("insufficient_evidence" as const),
  ];
}

// Table from docs/data-model.md §5:
// 1. insufficient_evidence>=4 of 7 -> Insufficient Evidence
// 2. weak>=2 of 7 -> Weak
// 3. weak==1 and strong==0 -> Weak
// 4. strong>=5 of 7 and weak==0 -> Strong
// 5. else -> Reasonable
describe("calculateDecisionQualityOverall", () => {
  it("returns insufficient_evidence when 4 or more of 7 dimensions are insufficient_evidence", () => {
    expect(calculateDecisionQualityOverall(verdicts({ insufficient: 4, reasonable: 3 }))).toBe(
      "insufficient_evidence"
    );
    expect(calculateDecisionQualityOverall(verdicts({ insufficient: 7 }))).toBe("insufficient_evidence");
  });

  it("takes priority over a high strong count when insufficient_evidence dominates", () => {
    // 4 insufficient + 3 strong: rule 1 fires before rule 4 could ever apply
    expect(calculateDecisionQualityOverall(verdicts({ insufficient: 4, strong: 3 }))).toBe(
      "insufficient_evidence"
    );
  });

  it("returns weak when 2 or more of 7 dimensions are weak", () => {
    expect(calculateDecisionQualityOverall(verdicts({ weak: 2, strong: 5 }))).toBe("weak");
    expect(calculateDecisionQualityOverall(verdicts({ weak: 3, reasonable: 4 }))).toBe("weak");
  });

  it("returns weak for a single weak dimension with no offsetting strong dimension", () => {
    expect(calculateDecisionQualityOverall(verdicts({ weak: 1, reasonable: 6 }))).toBe("weak");
  });

  it("does NOT round a single weak up to reasonable just because most others are fine", () => {
    // Biased toward caution, per the doc: one real weakness with zero
    // strengths to offset it stays Weak, not Reasonable.
    expect(calculateDecisionQualityOverall(verdicts({ weak: 1, reasonable: 6 }))).not.toBe("reasonable");
  });

  it("allows a single weak to NOT force Weak when at least one dimension is strong", () => {
    // weak==1 and strong>0 skips rule 3; falls through to the default (Reasonable)
    // since rule 4 needs strong>=5.
    expect(calculateDecisionQualityOverall(verdicts({ weak: 1, strong: 1, reasonable: 5 }))).toBe("reasonable");
  });

  it("returns strong only when 5+ of 7 are strong AND zero are weak", () => {
    expect(calculateDecisionQualityOverall(verdicts({ strong: 5, reasonable: 2 }))).toBe("strong");
    expect(calculateDecisionQualityOverall(verdicts({ strong: 7 }))).toBe("strong");
  });

  it("does not return strong if even one dimension is weak, regardless of strong count", () => {
    // strong>=1 keeps rule 3 (weak==1 && strong==0) from forcing Weak, but
    // rule 4 (strong>=5 && weak==0) also can't fire with a weak present —
    // falls through to the Reasonable default, not Strong and not Weak.
    expect(calculateDecisionQualityOverall(verdicts({ strong: 6, weak: 1 }))).toBe("reasonable");
  });

  it("returns reasonable as the default for a mixed, unremarkable set", () => {
    expect(calculateDecisionQualityOverall(verdicts({ strong: 2, reasonable: 5 }))).toBe("reasonable");
    expect(calculateDecisionQualityOverall(verdicts({ strong: 4, reasonable: 3 }))).toBe("reasonable"); // 4 strong, not enough for rule 4
  });

  it("returns reasonable for an all-reasonable set", () => {
    expect(calculateDecisionQualityOverall(verdicts({ reasonable: 7 }))).toBe("reasonable");
  });
});
