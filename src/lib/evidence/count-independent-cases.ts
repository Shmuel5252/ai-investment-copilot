// Evidence Strength (docs/data-model.md §2) must count independent
// investment cases, not raw Evidence rows — a real gap found by the user
// on real data: the same underlying transaction/decision can produce
// more than one Evidence row (e.g. an interview asked about the same
// transaction across two separate onboarding-interview sessions, since
// src/lib/interview/select-transactions.ts only dedupes *within* one
// session's selection, not across sessions; a decision can accumulate
// more than one DecisionReview over time). Naively summing raw citation
// counts would silently let one real-world case count twice.
//
// The fix stays where it belongs: only the *counting* that feeds
// calculateEvidenceStrength() is deduped by underlying case here — the
// raw Evidence rows themselves are still inserted and shown as-is for
// "View Evidence" (every real citation stays traceable), this only
// changes what's fed into the strength calculation.
export interface CaseKeyedEvidence {
  stance: "supporting" | "contradicting";
}

export interface IndependentCaseCounts {
  supportingCount: number;
  contradictingCount: number;
}

// If the same underlying case is cited with disagreeing stances (rare,
// but possible — one interview answer framed it as supporting, another
// mention of the same transaction as contradicting), the case counts as
// contradicting: a real, evidenced doubt about the pattern shouldn't be
// silently absorbed into a "supporting" tally just because another
// citation of the same case happened to lean the other way.
export function countIndependentCases<T extends CaseKeyedEvidence>(
  evidence: readonly T[],
  caseKeyOf: (evidence: T) => string
): IndependentCaseCounts {
  const stanceByCase = new Map<string, "supporting" | "contradicting">();

  for (const e of evidence) {
    const key = caseKeyOf(e);
    const existing = stanceByCase.get(key);
    if (existing === undefined) {
      stanceByCase.set(key, e.stance);
    } else if (existing !== e.stance) {
      stanceByCase.set(key, "contradicting");
    }
  }

  const stances = [...stanceByCase.values()];
  return {
    supportingCount: stances.filter((s) => s === "supporting").length,
    contradictingCount: stances.filter((s) => s === "contradicting").length,
  };
}
