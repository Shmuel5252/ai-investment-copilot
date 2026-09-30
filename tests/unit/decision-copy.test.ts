import { describe, expect, it } from "vitest";
import { citedFieldLabel, decisionPage, decisionsListPage, reviewDimensionLabel, reviewQualityLabel, thesisAccuracyLabel } from "@/lib/i18n/strings";
import { decisionQualityEnum, thesisAccuracyEnum, reviewDimensionNameEnum } from "@/db/schema/enums";
import { CITABLE_SNAPSHOT_FIELDS, EXECUTION_FACTS_CITABLE_FIELD, PRIOR_RECORD_CITABLE_FIELD } from "@/lib/review/validate-review-dimensions";

// Frontend V1 unit 4 — the Decision chrome is Hebrew, and every stored Review
// value the page can meet has a display label, taken from the production
// enums and the review engine's own citable field list.
const HEBREW = /[א-ת]/;
// The fixed English product terms AGENTS.md keeps untranslated.
const ENGLISH_TERM = /^(Portfolio Fit|Personal Fit)$/;

describe("Decision copy coverage", () => {
  it("every Decision page string is Hebrew", () => {
    for (const [key, value] of Object.entries(decisionPage)) {
      if (typeof value === "string") expect(value, key).toMatch(HEBREW);
      else for (const [k, v] of Object.entries(value)) expect(v, `${key}.${k}`).toMatch(HEBREW);
    }
    for (const [key, value] of Object.entries(decisionsListPage)) expect(value, key).toMatch(HEBREW);
  });

  it("every Review verdict, thesis-accuracy value and dimension has a display label", () => {
    for (const v of decisionQualityEnum.enumValues) expect(reviewQualityLabel[v], v).toMatch(HEBREW);
    for (const v of thesisAccuracyEnum.enumValues) expect(thesisAccuracyLabel[v], v).toMatch(HEBREW);
    for (const v of reviewDimensionNameEnum.enumValues) expect(reviewDimensionLabel[v], v).toMatch(new RegExp(`${HEBREW.source}|${ENGLISH_TERM.source}`));
  });

  it("every field the review engine can cite has a display label", () => {
    for (const f of [...CITABLE_SNAPSHOT_FIELDS, PRIOR_RECORD_CITABLE_FIELD, EXECUTION_FACTS_CITABLE_FIELD]) expect(citedFieldLabel[f], f).toMatch(HEBREW);
  });
});
