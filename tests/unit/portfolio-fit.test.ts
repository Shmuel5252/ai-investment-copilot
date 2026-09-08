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

  // Note on the tests above that pass a held candidate ticker through
  // `currentPricesByTicker` (e.g. `{ AAPL: 200 }` alongside
  // `candidate: { ticker: "AAPL", price: 200 }`): the value there always
  // happened to match `candidate.price`, so none of them could actually
  // prove which source wins for the candidate's own ticker — and neither
  // does it matter for what they're testing. They're left as-is (still
  // valid for the scenarios they cover). The tests below are the ones
  // that actually prove candidate-price precedence: real call sites
  // (portfolio-fit-for-investor.ts, decisions.ts) always exclude the
  // candidate from currentPricesByTicker — "already fetched once for the
  // candidate itself, no reason to fetch it twice" — so
  // currentPricesByTicker[candidate.ticker] is undefined in production;
  // a real gap existed where that made an already-held candidate's own
  // valuation silently fall back to cost basis despite a live price
  // already in memory (docs/backlog.md).
  describe("candidate price precedence — real call-site conditions", () => {
    it("uses candidate.price when the candidate ticker is absent from currentPricesByTicker, matching both real call sites", () => {
      const p = portfolio({
        cash: 1000,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const fit = computePortfolioFit(p, {}, { ticker: "AAPL", price: 150 });
      expect(fit.existingPositionValueUsd).toBe(1500);
      expect(fit.totalPortfolioValueUsd).toBe(2500);
      expect(fit.existingWeightPercent).toBeCloseTo(60);
    });

    it("candidate.price wins over a conflicting currentPricesByTicker entry for the same ticker", () => {
      const p = portfolio({
        cash: 1000,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      // Deliberately different values (150 vs 120) — the only way to
      // actually prove which source wins, not just that the function runs.
      const fit = computePortfolioFit(p, { AAPL: 120 }, { ticker: "AAPL", price: 150 });
      expect(fit.existingPositionValueUsd).toBe(1500); // 10*150, not 10*120=1200
      expect(fit.totalPortfolioValueUsd).toBe(2500); // not 2200
    });

    it("projected valuation is built from the corrected existing valuation, not cost basis", () => {
      const p = portfolio({
        cash: 1000,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const fit = computePortfolioFit(p, {}, { ticker: "AAPL", price: 150, sizeDollars: 500 });
      expect(fit.existingPositionValueUsd).toBe(1500);
      expect(fit.totalPortfolioValueUsd).toBe(2500);
      expect(fit.projectedPositionValueUsd).toBe(2000); // 1500 + 500, not 1000(cost-basis) + 500
      expect(fit.projectedWeightPercent).toBeCloseTo(80);
    });

    it("does not mark the portfolio approximate or warn about the candidate's own ticker when candidate.price is available", () => {
      const p = portfolio({
        cash: 1000,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const fit = computePortfolioFit(p, {}, { ticker: "AAPL", price: 150 });
      expect(fit.totalPortfolioValueApproximate).toBe(false);
      expect(fit.warnings.some((w) => w.includes("AAPL"))).toBe(false);
    });

    it("other holdings without a live price still warn and mark the portfolio approximate, unaffected by the candidate fix", () => {
      const p = portfolio({
        cash: 0,
        positions: [
          { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }, // candidate
          { ticker: "MSFT", quantity: 5, costBasisPerShare: 300, costBasisConfidence: "known" }, // no live price given
        ],
      });
      const fit = computePortfolioFit(p, {}, { ticker: "AAPL", price: 150 });
      expect(fit.totalPortfolioValueApproximate).toBe(true);
      expect(fit.warnings.some((w) => w.includes("MSFT"))).toBe(true);
      expect(fit.warnings.some((w) => w.includes("AAPL"))).toBe(false);
    });

    it("the corrected candidate valuation can flip which position is currently largest", () => {
      const p = portfolio({
        cash: 0,
        positions: [
          { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }, // candidate: cost-basis value 1000, corrected value 1500
          { ticker: "MSFT", quantity: 5, costBasisPerShare: 250, costBasisConfidence: "known" }, // value 1250, currently the largest by cost basis
        ],
      });
      // Without the fix: AAPL=1000 (cost basis) < MSFT=1250 -> MSFT largest.
      // With the fix: AAPL=1500 (candidate.price) > MSFT=1250 -> AAPL largest.
      const fit = computePortfolioFit(p, { MSFT: 250 }, { ticker: "AAPL", price: 150 });
      expect(fit.largestCurrentPositionTicker).toBe("AAPL");
      expect(fit.largestCurrentPositionWeightPercent).toBeCloseTo((1500 / 2750) * 100);
    });

    it("does not force the candidate to become largest when it genuinely isn't, even after correction", () => {
      const p = portfolio({
        cash: 0,
        positions: [
          { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }, // candidate: corrected value 1500
          { ticker: "MSFT", quantity: 100, costBasisPerShare: 300, costBasisConfidence: "known" }, // value 30000, still far larger
        ],
      });
      const fit = computePortfolioFit(p, { MSFT: 300 }, { ticker: "AAPL", price: 150 });
      expect(fit.largestCurrentPositionTicker).toBe("MSFT");
    });
  });
});
