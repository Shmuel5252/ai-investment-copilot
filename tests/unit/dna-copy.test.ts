import { describe, expect, it } from "vitest";
import { decisionStatementKindLabel, dnaCreatedByLabel, dnaPage, evidenceSourceLabel } from "@/lib/i18n/strings";
import { dnaCreatedByEnum, decisionStatementKindEnum } from "@/db/schema/enums";
import { sourceKindOf } from "@/components/claims/evidence-disclosure";

// Frontend V1 unit 6A — the DNA chrome is Hebrew, every stored value the page
// can meet has a Hebrew label, and the words never make the tier a grade.
const HEBREW = /[א-ת]/;

describe("DNA copy coverage", () => {
  it("every DNA page string is Hebrew", () => {
    for (const [key, value] of Object.entries(dnaPage)) expect(value, key).toMatch(HEBREW);
  });

  it("every stored origin and decision text kind has a label", () => {
    for (const v of dnaCreatedByEnum.enumValues) expect(dnaCreatedByLabel[v], v).toMatch(HEBREW);
    for (const v of decisionStatementKindEnum.enumValues) expect(decisionStatementKindLabel[v], v).toMatch(HEBREW);
  });

  it("every source kind the page can derive has a label", () => {
    const base = { id: "x", stance: "supporting", interviewAnswerId: null, decisionId: null, decisionStatementKind: null, decisionReviewId: null, transactionId: null, sourceLearningInsightId: null, manualNoteText: null, description: "", createdAt: "" };
    const kinds = [
      sourceKindOf({ ...base, interviewAnswerId: "1" }),
      sourceKindOf({ ...base, decisionId: "1" }),
      sourceKindOf({ ...base, decisionReviewId: "1" }),
      sourceKindOf({ ...base, transactionId: "1" }),
      sourceKindOf({ ...base, sourceLearningInsightId: "1" }),
      sourceKindOf({ ...base, manualNoteText: "n" }),
      sourceKindOf(base),
    ];
    // "Review" is the product term kept in English across the chrome
    for (const k of kinds) expect(evidenceSourceLabel[k], k).toMatch(k === "decision_review" ? /^Review$/ : HEBREW);
  });

  it("the page says the tier describes the claim, not the investor, and never calls a claim proven", () => {
    expect(dnaPage.description).toContain("לא ציון שלך כמשקיע");
    const all = Object.values(dnaPage).join(" ");
    for (const word of ["הוכח", "מוכח", "אישיות", "אבחנה", "תמיד "]) expect(all, word).not.toContain(word);
  });
});
