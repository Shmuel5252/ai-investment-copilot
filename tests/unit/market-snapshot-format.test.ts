import { describe, expect, it } from "vitest";
import { compactUsd, yieldPercent } from "@/components/case/parts";

describe("market snapshot display formats", () => {
  it("shows a stored yield ratio as a percent with two decimals", () => {
    expect(yieldPercent(0.0031766)).toBe("0.32%");
    expect(yieldPercent(0)).toBe("0.00%");
    expect(yieldPercent(0.00756521)).toBe("0.76%");
  });

  it("compacts market cap to T / B / M", () => {
    expect(compactUsd(4_901_023_823_640)).toBe("$4.90T");
    expect(compactUsd(84_200_000_000)).toBe("$84.20B");
    expect(compactUsd(512_300_000)).toBe("$512.30M");
    expect(compactUsd(1_000_000_000_000)).toBe("$1.00T");
  });

  it("keeps the full figure below a million and moves up a unit when rounding reaches 1000", () => {
    expect(compactUsd(999_999)).toBe("$999,999");
    expect(compactUsd(999_996_000)).toBe("$1.00B");
  });
});
