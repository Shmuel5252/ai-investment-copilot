import { describe, expect, it } from "vitest";
import { computePercentChange } from "@/lib/market/market-context-fmp";

describe("computePercentChange", () => {
  it("computes a positive change correctly", () => {
    expect(computePercentChange(100, 110)).toBeCloseTo(10);
  });

  it("computes a negative change correctly", () => {
    expect(computePercentChange(100, 90)).toBeCloseTo(-10);
  });

  it("returns 0 for no change", () => {
    expect(computePercentChange(100, 100)).toBe(0);
  });

  it("returns null instead of dividing by zero when the oldest value is 0", () => {
    expect(computePercentChange(0, 50)).toBeNull();
  });
});
