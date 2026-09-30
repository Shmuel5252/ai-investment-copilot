import { describe, expect, it } from "vitest";
import { ATTENTION_REASONS } from "@/lib/monitoring/decision-attention";
import { deriveNextActions, NEXT_ACTION_KINDS } from "@/lib/next-actions/next-actions";
import { decisionAttention, nextActions, homePage } from "@/lib/i18n/strings";

// Frontend V1 unit 2 — every state, reason and action the backend can emit
// has Hebrew investor-facing copy on Home. The enums come from the production
// modules, so a new backend value without copy fails here instead of
// rendering as a raw enum.
const HEBREW = /[א-ת]/;

describe("Home copy coverage", () => {
  it("every attention reason has a Hebrew label", () => {
    for (const r of ATTENTION_REASONS) expect(decisionAttention.reason[r], r).toMatch(HEBREW);
  });

  it("every next action kind has a Hebrew reason and destination", () => {
    for (const k of NEXT_ACTION_KINDS) {
      expect(nextActions.reason[k], k).toMatch(HEBREW);
      expect(nextActions.destination[k], k).toMatch(HEBREW);
    }
  });

  it("every decision-scoped next action the engine emits has an in-row fact for the join", () => {
    const today = new Date("2026-09-30T12:00:00Z");
    const old = new Date("2026-06-01T12:00:00Z");
    const emitted = deriveNextActions({
      today,
      decisions: [
        { id: "a", ticker: "AAAA", decisionType: "BUY", decisionDate: old, reviewByDate: null, reviewCount: 0, unclassifiedCandidateCount: 1 },
        { id: "b", ticker: "BBBB", decisionType: "BUY", decisionDate: old, reviewByDate: old, reviewCount: 0, unclassifiedCandidateCount: 0 },
      ],
      openConditions: [{ predictionId: "p", decisionId: "a", ticker: "AAAA", decisionType: "BUY", checkableByDate: old }],
      cases: [],
      episodes: [],
      reach: { dna: { uncitedStatements: 0, regenerationMayChangeReach: false }, strategy: { uncitedStatements: 0, regenerationMayChangeReach: false } },
    });
    const scoped = [...new Set(emitted.filter((a) => a.decision).map((a) => a.kind))];
    expect(scoped.sort()).toEqual(["RESOLVE_EXECUTION_CANDIDATES", "RESOLVE_OPEN_REENTRY_CONDITION", "REVIEW_UNREVIEWED_DECISION", "SET_REVIEW_HORIZON"]);
    for (const k of scoped) expect(homePage.joinedFact[k], k).toMatch(HEBREW);
  });

  it("every monitoring state, review-date status and portfolio status has a Hebrew label", () => {
    for (const s of ["attention", "monitoring", "settled"]) expect(homePage.state[s], s).toMatch(HEBREW);
    for (const s of ["not_set", "upcoming", "due", "satisfied"]) expect(homePage.horizon[s], s).toMatch(HEBREW);
    for (const s of ["ok", "warnings", "unavailable"]) expect(homePage.portfolioStatus[s], s).toMatch(HEBREW);
  });

  it("section titles and empty states are Hebrew", () => {
    for (const key of ["title", "attentionTitle", "attentionEmpty", "stepsTitle", "stepsEmpty", "monitoringTitle", "monitoringEmpty", "conditionsTitle", "conditionsEmpty", "researchTitle", "researchEmpty", "memoryTitle", "memoryEmpty"] as const) {
      expect(homePage[key], key).toMatch(HEBREW);
    }
  });
});
