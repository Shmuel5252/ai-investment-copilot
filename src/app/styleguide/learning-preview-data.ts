import type { Loadable } from "@/components/home/types";
import type { LearningActions, LearningEvidenceRow, LearningInsightRow } from "@/components/learning/learning-view";

// SYNTHETIC data for the /styleguide Learning preview and the Learning render
// tests. Invented sectors, review ids, wording and dates; nothing here comes
// from the investor's records, and nothing here calls an AI. The statements
// and evidence descriptions are English, as the backend stores AI text.

export type LearningPreviewState = "main" | "empty" | "loading" | "error" | "replayed" | "refused" | "failed";
export const LEARNING_PREVIEW_STATES: readonly LearningPreviewState[] = ["main", "empty", "loading", "error", "replayed", "refused", "failed"];

const QUALITY = { strong: 1, reasonable: 1, weak: 1, insufficient_evidence: 0 };
const ACCURACY = { confirmed: 1, partially_confirmed: 0, refuted: 1, inconclusive: 1, insufficient_evidence: 0 };

/** Newest first, as learning.list returns them. "Sample Sector A" has an OLDER identity too (history, not a second insight). */
export const PREVIEW_INSIGHTS: LearningInsightRow[] = [
  {
    id: "insight-a2",
    family: "Sample Sector A",
    createdAt: "2026-09-20T09:00:00.000Z",
    versions: [
      {
        versionNumber: 2,
        statementText: "Sample statement: in this sector you tend to enter after a pullback and to write explicit exit conditions before buying.",
        evidenceStrength: "moderate",
        decisionQualityPatternJson: QUALITY,
        thesisAccuracyPatternJson: ACCURACY,
        createdAt: "2026-09-28T09:00:00.000Z",
        createdBy: "ai_generated",
        provenanceJson: {
          generator: "learning.generate",
          citedReviews: [
            { decisionReviewId: "review-1", decisionId: "decision-1", stance: "supporting" },
            { decisionReviewId: "review-2", decisionId: "decision-2", stance: "supporting" },
            { decisionReviewId: "review-3", decisionId: "decision-3", stance: "contradicting" },
          ],
          evidenceFingerprint: "lef-v1:sample",
        },
      },
    ],
  },
  {
    id: "insight-b1",
    family: "Sample Sector B",
    createdAt: "2026-08-02T09:00:00.000Z",
    versions: [
      {
        versionNumber: 1,
        statementText: "Sample legacy statement: your decisions in this sector were mostly sized small relative to the portfolio.",
        evidenceStrength: "insufficient_evidence",
        decisionQualityPatternJson: { strong: 0, reasonable: 1, weak: 0, insufficient_evidence: 1 },
        thesisAccuracyPatternJson: { confirmed: 0, partially_confirmed: 1, refuted: 0, inconclusive: 1, insufficient_evidence: 0 },
        createdAt: "2026-08-02T09:00:00.000Z",
        createdBy: "ai_generated",
        provenanceJson: null,
      },
    ],
  },
  {
    id: "insight-a1-older",
    family: "Sample Sector A",
    createdAt: "2026-07-01T09:00:00.000Z",
    versions: [
      {
        versionNumber: 1,
        statementText: "Sample OLDER identity of Sector A: must never be shown as a current insight.",
        evidenceStrength: "weak",
        createdAt: "2026-07-01T09:00:00.000Z",
        createdBy: "ai_generated",
        provenanceJson: null,
      },
    ],
  },
];

/** Accumulated rows per insight. Sector A holds one row ("review-old") that only its version 1 cited. */
export const PREVIEW_EVIDENCE: Record<string, LearningEvidenceRow[]> = {
  "insight-a2": [
    { id: "ev-4", stance: "contradicting", decisionReviewId: "review-3", description: "Sample: this review found the entry was made without a written exit condition.", createdAt: "2026-09-28T09:00:00.000Z" },
    { id: "ev-3", stance: "supporting", decisionReviewId: "review-2", description: "Sample: this review shows an entry after a pullback, with the exit written in advance.", createdAt: "2026-09-28T09:00:00.000Z" },
    { id: "ev-2", stance: "supporting", decisionReviewId: "review-1", description: "Sample: this review shows the same pattern of waiting for a pullback.", createdAt: "2026-09-20T09:00:00.000Z" },
    { id: "ev-1", stance: "supporting", decisionReviewId: "review-old", description: "Sample STALE row: cited only by version 1, never shown as current evidence.", createdAt: "2026-09-20T09:00:00.000Z" },
  ],
  "insight-b1": [
    { id: "ev-b2", stance: "supporting", decisionReviewId: "review-b2", description: "Sample: this review notes a small position relative to the portfolio.", createdAt: "2026-08-02T09:00:00.000Z" },
    { id: "ev-b1", stance: "supporting", decisionReviewId: "review-b1", description: "Sample: this review also notes a small initial size.", createdAt: "2026-08-02T09:00:00.000Z" },
  ],
};

export const PREVIEW_GENERATE_RESULT = { familiesConsidered: 2, createdCount: 0, versionedCount: 1, unchangedCount: 1, droppedCount: 0 };

const failure = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });

export function learningPreviewInsights(state: LearningPreviewState): Loadable<LearningInsightRow[]> {
  if (state === "loading") return { data: undefined, isLoading: true, isError: false };
  if (state === "error") return { data: undefined, isLoading: false, isError: true, error: { message: "Sample load failure" }, refetch: () => undefined };
  return { data: state === "empty" ? [] : PREVIEW_INSIGHTS, isLoading: false, isError: false };
}

export function learningPreviewActions(state: LearningPreviewState, generate: LearningActions["generate"]): LearningActions {
  return {
    generate,
    agree: async () => {
      if (state === "refused") throw failure("None of the cited decisions' own statements ground this insight — nothing can be carried into DNA.", "BAD_REQUEST");
      if (state === "failed") throw failure("Sample transport failure", "INTERNAL_SERVER_ERROR");
      return state === "replayed" ? { replayed: true, carried: null } : { replayed: false, carried: { cases: 2, groundedCitations: 3 } };
    },
    disagree: async () => {
      if (state === "failed") throw failure("Sample transport failure", "INTERNAL_SERVER_ERROR");
    },
  };
}
