// Open-Decision Monitoring V1 — the explicit review-horizon choice
// (src/lib/monitoring/review-horizon.ts): the production zod schema and the
// resolver the decisions router uses.
import { describe, expect, it } from "vitest";
import { normalizeReviewByDate, resolveReviewByDate, reviewHorizonChoiceSchema, ReviewHorizonError } from "@/lib/monitoring/review-horizon";

const decisionDate = new Date("2026-09-08T07:10:53Z");

describe("reviewHorizonChoiceSchema", () => {
  it("accepts an explicit date choice and an explicit 'none'", () => {
    expect(reviewHorizonChoiceSchema.parse({ choice: "date", reviewByDate: "2026-12-01" })).toEqual({ choice: "date", reviewByDate: new Date("2026-12-01") });
    expect(reviewHorizonChoiceSchema.parse({ choice: "none" })).toEqual({ choice: "none" });
  });
  it("rejects a missing choice, an unknown choice, and a date choice without a date — never a silent default", () => {
    expect(reviewHorizonChoiceSchema.safeParse(undefined).success).toBe(false);
    expect(reviewHorizonChoiceSchema.safeParse({}).success).toBe(false);
    expect(reviewHorizonChoiceSchema.safeParse({ choice: "later" }).success).toBe(false);
    expect(reviewHorizonChoiceSchema.safeParse({ choice: "date" }).success).toBe(false);
    expect(reviewHorizonChoiceSchema.safeParse({ choice: "none", reviewByDate: "2026-12-01" }).success).toBe(false);
  });
});

describe("resolveReviewByDate", () => {
  it("'none' resolves to NULL for any decision type, including PASS", () => {
    expect(resolveReviewByDate({ choice: "none" }, decisionDate)).toBeNull();
  });
  it("a date is normalized to 00:00Z (date-only)", () => {
    expect(resolveReviewByDate({ choice: "date", reviewByDate: new Date("2026-12-01T15:30:00Z") }, decisionDate)!.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(normalizeReviewByDate(new Date("2026-09-08T23:59:59Z")).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });
  it("the decision's own day is allowed; an earlier day is refused; an invalid date is refused", () => {
    expect(resolveReviewByDate({ choice: "date", reviewByDate: new Date("2026-09-08T00:00:00Z") }, decisionDate)!.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(() => resolveReviewByDate({ choice: "date", reviewByDate: new Date("2026-09-07T23:00:00Z") }, decisionDate)).toThrow(ReviewHorizonError);
    expect(() => resolveReviewByDate({ choice: "date", reviewByDate: new Date("not a date") }, decisionDate)).toThrow(ReviewHorizonError);
  });
});
