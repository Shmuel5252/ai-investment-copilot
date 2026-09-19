// Deterministic Evidence Strength threshold table (docs/data-model.md
// §2) — shared by DNAHypothesisVersion, StrategyPrincipleVersion
// (observed), and LearningInsightVersion. Never computed by the LLM.
import type { evidenceStrengthEnum } from "@/db/schema";

export type EvidenceStrength = (typeof evidenceStrengthEnum.enumValues)[number];

// The tier is CONFIDENCE IN THE CLAIM, not how much evidence exists, so
// the two sample-size gates count SUPPORTING independent cases only.
// Invariant (tests/unit/evidence-strength.test.ts): holding S fixed,
// raising C never raises the tier — a contradiction is real information
// (it stays persisted and counted), but it can never manufacture
// confidence. Before this, the gates used S+C: a lone contradicting case
// took a claim with 2 supporting cases from insufficient_evidence to
// moderate on a live run (uncertainty increasing confidence, and moving
// the claim into the AI narrative context excludeInsufficientEvidence
// keeps it out of). Contradiction still lowers the tier through the
// ratio gate below.
export function calculateEvidenceStrength(
  supportingCount: number,
  contradictingCount: number
): EvidenceStrength {
  if (supportingCount < 3) return "insufficient_evidence";

  const ratio = supportingCount / (supportingCount + contradictingCount);
  if (ratio < 0.6) return "weak";
  if (supportingCount >= 5 && ratio >= 0.8) return "strong";
  return "moderate";
}

// Real gap found by the user: an insufficient_evidence DNA hypothesis or
// observed Strategy principle was still showing up in narrative
// synthesis (Personal Fit, real-time decision assessment, Decision
// Review dimensions) as a hedged directional hint ("a thin, unconfirmed
// signal that would argue against..."). A verbal hedge in the prompt
// wasn't enough — the model still let it lean the conclusion. Fixed at
// the code layer instead of trusting the prompt alone (CLAUDE.md: code
// enforces structural rules, AI can't be relied on to self-police them):
// insufficient_evidence items are filtered out of the context handed to
// narrative-shaping AI calls entirely, so there is nothing there for the
// model to lean on, hedged or not. `weak` is intentionally NOT excluded
// here — it represents a real (if shaky) observed pattern, categorically
// different from insufficient_evidence's "not enough data points to call
// this a pattern at all" (total<3). This must never be applied to what
// gets *frozen* into an immutable record (e.g. DecisionSnapshot's
// dna_hypothesis_version references) — only to what's *fed to a model*
// when writing a narrative conclusion; the historical record stays
// complete regardless of what informed any one narrative.
export function excludeInsufficientEvidence<T extends { evidenceStrength: EvidenceStrength | null }>(
  items: readonly T[]
): T[] {
  return items.filter((item) => item.evidenceStrength !== "insufficient_evidence");
}
