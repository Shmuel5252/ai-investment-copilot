import { describe, expect, it } from "vitest";
import { assertNonEmptyStrings } from "@/lib/ai/case";
import type { DecisionContextSynthesis, ProposedPrediction } from "@/lib/ai/decision";

// synthesizeDecisionContext() itself makes a real Anthropic call, so it
// isn't unit-tested directly (same reason case.ts's synthesize* functions
// aren't) — this exercises the exact validation calls it makes
// (assertNonEmptyStrings on the two flat fields, then per-prediction on
// claimText) against realistic DecisionContextSynthesis-shaped fixtures,
// the same way tests/unit/case-assert-non-empty-strings.test.ts covers
// case.ts's use of the same function. docs/backlog.md, "עדיפות גבוהה".

function validPrediction(overrides: Partial<ProposedPrediction> = {}): ProposedPrediction {
  return { claimText: "Revenue growth stays above 20% next quarter.", kind: "forecast", timeframeDays: 90, ...overrides };
}

function validSynthesis(overrides: Partial<DecisionContextSynthesis> = {}): DecisionContextSynthesis {
  return {
    thesisInterpretationText: "A growth-continuation bet on the core product line.",
    realtimeAssessmentText: "Nothing in the given data conflicts with this decision.",
    predictions: [validPrediction()],
    ...overrides,
  };
}

// Mirrors the exact two calls synthesizeDecisionContext() makes after the
// cast, so this test fails exactly when that real code path would.
function runValidation(result: DecisionContextSynthesis): void {
  assertNonEmptyStrings(result, ["thesisInterpretationText", "realtimeAssessmentText"], "synthesize_decision_context");
  result.predictions.forEach((prediction, index) => {
    assertNonEmptyStrings(prediction, ["claimText"], `synthesize_decision_context predictions[${index}]`);
  });
}

describe("decision.ts's synthesizeDecisionContext validation", () => {
  it("does not throw when every field is a valid non-empty string", () => {
    expect(() => runValidation(validSynthesis())).not.toThrow();
  });

  it("does not throw on an empty predictions array — zero predictions is a normal result", () => {
    expect(() => runValidation(validSynthesis({ predictions: [] }))).not.toThrow();
  });

  it.each([
    ["thesisInterpretationText", undefined],
    ["thesisInterpretationText", null],
    ["thesisInterpretationText", ""],
    ["thesisInterpretationText", "   "],
    ["realtimeAssessmentText", undefined],
    ["realtimeAssessmentText", null],
    ["realtimeAssessmentText", ""],
    ["realtimeAssessmentText", "   "],
  ] as const)("throws when %s is %p", (field, value) => {
    const broken = validSynthesis({ [field]: value } as unknown as Partial<DecisionContextSynthesis>);
    expect(() => runValidation(broken)).toThrow(new RegExp(field));
  });

  it.each([undefined, null, "", "   "] as const)(
    "throws when a claimText in the middle of a larger predictions array is %p, and names its index",
    (badValue) => {
      const broken = validSynthesis({
        predictions: [
          validPrediction({ claimText: "First prediction, fine." }),
          validPrediction({ claimText: badValue as unknown as string }),
          validPrediction({ claimText: "Third prediction, fine." }),
        ],
      });
      expect(() => runValidation(broken)).toThrow(/predictions\[1\]/);
      expect(() => runValidation(broken)).toThrow(/claimText/);
    }
  );

  it("does not evaluate later predictions once an earlier one fails (throws on first)", () => {
    const broken = validSynthesis({
      predictions: [validPrediction({ claimText: "" }), validPrediction({ claimText: "" })],
    });
    expect(() => runValidation(broken)).toThrow(/predictions\[0\]/);
  });
});
