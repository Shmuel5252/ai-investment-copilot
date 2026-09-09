import { describe, expect, it } from "vitest";
import {
  computePortfolioFit,
  type PortfolioFitCandidate,
  type TickerClassification,
} from "@/lib/portfolio/portfolio-fit";
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

// Convenience default for tests that don't care about classification —
// sector/industry are required on the real type (docs/backlog.md: never
// made optional just so old test literals would still compile), but a
// helper default here is just test ergonomics, not a type relaxation.
function candidate(overrides: Partial<PortfolioFitCandidate> & { ticker: string; price: number }): PortfolioFitCandidate {
  return { sector: null, industry: null, ...overrides };
}

const noClassification: Readonly<Record<string, TickerClassification>> = {};

describe("computePortfolioFit", () => {
  it("reports zero exposure for a ticker not currently held", () => {
    const fit = computePortfolioFit(portfolio({ cash: 5000 }), {}, candidate({ ticker: "AAPL", price: 200 }), noClassification);
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
    const fit = computePortfolioFit(p, { AAPL: 200 }, candidate({ ticker: "AAPL", price: 200 }), noClassification);
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
    const fit = computePortfolioFit(p, {}, candidate({ ticker: "MSFT", price: 400 }), noClassification);
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
    const fit = computePortfolioFit(p, { AAPL: 200 }, candidate({ ticker: "AAPL", price: 200, sizeDollars: 2000 }), noClassification);
    expect(fit.totalPortfolioValueUsd).toBe(11000);
    expect(fit.projectedPositionValueUsd).toBe(3000); // 1000 existing + 2000 hypothetical
    expect(fit.projectedWeightPercent).toBeCloseTo((3000 / 11000) * 100);
  });

  it("warns when the hypothetical size exceeds available cash", () => {
    const p = portfolio({ cash: 500 });
    const fit = computePortfolioFit(p, {}, candidate({ ticker: "NVDA", price: 100, sizeDollars: 5000 }), noClassification);
    expect(fit.warnings.some((w) => w.includes("exceeds available cash"))).toBe(true);
  });

  it("does not warn about exceeding cash when the hypothetical size fits within it", () => {
    const p = portfolio({ cash: 5000 });
    const fit = computePortfolioFit(p, {}, candidate({ ticker: "NVDA", price: 100, sizeDollars: 1000 }), noClassification);
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
    const fit = computePortfolioFit(p, { AAPL: 200, MSFT: 400 }, candidate({ ticker: "AAPL", price: 200 }), noClassification);
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
      candidate({ ticker: "AAPL", price: 150, sizeDollars: 5000 }), // 150 existing + 5000 = 5150 > 4000
      noClassification
    );
    expect(fit.warnings.some((w) => w.includes("largest position") && w.includes("MSFT"))).toBe(true);
  });

  it("does not warn about becoming the largest position when it already is", () => {
    const p = portfolio({
      cash: 10000,
      positions: [{ ticker: "AAPL", quantity: 100, costBasisPerShare: 150, costBasisConfidence: "known" }],
    });
    const fit = computePortfolioFit(p, { AAPL: 200 }, candidate({ ticker: "AAPL", price: 200, sizeDollars: 500 }), noClassification);
    expect(fit.warnings.some((w) => w.includes("largest position"))).toBe(false);
  });

  it("leaves projected fields null when no hypothetical size is given", () => {
    const fit = computePortfolioFit(portfolio(), {}, candidate({ ticker: "AAPL", price: 200 }), noClassification);
    expect(fit.projectedPositionValueUsd).toBeNull();
    expect(fit.projectedWeightPercent).toBeNull();
    expect(fit.projectedCashValueUsd).toBeNull();
    expect(fit.projectedCashWeightPercent).toBeNull();
    expect(fit.projectedSectorExposure).toBeNull();
    expect(fit.projectedIndustryExposure).toBeNull();
  });

  it("handles an empty portfolio (cash only) without error", () => {
    const fit = computePortfolioFit(portfolio({ cash: 250 }), {}, candidate({ ticker: "AAPL", price: 200 }), noClassification);
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
      const fit = computePortfolioFit(p, {}, candidate({ ticker: "AAPL", price: 150 }), noClassification);
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
      const fit = computePortfolioFit(p, { AAPL: 120 }, candidate({ ticker: "AAPL", price: 150 }), noClassification);
      expect(fit.existingPositionValueUsd).toBe(1500); // 10*150, not 10*120=1200
      expect(fit.totalPortfolioValueUsd).toBe(2500); // not 2200
    });

    it("projected valuation is built from the corrected existing valuation, not cost basis", () => {
      const p = portfolio({
        cash: 1000,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const fit = computePortfolioFit(p, {}, candidate({ ticker: "AAPL", price: 150, sizeDollars: 500 }), noClassification);
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
      const fit = computePortfolioFit(p, {}, candidate({ ticker: "AAPL", price: 150 }), noClassification);
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
      const fit = computePortfolioFit(p, {}, candidate({ ticker: "AAPL", price: 150 }), noClassification);
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
      const fit = computePortfolioFit(p, { MSFT: 250 }, candidate({ ticker: "AAPL", price: 150 }), noClassification);
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
      const fit = computePortfolioFit(p, { MSFT: 300 }, candidate({ ticker: "AAPL", price: 150 }), noClassification);
      expect(fit.largestCurrentPositionTicker).toBe("MSFT");
    });
  });

  // Shared fixture for the sector/industry exposure tests below:
  // cash=1000; AAPL+MSFT both Technology/Software (tests aggregation
  // into one bucket); JNJ is Healthcare/Pharmaceuticals (a distinct
  // bucket); XYZ has no classification data at all (Unclassified).
  // total = 1000(cash) + 1000+1000+1000+1000 = 5000.
  function multiSectorPortfolio(): PortfolioState {
    return portfolio({
      cash: 1000,
      positions: [
        { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
        { ticker: "MSFT", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
        { ticker: "JNJ", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
        { ticker: "XYZ", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
      ],
    });
  }
  const multiSectorPrices = { AAPL: 100, MSFT: 100, JNJ: 100, XYZ: 100 };
  const multiSectorClassification: Readonly<Record<string, TickerClassification>> = {
    AAPL: { sector: "Technology", industry: "Software" },
    MSFT: { sector: "Technology", industry: "Software" },
    JNJ: { sector: "Healthcare", industry: "Pharmaceuticals" },
    XYZ: { sector: null, industry: null },
  };
  // Not currently held, its own distinct sector/industry — used for the
  // "new candidate" and most projected tests below.
  const newCandidate = (extra: Partial<PortfolioFitCandidate> = {}) =>
    candidate({ ticker: "NEW", price: 100, sector: "Energy", industry: "Oil & Gas", ...extra });

  describe("sector/industry exposure — current state", () => {
    it("aggregates multiple holdings in the same sector into one bucket", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const tech = fit.sectorExposure.find((e) => e.sector === "Technology");
      expect(tech?.valueUsd).toBe(2000); // AAPL(1000) + MSFT(1000)
      expect(tech?.weightPercent).toBeCloseTo(40, 8);
    });

    it("aggregates multiple holdings in the same industry into one bucket", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const software = fit.industryExposure.find((e) => e.industry === "Software");
      expect(software?.valueUsd).toBe(2000);
      expect(software?.weightPercent).toBeCloseTo(40, 8);
    });

    it("keeps different sectors (and industries) as separate buckets", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      expect(fit.sectorExposure).toHaveLength(3); // Technology, Healthcare, null(Unclassified)
      expect(fit.industryExposure).toHaveLength(3); // Software, Pharmaceuticals, null(Unclassified)
    });

    it("puts a holding with sector=null in the Unclassified (null) bucket, not dropped", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const unclassified = fit.sectorExposure.find((e) => e.sector === null);
      expect(unclassified?.valueUsd).toBe(1000); // XYZ only
    });

    it("puts a holding with industry=null in the Unclassified (null) bucket, not dropped", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const unclassified = fit.industryExposure.find((e) => e.industry === null);
      expect(unclassified?.valueUsd).toBe(1000);
    });

    it("never counts cash inside the null (Unclassified) bucket", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const unclassified = fit.sectorExposure.find((e) => e.sector === null);
      expect(unclassified?.valueUsd).toBe(1000); // XYZ(1000) only, NOT +cash(1000)=2000
    });

    it("exposes cash as its own concept, distinct from any classification bucket", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      expect(fit.cashValueUsd).toBe(1000);
      expect(fit.cashWeightPercent).toBeCloseTo(20, 8);
    });

    it("current sector invariant: cashWeightPercent + sum(sectorExposure.weightPercent) ≈ 100%", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const sum = fit.cashWeightPercent + fit.sectorExposure.reduce((s, e) => s + e.weightPercent, 0);
      expect(sum).toBeCloseTo(100, 8);
    });

    it("current industry invariant: cashWeightPercent + sum(industryExposure.weightPercent) ≈ 100%", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      const sum = fit.cashWeightPercent + fit.industryExposure.reduce((s, e) => s + e.weightPercent, 0);
      expect(sum).toBeCloseTo(100, 8);
    });

    it("a new, unheld candidate with its own sector/industry does not appear in current exposure", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      expect(fit.sectorExposure.find((e) => e.sector === "Energy")).toBeUndefined();
      expect(fit.industryExposure.find((e) => e.industry === "Oil & Gas")).toBeUndefined();
    });

    it("a held ticker that is not the candidate and has no entry at all in classificationByTicker falls into the null (Unclassified) bucket, cash stays separate (external-review coverage gap)", () => {
      const p = portfolio({
        cash: 300,
        positions: [{ ticker: "ZZZ", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      // ZZZ is a real holding but simply absent from classificationByTicker
      // (e.g. the market-data fetch for it failed — see the try/catch in
      // portfolio-fit-for-investor.ts/decisions.ts) — distinct from the
      // candidate-precedence tests above, which are about the candidate's
      // *own* ticker being excluded from the map on purpose.
      const fit = computePortfolioFit(p, { ZZZ: 100 }, candidate({ ticker: "OTHER", price: 50 }), {});
      expect(fit.sectorExposure.find((e) => e.sector === null)?.valueUsd).toBe(1000);
      expect(fit.industryExposure.find((e) => e.industry === null)?.valueUsd).toBe(1000);
      expect(fit.cashValueUsd).toBe(300);
    });
  });

  describe("sector/industry exposure — projected state", () => {
    it("adds sizeDollars to the candidate's own sector/industry bucket in the projected breakdown (new bucket, since not currently held)", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate({ sizeDollars: 500 }), multiSectorClassification);
      expect(fit.projectedSectorExposure?.find((e) => e.sector === "Energy")?.valueUsd).toBe(500);
      expect(fit.projectedIndustryExposure?.find((e) => e.industry === "Oil & Gas")?.valueUsd).toBe(500);
      // Existing buckets are untouched by the projection.
      expect(fit.projectedSectorExposure?.find((e) => e.sector === "Technology")?.valueUsd).toBe(2000);
    });

    it("projected cash = cash - sizeDollars, with correct weightPercent", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate({ sizeDollars: 500 }), multiSectorClassification);
      expect(fit.projectedCashValueUsd).toBe(500); // 1000 - 500
      expect(fit.projectedCashWeightPercent).toBeCloseTo(10, 8); // 500/5000
    });

    it("projected sector invariant: projectedCashWeightPercent + sum(projectedSectorExposure.weightPercent) ≈ 100%", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate({ sizeDollars: 500 }), multiSectorClassification);
      const sum = fit.projectedCashWeightPercent! + fit.projectedSectorExposure!.reduce((s, e) => s + e.weightPercent, 0);
      expect(sum).toBeCloseTo(100, 8);
    });

    it("projected industry invariant: projectedCashWeightPercent + sum(projectedIndustryExposure.weightPercent) ≈ 100%", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate({ sizeDollars: 500 }), multiSectorClassification);
      const sum = fit.projectedCashWeightPercent! + fit.projectedIndustryExposure!.reduce((s, e) => s + e.weightPercent, 0);
      expect(sum).toBeCloseTo(100, 8);
    });

    it("sizeDollars exceeding cash: projected cash goes negative, no clamp, existing warning preserved, invariants still hold mathematically", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate({ sizeDollars: 1500 }), multiSectorClassification); // > cash(1000)
      expect(fit.projectedCashValueUsd).toBe(-500); // 1000 - 1500, not clamped to 0
      expect(fit.warnings.some((w) => w.includes("exceeds available cash"))).toBe(true);
      const sum = fit.projectedCashWeightPercent! + fit.projectedSectorExposure!.reduce((s, e) => s + e.weightPercent, 0);
      expect(sum).toBeCloseTo(100, 8); // still holds even with a negative cash bucket
    });

    it("leaves all projected exposure/cash fields null when sizeDollars is undefined", () => {
      const fit = computePortfolioFit(multiSectorPortfolio(), multiSectorPrices, newCandidate(), multiSectorClassification);
      expect(fit.projectedCashValueUsd).toBeNull();
      expect(fit.projectedCashWeightPercent).toBeNull();
      expect(fit.projectedSectorExposure).toBeNull();
      expect(fit.projectedIndustryExposure).toBeNull();
    });

    it("sizeDollars=0 is a defined projected state (not absent), semantically equal to current state — guards against a future truthiness bug", () => {
      // Uses a candidate already held (in an existing bucket) so adding
      // 0 doesn't introduce a brand-new zero-value bucket that a new,
      // unheld candidate's sector would — keeping this an unambiguous
      // equality check, not an off-by-one-bucket false negative.
      const p = portfolio({
        cash: 500,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const classification: Readonly<Record<string, TickerClassification>> = {};
      const zeroCandidate = candidate({ ticker: "AAPL", price: 150, sector: "Technology", industry: "Software", sizeDollars: 0 });
      const fit = computePortfolioFit(p, {}, zeroCandidate, classification);

      expect(fit.projectedCashValueUsd).not.toBeNull();
      expect(fit.projectedCashWeightPercent).not.toBeNull();
      expect(fit.projectedSectorExposure).not.toBeNull();
      expect(fit.projectedIndustryExposure).not.toBeNull();

      expect(fit.projectedCashValueUsd).toBe(fit.cashValueUsd);
      expect(fit.projectedCashWeightPercent).toBe(fit.cashWeightPercent);
      expect(fit.projectedSectorExposure).toEqual(fit.sectorExposure);
      expect(fit.projectedIndustryExposure).toEqual(fit.industryExposure);
    });

    // External review, blocker found in the raw-diff handoff: the
    // sizeDollars=0 test above deliberately used an ALREADY-HELD candidate
    // to sidestep a known risk — a brand-new, unheld candidate would
    // create a new bucket that doesn't exist in current exposure. That
    // risk was real and unguarded: addToBucket() unconditionally does
    // map.set(key, (map.get(key) ?? 0) + amount), so a fresh candidate
    // with sizeDollars=0 materialized a spurious zero-value bucket (e.g.
    // "Unclassified 0.0%") that current exposure never had. The two tests
    // below are exactly the case that was previously left unguarded.
    it("(A) a new, unheld, unclassified candidate with sizeDollars=0 does not create a spurious zero-value Unclassified bucket — projected exposure stays empty like current", () => {
      const p = portfolio({ cash: 1000, positions: [] });
      const zeroCandidate = candidate({ ticker: "NEW", price: 100, sizeDollars: 0 }); // sector/industry default to null via candidate()
      const fit = computePortfolioFit(p, {}, zeroCandidate, noClassification);

      expect(fit.sectorExposure).toEqual([]); // sanity: current is genuinely empty
      expect(fit.industryExposure).toEqual([]);

      expect(fit.projectedCashValueUsd).toBe(fit.cashValueUsd);
      expect(fit.projectedCashWeightPercent).toBe(fit.cashWeightPercent);
      expect(fit.projectedSectorExposure).not.toBeNull();
      expect(fit.projectedIndustryExposure).not.toBeNull();
      expect(fit.projectedSectorExposure).toEqual([]); // not [{ sector: null, valueUsd: 0, ... }]
      expect(fit.projectedIndustryExposure).toEqual([]);
    });

    it("(B) a new, unheld, CLASSIFIED candidate with sizeDollars=0 does not create a spurious zero-value bucket for its own sector/industry", () => {
      const p = portfolio({ cash: 1000, positions: [] });
      const zeroCandidate = candidate({
        ticker: "NEW",
        price: 100,
        sector: "Technology",
        industry: "Semiconductors",
        sizeDollars: 0,
      });
      const fit = computePortfolioFit(p, {}, zeroCandidate, noClassification);

      expect(fit.projectedSectorExposure).toEqual(fit.sectorExposure); // both []
      expect(fit.projectedIndustryExposure).toEqual(fit.industryExposure);
      expect(fit.projectedSectorExposure?.find((e) => e.sector === "Technology")).toBeUndefined();
      expect(fit.projectedIndustryExposure?.find((e) => e.industry === "Semiconductors")).toBeUndefined();
    });
  });

  describe("candidate classification precedence — real call-site conditions", () => {
    const heldPortfolio = () =>
      portfolio({
        cash: 500,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });

    it("an already-held candidate's current sector/industry aggregation uses candidate.sector/industry, not a missing classificationByTicker entry", () => {
      const fit = computePortfolioFit(
        heldPortfolio(),
        {}, // AAPL absent, matching real call sites (candidate-price-precedence fix, fb7e48f)
        candidate({ ticker: "AAPL", price: 150, sector: "Technology", industry: "Software" }),
        {} // AAPL absent from the classification map too, matching real call sites
      );
      expect(fit.sectorExposure.find((e) => e.sector === "Technology")?.valueUsd).toBe(1500); // 10 * candidate.price(150)
      expect(fit.industryExposure.find((e) => e.industry === "Software")?.valueUsd).toBe(1500);
    });

    it("candidate.sector/industry wins over a deliberately conflicting classificationByTicker entry for the same ticker", () => {
      const fit = computePortfolioFit(
        heldPortfolio(),
        {},
        candidate({ ticker: "AAPL", price: 150, sector: "Technology", industry: "Software" }),
        { AAPL: { sector: "Healthcare", industry: "Pharmaceuticals" } } // deliberate conflict
      );
      expect(fit.sectorExposure.find((e) => e.sector === "Technology")?.valueUsd).toBe(1500);
      expect(fit.sectorExposure.find((e) => e.sector === "Healthcare")).toBeUndefined();
      expect(fit.industryExposure.find((e) => e.industry === "Software")?.valueUsd).toBe(1500);
      expect(fit.industryExposure.find((e) => e.industry === "Pharmaceuticals")).toBeUndefined();
    });

    it("the projected breakdown uses the same candidate classification for both the existing holding and the sizeDollars addition — the same ticker never splits into two classifications", () => {
      const fit = computePortfolioFit(
        heldPortfolio(),
        {},
        candidate({ ticker: "AAPL", price: 150, sector: "Technology", industry: "Software", sizeDollars: 500 }),
        { AAPL: { sector: "Healthcare", industry: "Pharmaceuticals" } } // conflict, must still be ignored
      );
      expect(fit.projectedSectorExposure).toHaveLength(1);
      expect(fit.projectedSectorExposure?.[0]?.sector).toBe("Technology");
      expect(fit.projectedSectorExposure?.[0]?.valueUsd).toBe(2000); // 1500 existing + 500 sizeDollars, one bucket
      expect(fit.projectedIndustryExposure).toHaveLength(1);
      expect(fit.projectedIndustryExposure?.[0]?.industry).toBe("Software");
      expect(fit.projectedIndustryExposure?.[0]?.valueUsd).toBe(2000);
    });
  });

  describe("edge cases", () => {
    it("empty portfolio: no positions, zero cash — no NaN, empty exposure arrays", () => {
      const fit = computePortfolioFit(
        portfolio({ cash: 0, positions: [] }),
        {},
        candidate({ ticker: "AAPL", price: 200 }),
        noClassification
      );
      expect(fit.sectorExposure).toEqual([]);
      expect(fit.industryExposure).toEqual([]);
      expect(fit.cashValueUsd).toBe(0);
      expect(fit.cashWeightPercent).toBe(0);
      expect(Number.isFinite(fit.cashWeightPercent)).toBe(true);
    });

    it("cash-only portfolio: cashWeightPercent is 100%, exposure arrays are empty", () => {
      const fit = computePortfolioFit(
        portfolio({ cash: 1000, positions: [] }),
        {},
        candidate({ ticker: "AAPL", price: 200 }),
        noClassification
      );
      expect(fit.cashValueUsd).toBe(1000);
      expect(fit.cashWeightPercent).toBeCloseTo(100, 8);
      expect(fit.sectorExposure).toEqual([]);
      expect(fit.industryExposure).toEqual([]);
    });

    it("holdings-only portfolio (cash=0): cashWeightPercent is 0%, sector exposure still sums to 100%", () => {
      const p = portfolio({
        cash: 0,
        positions: [{ ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" }],
      });
      const fit = computePortfolioFit(
        p,
        { AAPL: 100 },
        candidate({ ticker: "MSFT", price: 200 }),
        { AAPL: { sector: "Technology", industry: "Software" } }
      );
      expect(fit.cashValueUsd).toBe(0);
      expect(fit.cashWeightPercent).toBe(0);
      expect(fit.sectorExposure.find((e) => e.sector === "Technology")?.weightPercent).toBeCloseTo(100, 8);
    });

    it("totalPortfolioValueUsd=0: no NaN/Infinity anywhere, including projected fields", () => {
      const fit = computePortfolioFit(
        portfolio({ cash: 0, positions: [] }),
        {},
        candidate({ ticker: "AAPL", price: 200, sector: "Technology", industry: "Software", sizeDollars: 0 }),
        noClassification
      );
      expect(fit.totalPortfolioValueUsd).toBe(0);
      expect(Number.isFinite(fit.cashWeightPercent)).toBe(true);
      expect(Number.isFinite(fit.existingWeightPercent)).toBe(true);
      expect(fit.projectedCashWeightPercent === null || Number.isFinite(fit.projectedCashWeightPercent)).toBe(true);
      expect(fit.projectedSectorExposure?.every((e) => Number.isFinite(e.weightPercent))).toBe(true);
      expect(fit.projectedIndustryExposure?.every((e) => Number.isFinite(e.weightPercent))).toBe(true);
    });
  });
});
