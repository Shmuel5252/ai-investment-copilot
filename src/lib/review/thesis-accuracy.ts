// Deterministic floor on the AI's thesis_accuracy (Unit 7/A). Found on real
// data (AVGO review, 2026-10-06): one forecast resolved inconclusive and
// three re-entry conditions resolved "did not occur" came back
// partially_confirmed, while the review's own narrative said the thesis
// "hasn't yet been tested". A re-entry condition that did not occur is a
// check the investor set, not evidence about the thesis.
//
// Evidence-bearing resolutions: a forecast (or a legacy null-kind
// prediction) resolved confirmed or refuted, or a re-entry condition
// resolved confirmed (the condition occurred). None → insufficient_evidence,
// whatever the AI returned; otherwise the AI label stands. Not recorded on
// the review row (no field fits without a schema change) — recomputable from
// the stored prediction resolutions.
import type { ThesisAccuracy } from "@/lib/learning/pattern-aggregation";

export interface ResolvedPrediction {
  kind: "forecast" | "reentry_condition" | null;
  status: string;
}

export function isEvidenceBearingResolution(p: ResolvedPrediction): boolean {
  if (p.kind === "reentry_condition") return p.status === "confirmed";
  return p.status === "confirmed" || p.status === "refuted";
}

export function applyThesisAccuracyEvidenceRule(aiLabel: ThesisAccuracy, predictions: readonly ResolvedPrediction[]): ThesisAccuracy {
  return predictions.some(isEvidenceBearingResolution) ? aiLabel : "insufficient_evidence";
}
