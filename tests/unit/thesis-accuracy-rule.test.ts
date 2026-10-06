import { describe, expect, it } from "vitest";
import { applyThesisAccuracyEvidenceRule, type ResolvedPrediction } from "@/lib/review/thesis-accuracy";

const forecast = (status: string): ResolvedPrediction => ({ kind: "forecast", status });
const reentry = (status: string): ResolvedPrediction => ({ kind: "reentry_condition", status });

describe("thesis_accuracy evidence rule (Unit 7/A)", () => {
  it("AVGO shape: forecast inconclusive + 3 re-entry conditions that did not occur → insufficient_evidence", () => {
    const preds = [forecast("inconclusive"), reentry("refuted"), reentry("refuted"), reentry("refuted")];
    expect(applyThesisAccuracyEvidenceRule("partially_confirmed", preds)).toBe("insufficient_evidence");
  });
  it("PLTR shape: 3 re-entry conditions, one occurred → the AI label stands", () => {
    const preds = [reentry("confirmed"), reentry("refuted"), reentry("refuted")];
    expect(applyThesisAccuracyEvidenceRule("partially_confirmed", preds)).toBe("partially_confirmed");
  });
  it("a confirmed forecast → the AI label stands", () => {
    expect(applyThesisAccuracyEvidenceRule("confirmed", [forecast("confirmed"), reentry("refuted")])).toBe("confirmed");
  });
  it("a refuted forecast → the AI label stands", () => {
    expect(applyThesisAccuracyEvidenceRule("refuted", [forecast("refuted")])).toBe("refuted");
  });
  it("all forecasts inconclusive and no conditions → insufficient_evidence", () => {
    expect(applyThesisAccuracyEvidenceRule("inconclusive", [forecast("inconclusive"), forecast("inconclusive")])).toBe("insufficient_evidence");
  });
  it("legacy null-kind predictions count like forecasts", () => {
    expect(applyThesisAccuracyEvidenceRule("confirmed", [{ kind: null, status: "confirmed" }])).toBe("confirmed");
    expect(applyThesisAccuracyEvidenceRule("refuted", [{ kind: null, status: "inconclusive" }])).toBe("insufficient_evidence");
  });
  it("no predictions at all, or only pending ones → insufficient_evidence", () => {
    expect(applyThesisAccuracyEvidenceRule("confirmed", [])).toBe("insufficient_evidence");
    expect(applyThesisAccuracyEvidenceRule("confirmed", [forecast("pending")])).toBe("insufficient_evidence");
  });
});
