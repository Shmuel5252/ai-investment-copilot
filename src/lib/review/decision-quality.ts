// Deterministic decision_quality_overall rollup (docs/data-model.md §5
// rollup table) — computed in code from the 7 already-verdicted
// ReviewDimension rows, never set by the LLM directly (CLAUDE.md "AI vs
// Code"). Deliberately biased toward caution: a single unanswered weakness
// with no offsetting strength rounds down to Weak, not up to Reasonable.
import type { decisionQualityEnum } from "@/db/schema";

export type DecisionQuality = (typeof decisionQualityEnum.enumValues)[number];

export function calculateDecisionQualityOverall(verdicts: DecisionQuality[]): DecisionQuality {
  const insufficientCount = verdicts.filter((v) => v === "insufficient_evidence").length;
  const weakCount = verdicts.filter((v) => v === "weak").length;
  const strongCount = verdicts.filter((v) => v === "strong").length;

  if (insufficientCount >= 4) return "insufficient_evidence";
  if (weakCount >= 2) return "weak";
  if (weakCount === 1 && strongCount === 0) return "weak";
  if (strongCount >= 5 && weakCount === 0) return "strong";
  return "reasonable";
}
