// Deterministic aggregation (docs/data-model.md §8:
// "decision_quality_pattern_json / thesis_accuracy_pattern_json —
// אגרגציה דטרמיניסטית") — plain tallies of what already happened across
// a family of reviewed decisions. Never AI-computed; this is exactly the
// kind of count CLAUDE.md's "AI vs Code" rule reserves for code.
import type { thesisAccuracyEnum } from "@/db/schema";
import type { DecisionQuality } from "@/lib/review/decision-quality";

export type ThesisAccuracy = (typeof thesisAccuracyEnum.enumValues)[number];

export function computeDecisionQualityPattern(
  decisions: readonly { decisionQualityOverall: DecisionQuality }[]
): Record<DecisionQuality, number> {
  const pattern: Record<DecisionQuality, number> = {
    insufficient_evidence: 0,
    weak: 0,
    reasonable: 0,
    strong: 0,
  };
  for (const d of decisions) pattern[d.decisionQualityOverall]++;
  return pattern;
}

export function computeThesisAccuracyPattern(
  decisions: readonly { thesisAccuracy: ThesisAccuracy }[]
): Record<ThesisAccuracy, number> {
  const pattern: Record<ThesisAccuracy, number> = {
    confirmed: 0,
    partially_confirmed: 0,
    refuted: 0,
    inconclusive: 0,
    insufficient_evidence: 0,
  };
  for (const d of decisions) pattern[d.thesisAccuracy]++;
  return pattern;
}
