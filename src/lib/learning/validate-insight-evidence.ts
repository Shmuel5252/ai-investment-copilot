import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import { countIndependentCases } from "@/lib/evidence/count-independent-cases";
import type { ProposedLearningInsight } from "@/lib/ai/learning";

export interface ValidatedInsightEvidence {
  decisionReviewId: string;
  stance: "supporting" | "contradicting";
  description: string;
}

export interface ValidatedLearningInsight {
  statementText: string;
  evidence: ValidatedInsightEvidence[];
  supportingCount: number;
  contradictingCount: number;
  evidenceStrength: EvidenceStrength;
}

// Same trust boundary as src/lib/dna/validate-hypotheses.ts, same shared
// Evidence Strength table (docs/data-model.md §8: "evidence_strength
// (אותה טבלה כמו DNA)"). Citations are checked against the real
// DecisionReview ids that were actually offered to the model for this
// family — a citation to anything else is a hallucination, dropped, not
// trusted. Returns null if nothing survives validation: a proposed
// insight whose only "evidence" was hallucinated isn't a thin insight,
// it isn't an insight at all (matches the DNA precedent exactly).
//
// `reviewCaseKeys` maps each valid decisionReviewId to its underlying
// Decision id — the real independent case, not the review row. A
// Decision can accumulate more than one DecisionReview over time (e.g.
// re-reviewed at 3mo and again at 12mo); citing two reviews of the same
// decision must still count as one piece of evidence, not two, for the
// same reason src/lib/dna/validate-hypotheses.ts dedupes by transaction.
// listReviewedDecisionsForInvestor already keeps only the latest review
// per decision today, so this is currently a no-op in practice — kept
// here anyway so the counting is correct by construction, not by an
// incidental property of a different function.
export function validateLearningInsightEvidence(
  proposed: ProposedLearningInsight,
  reviewCaseKeys: ReadonlyMap<string, string>
): ValidatedLearningInsight | null {
  if (!proposed || typeof proposed.statementText !== "string" || proposed.statementText.trim() === "") {
    return null;
  }
  if (!Array.isArray(proposed.evidence)) return null;

  const validEvidence: ValidatedInsightEvidence[] = proposed.evidence.filter(
    (e): e is ValidatedInsightEvidence =>
      !!e &&
      typeof e.decisionReviewId === "string" &&
      reviewCaseKeys.has(e.decisionReviewId) &&
      (e.stance === "supporting" || e.stance === "contradicting") &&
      typeof e.description === "string" &&
      e.description.trim() !== ""
  );

  if (validEvidence.length === 0) return null;

  const { supportingCount, contradictingCount } = countIndependentCases(
    validEvidence,
    (e) => reviewCaseKeys.get(e.decisionReviewId)!
  );

  return {
    statementText: proposed.statementText.trim(),
    evidence: validEvidence,
    supportingCount,
    contradictingCount,
    evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
  };
}
