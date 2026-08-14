import { describe, expect, it } from "vitest";
import { computePortfolioFit } from "@/lib/portfolio/portfolio-fit";
import type { PortfolioState } from "@/lib/portfolio/positions";

function portfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    asOfDate: new Date("2026-01-01"),
    cash: 1000,
    positions: [],
    warnings: [],
    sellTrace: [],
    ...overrides,
  };
}

describe("computePortfolioFit", () => {
  it("reports zero exposure for a ticker not currently held", () => {
    const fit = computePortfolioFit(portfolio({ cash: 5000 }), {}, { ticker: "AAPL", price: 200 });
    expect(fit.existingHoldingQuantity).toBe(0);
    expect(fit.existingPositionValueUsd).toBe(0);
    expect(fit.existingWeightPercent).toBe(0);
    expect(fit.totalPortfolioValueUsd).toBe(5000);
    expect(fit.holdingsCount).toBe(0);
  });

  it("values a held position at its live price and computes weight against total portfolio value", () => {
    const p = portfolio({
      cash: 1000,
      positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 150, costBasisConfidence: "known" }],
    });
    // total = 1000 cash + 10*200 (live) = 3000; AAPL value = 2000; weight = 2000/3000
    const fit = computePortfolioFit(p, { AAPL: 200 }, { ticker: "AAPL", price: 200 });
    expect(fit.totalPortfolioValueUsd).toBe(3000);
    expect(fit.existingPositionValueUsd).toBe(2000);
    expect(fit.existingWeightPercent).toBeCloseTo((2000 / 3000) * 100);
    expect(fit.totalPortfolioValueApproximate).toBe(false);
  });

  it("falls back to cost basis and warns when a held position has no live price", () => {
    const p = portfolio({
      cash: 0,
      positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 150, costBasisConfidence: "known" }],
    });
    const fit = computePortfolioFit(p, {}, { ticker: "MSFT", price: 400 });
    expect(fit.totalPortfolioValueUsd).toBe(1500); // 10 * costBasisPerShare(150)
    expect(fit.totalPortfolioValueApproximate).toBe(true);
    expect(fit.warnings.some((w) => w.includes("AAPL"))).toBe(true);
  });

  it("computes a projected weight from a hypothetical size without changing total portfolio value", () => {
    const p = portfolio({
      cash: 10000,
      positions: [{ ticker: "AAPL", quantity: 5, costBasisPerShare: 150, costBasisConfidence: "known" }],
    });
    // total = 10000 + 5*200 = 11000; existing AAPL value = 1000
    const fit = computePortfolioFit(p, { AAPL: 200 }, { ticker: "AAPL", price: 200, sizeDollars: 2000 });
    expect(fit.totalPortfolioValueUsd).toBe(11000);
    expect(fit.projectedPositionValueUsd).toBe(3000); // 1000 existing + 2000 hypothetical
    expect(fit.projectedWeightPercent).toBeCloseTo((3000 / 11000) * 100);
  });

  it("warns when the hypothetical size exceeds available cash", () => {
    const p = portfolio({ cash: 500 });
    const fit = computePortfolioFit(p, {}, { ticker: "NVDA", price: 100, sizeDollars: 5000 });
    expect(fit.warnings.some((w) => w.includes("exceeds available cash"))).toBe(true);
  });

  it("does not warn about exceeding cash when the hypothetical size fits within it", () => {
    const p = portfolio({ cash: 5000 });
    const fit = computePortfolioFit(p, {}, { ticker: "NVDA", price: 100, sizeDollars: 1000 });
    expect(fit.warnings.some((w) => w.includes("exceeds available cash"))).toBe(false);
  });

  it("identifies the current largest position by market value", () => {
    const p = portfolio({
      cash: 0,
      positions: [
        { ticker: "AAPL", quantity: 10, costBasisPerShare: 150, costBasisConfidence: "known" },
        { ticker: "MSFT", quantity: 5, costBasisPerShare: 300, costBasisConfidence: "known" },
      ],
    });
    // AAPL value = 10*200=2000, MSFT value = 5*400=2000 -> tie goes to first seen (AAPL)
    const fit = computePortfolioFit(p, { AAPL: 200, MSFT: 400 }, { ticker: "AAPL", price: 200 });
    expect(fit.largestCurrentPositionTicker).toBe("AAPL");
    expect(fit.largestCurrentPositionWeightPercent).toBeCloseTo((2000 / 4000) * 100);
  });

  it("warns when a hypothetical addition would overtake the current largest position", () => {
    const p = portfolio({
      cash: 10000,
      positions: [
        { ticker: "AAPL", quantity: 1, costBasisPerShare: 150, costBasisConfidence: "known" },
        { ticker: "MSFT", quantity: 10, costBasisPerShare: 300, costBasisConfidence: "known" }, // 10*400=4000, the current largest
      ],
    });
    const fit = computePortfolioFit(
      p,
      { AAPL: 150, MSFT: 400 },
      { ticker: "AAPL", price: 150, sizeDollars: 5000 } // 150 existing + 5000 = 5150 > 4000
    );
    expect(fit.warnings.some((w) => w.includes("largest position") && w.includes("MSFT"))).toBe(true);
  });

  it("does not warn about becoming the largest position when it already is", () => {
    const p = portfolio({
      cash: 10000,
      positions: [{ ticker: "AAPL", quantity: 100, costBasisPerShare: 150, costBasisConfidence: "known" }],
    });
    const fit = computePortfolioFit(p, { AAPL: 200 }, { ticker: "AAPL", price: 200, sizeDollars: 500 });
    expect(fit.warnings.some((w) => w.includes("largest position"))).toBe(false);
  });

  it("leaves projected fields null when no hypothetical size is given", () => {
    const fit = computePortfolioFit(portfolio(), {}, { ticker: "AAPL", price: 200 });
    expect(fit.projectedPositionValueUsd).toBeNull();
    expect(fit.projectedWeightPercent).toBeNull();
  });

  it("handles an empty portfolio (cash only) without error", () => {
    const fit = computePortfolioFit(portfolio({ cash: 250 }), {}, { ticker: "AAPL", price: 200 });
    expect(fit.totalPortfolioValueUsd).toBe(250);
    expect(fit.largestCurrentPositionTicker).toBeNull();
    expect(fit.largestCurrentPositionWeightPercent).toBeNull();
    expect(fit.holdingsCount).toBe(0);
  });
});
