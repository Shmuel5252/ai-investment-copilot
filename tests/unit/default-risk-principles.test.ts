import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PRINCIPLES } from "@/lib/strategy/default-risk-principles";

describe("DEFAULT_RISK_PRINCIPLES", () => {
  it("has at least one fixed baseline principle (Baseline Strategy Done bar needs >=1 validated principle)", () => {
    expect(DEFAULT_RISK_PRINCIPLES.length).toBeGreaterThanOrEqual(1);
  });

  it("has unique, stable slug keys", () => {
    const keys = DEFAULT_RISK_PRINCIPLES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every principle has non-empty statement and rationale text", () => {
    for (const p of DEFAULT_RISK_PRINCIPLES) {
      expect(p.statementText.trim().length).toBeGreaterThan(0);
      expect(p.rationaleText.trim().length).toBeGreaterThan(0);
    }
  });
});
