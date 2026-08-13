// Deterministic Evidence Strength threshold table (docs/data-model.md
// §2) — shared by DNAHypothesisVersion, StrategyPrincipleVersion
// (observed), and LearningInsightVersion. Never computed by the LLM.
import type { evidenceStrengthEnum } from "@/db/schema";

export type EvidenceStrength = (typeof evidenceStrengthEnum.enumValues)[number];

export function calculateEvidenceStrength(
  supportingCount: number,
  contradictingCount: number
): EvidenceStrength {
  const total = supportingCount + contradictingCount;
  if (total < 3) return "insufficient_evidence";

  const ratio = supportingCount / total;
  if (ratio < 0.6) return "weak";
  if (total >= 5 && ratio >= 0.8) return "strong";
  return "moderate";
}
