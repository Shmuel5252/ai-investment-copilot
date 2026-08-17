import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/db/errors";

describe("isUniqueViolation", () => {
  it("matches a genuine unique-violation with the exact constraint name", () => {
    const err = { cause: { code: "23505", constraint_name: "decisions_investment_case_id_unique" } };
    expect(isUniqueViolation(err, "decisions_investment_case_id_unique")).toBe(true);
  });

  it("does not match a unique-violation on a different constraint", () => {
    const err = { cause: { code: "23505", constraint_name: "strategy_principles_investor_id_key_unique" } };
    expect(isUniqueViolation(err, "decisions_investment_case_id_unique")).toBe(false);
  });

  it("does not match a different Postgres error code (e.g. a FK violation)", () => {
    const err = { cause: { code: "23503", constraint_name: "decisions_investment_case_id_unique" } };
    expect(isUniqueViolation(err, "decisions_investment_case_id_unique")).toBe(false);
  });

  it("does not match when there is no cause at all (e.g. a network error)", () => {
    expect(isUniqueViolation(new Error("connect ECONNREFUSED"), "decisions_investment_case_id_unique")).toBe(false);
  });

  it("does not match null/undefined", () => {
    expect(isUniqueViolation(null, "decisions_investment_case_id_unique")).toBe(false);
    expect(isUniqueViolation(undefined, "decisions_investment_case_id_unique")).toBe(false);
  });
});
