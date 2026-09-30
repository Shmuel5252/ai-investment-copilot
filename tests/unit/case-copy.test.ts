import { describe, expect, it } from "vitest";
import { deriveReadiness } from "@/components/case/derive-readiness";
import { DECISION_TYPES } from "@/components/case/decision-regions";
import { caseDetailPage, casesListPage, caseStatusLabel, decisionTypeLabel, priorRecord, reviewQualityLabel, thesisAccuracyLabel } from "@/lib/i18n/strings";
import { decisionQualityEnum, thesisAccuracyEnum } from "@/db/schema/enums";

// Frontend V1 unit 3 — the Case chrome is Hebrew. The only English strings are
// the product terms AGENTS.md keeps untranslated (Portfolio Fit, Personal Fit).
const HEBREW = /[א-ת]/;
const ENGLISH_BY_RULE = new Set(["portfolioFitTitle", "personalFitTitle"]);

describe("Case copy coverage", () => {
  it("every Case string is Hebrew, except the fixed English product terms", () => {
    for (const [key, value] of Object.entries(caseDetailPage)) {
      if (typeof value !== "string") continue;
      if (ENGLISH_BY_RULE.has(key)) expect(value, key).toMatch(/^(Portfolio|Personal) Fit$/);
      else expect(value, key).toMatch(HEBREW);
    }
  });

  it("every readiness rule and inventory row the derivation can emit has Hebrew copy", () => {
    const r = deriveReadiness({
      status: "researching",
      hasApprovedStrategy: undefined,
      reasoningText: "",
      reviewHorizon: "",
      reviewByDate: "",
      marketFetched: false,
      fitComputedThisVisit: false,
      personalFitGenerated: false,
      readingGenerated: false,
    });
    for (const { key } of r.rules) expect(caseDetailPage.rule[key], key).toMatch(HEBREW);
    for (const { key } of r.inventory) expect(caseDetailPage.inventory[key], key).toMatch(key === "personalFit" ? /^Personal Fit$/ : HEBREW);
  });

  it("every decision type and case status has a Hebrew label", () => {
    for (const d of DECISION_TYPES) expect(decisionTypeLabel[d], d).toMatch(HEBREW);
    for (const s of ["researching", "decided", "archived"]) expect(caseStatusLabel[s], s).toMatch(HEBREW);
  });

  it("the cases list and the shared prior record copy are Hebrew", () => {
    for (const [key, value] of Object.entries(casesListPage)) {
      if (key === "tickerPlaceholder") continue; // "טיקר, למשל AAPL" is mixed on purpose
      expect(value, key).toMatch(HEBREW);
    }
    for (const [key, value] of Object.entries(priorRecord)) expect(value, key).toMatch(HEBREW);
  });

  it("every stored Review verdict value has a Hebrew display label for the Prior Record", () => {
    for (const v of decisionQualityEnum.enumValues) expect(reviewQualityLabel[v], v).toMatch(HEBREW);
    for (const v of thesisAccuracyEnum.enumValues) expect(thesisAccuracyLabel[v], v).toMatch(HEBREW);
  });
});
