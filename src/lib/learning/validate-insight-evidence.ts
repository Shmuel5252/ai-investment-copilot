import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
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
export function validateLearningInsightEvidence(
  proposed: ProposedLearningInsight,
  validDecisionReviewIds: ReadonlySet<string>
): ValidatedLearningInsight | null {
  if (!proposed || typeof proposed.statementText !== "string" || proposed.statementText.trim() === "") {
    return null;
  }
  if (!Array.isArray(proposed.evidence)) return null;

  const validEvidence: ValidatedInsightEvidence[] = proposed.evidence.filter(
    (e): e is ValidatedInsightEvidence =>
      !!e &&
      typeof e.decisionReviewId === "string" &&
      validDecisionReviewIds.has(e.decisionReviewId) &&
      (e.stance === "supporting" || e.stance === "contradicting") &&
      typeof e.description === "string" &&
      e.description.trim() !== ""
  );

  if (validEvidence.length === 0) return null;

  const supportingCount = validEvidence.filter((e) => e.stance === "supporting").length;
  const contradictingCount = validEvidence.filter((e) => e.stance === "contradicting").length;

  return {
    statementText: proposed.statementText.trim(),
    evidence: validEvidence,
    supportingCount,
    contradictingCount,
    evidenceStrength: calculateEvidenceStrength(supportingCount, contradictingCount),
  };
}
