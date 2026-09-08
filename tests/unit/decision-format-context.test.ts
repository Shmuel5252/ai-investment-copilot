import { describe, expect, it } from "vitest";
import { formatContext } from "@/lib/ai/decision";
import type { DecisionContextInput } from "@/lib/ai/decision";

// Regression coverage formatContext itself was missing (docs/backlog.md):
// tests/unit/format-price-size.test.ts never imports or calls
// formatContext at all — it only checks formatSizeDollarsLine in
// isolation, with the same arguments formatContext is supposed to pass
// it. A future change inside formatContext itself (e.g. flipping
// "above"/"below", reordering sections) would not have been caught by
// that test, despite a comment on formatContext claiming it was.
//
// formatContext is a pure function (no Anthropic call, no DB) — this
// calls the real, exported function with a fully-populated, realistic
// fixture (every optional field filled in, not left undefined/null, so
// every conditional branch renders its "populated" text rather than its
// fallback) and asserts on the complete output string with toBe(), not
// toContain() — so a reordered section or a flipped above/below would
// fail this test, not just a missing substring.
const fixture: DecisionContextInput = {
  ticker: "ACME",
  decisionType: "BUY",
  sizeDollars: 2500,
  reasoningText: "Strong moat and accelerating growth, buying a starter position.",
  risksConsideredText: "Regulatory risk in its core market.",
  exitConditionsText: "Would exit if margins compress two quarters in a row.",
  marketIntelligence: {
    ticker: "ACME",
    companyName: "Acme Corp",
    sector: "Technology",
    industry: "Software",
    price: 187.5,
    changePercentage: 2.35,
    marketCap: 500_000_000_000,
    beta: 1.1,
    fiftyTwoWeekRange: "150.00-210.00",
    description: "Enterprise software company.",
    peRatioTtm: 32.4,
    priceToBookRatioTtm: 8.1,
    priceToSalesRatioTtm: 11.2,
    dividendYieldTtm: 0.005,
    valuationRatiosAvailable: true,
    fetchedAt: "2026-09-08T00:00:00.000Z",
    source: "financial_modeling_prep",
  },
  marketContext: {
    indexLevel: 5900.25,
    indexChange1d: -0.42,
    indexChange1m: 3.15,
    volatilityIndexValue: 14.8,
  },
  portfolioFit: {
    totalPortfolioValueUsd: 42350.75,
    totalPortfolioValueApproximate: true,
    existingHoldingQuantity: 0,
    existingPositionValueUsd: 0,
    existingWeightPercent: 0,
    projectedPositionValueUsd: 2500,
    projectedWeightPercent: 5.9,
    holdingsCount: 4,
    largestCurrentPositionTicker: "MSFT",
    largestCurrentPositionWeightPercent: 22.3,
    warnings: ["Adding ACME would push tech-sector exposure above 40%."],
  },
  dnaHypotheses: [
    { statementText: "Tends to buy after a pullback rather than at highs.", evidenceStrength: "moderate" },
  ],
  strategyPrinciples: [
    {
      statementText: "Avoid initiating positions above 5% of portfolio without strong conviction.",
      principleType: "declared",
      evidenceStrength: "strong",
    },
  ],
};

const EXPECTED = `Decision: BUY ACME
Investment size: $2500.00 (the dollar amount being invested — NOT a price; unrelated to the per-share Price below)

Investor's own reasoning (verbatim): "Strong moat and accelerating growth, buying a starter position."
Risks the investor noted: "Regulatory risk in its core market."
Exit conditions the investor noted: "Would exit if margins compress two quarters in a row."

=== Market data for ACME ===
Price: $187.5 per share (+2.35% today)
Sector: Technology / Industry: Software
P/E 32.4, P/B 8.1, P/S 11.2

=== Broad market context ===
S&P 500: 5900.25 (-0.42% today, +3.15% over ~1 month)
VIX (volatility): 14.8

=== Portfolio fit ===
Total portfolio value: $42350.75 (approximate)
Existing exposure to ACME: 0.0% of portfolio
Projected exposure after this decision: 5.9%
Current largest position: MSFT at 22.3%
Warning: Adding ACME would push tech-sector exposure above 40%.

=== This investor's DNA hypotheses ===
- (moderate) Tends to buy after a pullback rather than at highs.

=== This investor's current Strategy principles ===
- (declared, strong) Avoid initiating positions above 5% of portfolio without strong conviction.`;

describe("formatContext", () => {
  it("renders the complete expected prompt text for a fully-populated input, byte for byte", () => {
    expect(formatContext(fixture)).toBe(EXPECTED);
  });

  it("includes the size/price disambiguation line intact within the full output", () => {
    expect(formatContext(fixture)).toContain(
      "Investment size: $2500.00 (the dollar amount being invested — NOT a price; unrelated to the per-share Price below)"
    );
  });

  it("falls back to 'not specified' when sizeDollars is absent, instead of a size line", () => {
    const noSize: DecisionContextInput = { ...fixture, sizeDollars: undefined };
    const output = formatContext(noSize);
    expect(output).toContain("Investment size: not specified for this decision type.");
    expect(output).not.toContain("NOT a price");
  });

  it("omits the projected-exposure and largest-position lines entirely when their values are null, rather than rendering an empty line", () => {
    const noProjection: DecisionContextInput = {
      ...fixture,
      portfolioFit: {
        ...fixture.portfolioFit,
        projectedWeightPercent: null,
        largestCurrentPositionTicker: null,
        largestCurrentPositionWeightPercent: null,
        warnings: [],
      },
    };
    const output = formatContext(noProjection);
    expect(output).not.toContain("Projected exposure");
    expect(output).not.toContain("Current largest position");
    expect(output).not.toContain("Warning:");
    // No blank line left behind where the filtered-out lines were.
    expect(output).not.toContain("\n\n\n");
  });

  it("renders 'none yet' for DNA hypotheses and Strategy principles when both arrays are empty", () => {
    const noHistory: DecisionContextInput = { ...fixture, dnaHypotheses: [], strategyPrinciples: [] };
    const output = formatContext(noHistory);
    expect(output).toContain("=== This investor's DNA hypotheses === none yet.");
    expect(output).toContain("=== This investor's current Strategy principles === none yet.");
  });
});
