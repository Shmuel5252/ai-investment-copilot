import { describe, expect, it } from "vitest";
import { formatCashLine, formatSectorExposureLine, formatIndustryExposureLine } from "@/lib/ai/format-portfolio-fit";
import { computePortfolioFit, type PortfolioFitCandidate, type TickerClassification } from "@/lib/portfolio/portfolio-fit";
import type { PortfolioState } from "@/lib/portfolio/positions";

// Same direct-pure-formatter pattern as format-price-size.test.ts —
// format-portfolio-fit.ts has no Anthropic/DB dependency, so it's tested
// directly, not through case.ts/decision.ts (which have no existing
// mocking infrastructure — docs/backlog.md explicitly left those
// untested rather than build one just for this).

function portfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    asOfDate: new Date("2026-01-01"),
    cash: 1000,
    positions: [],
    warnings: [],
    sellTrace: [],
    episodeKeyByTransactionId: new Map(),
    ...overrides,
  };
}

function candidate(overrides: Partial<PortfolioFitCandidate> & { ticker: string; price: number }): PortfolioFitCandidate {
  return { sector: null, industry: null, ...overrides };
}

const noClassification: Readonly<Record<string, TickerClassification>> = {};

describe("formatCashLine / formatSectorExposureLine / formatIndustryExposureLine", () => {
  it("renders 'none' for an empty exposure list, not an empty/garbled string", () => {
    expect(formatSectorExposureLine("Current", [])).toBe("Current sector exposure: none");
    expect(formatIndustryExposureLine("Current", [])).toBe("Current industry exposure: none");
  });

  it("renders a null classification entry as 'Unclassified', with its weight", () => {
    expect(formatSectorExposureLine("Current", [{ sector: null, valueUsd: 1000, weightPercent: 7.1 }])).toBe(
      "Current sector exposure: Unclassified 7.1%"
    );
  });

  it("formats cash with prefix, dollar amount, and percent", () => {
    expect(formatCashLine("Projected", 500, 10)).toBe("Projected cash: $500.00 (10.0% of portfolio)");
  });
});

describe("AI-facing formatting of the sizeDollars=0 phantom-bucket fix (external review, blocker)", () => {
  // The originally-reported symptom wasn't just a raw-data array — it was
  // this formatted line flipping from "none" to "Unclassified 0.0%" in
  // the actual text handed to the model. This proves the fix holds at
  // the formatting layer too, using the real exported formatter against
  // a real computePortfolioFit() result — not just an isolated array.
  it("a new, unheld, unclassified candidate with sizeDollars=0 renders the SAME projected sector/industry line as current — no phantom 'Unclassified 0.0%'", () => {
    const p = portfolio({ cash: 1000, positions: [] });
    const zeroCandidate = candidate({ ticker: "NEW", price: 100, sizeDollars: 0 });
    const fit = computePortfolioFit(p, {}, zeroCandidate, noClassification);

    const currentSectorLine = formatSectorExposureLine("Current", fit.sectorExposure);
    const currentIndustryLine = formatIndustryExposureLine("Current", fit.industryExposure);
    expect(currentSectorLine).toBe("Current sector exposure: none");
    expect(currentIndustryLine).toBe("Current industry exposure: none");

    expect(fit.projectedSectorExposure).not.toBeNull();
    expect(fit.projectedIndustryExposure).not.toBeNull();
    const projectedSectorLine = formatSectorExposureLine("Projected", fit.projectedSectorExposure!);
    const projectedIndustryLine = formatIndustryExposureLine("Projected", fit.projectedIndustryExposure!);

    expect(projectedSectorLine).not.toContain("Unclassified 0.0%");
    expect(projectedIndustryLine).not.toContain("Unclassified 0.0%");
    expect(projectedSectorLine).toBe("Projected sector exposure: none");
    expect(projectedIndustryLine).toBe("Projected industry exposure: none");
  });

  it("a new, unheld, CLASSIFIED candidate with sizeDollars=0 does not render a phantom zero-weight line for its own sector/industry", () => {
    const p = portfolio({ cash: 1000, positions: [] });
    const zeroCandidate = candidate({
      ticker: "NEW",
      price: 100,
      sector: "Technology",
      industry: "Semiconductors",
      sizeDollars: 0,
    });
    const fit = computePortfolioFit(p, {}, zeroCandidate, noClassification);

    expect(fit.projectedSectorExposure).not.toBeNull();
    expect(fit.projectedIndustryExposure).not.toBeNull();
    const projectedSectorLine = formatSectorExposureLine("Projected", fit.projectedSectorExposure!);
    const projectedIndustryLine = formatIndustryExposureLine("Projected", fit.projectedIndustryExposure!);

    expect(projectedSectorLine).not.toContain("Technology 0.0%");
    expect(projectedIndustryLine).not.toContain("Semiconductors 0.0%");
    expect(projectedSectorLine).toBe("Projected sector exposure: none");
    expect(projectedIndustryLine).toBe("Projected industry exposure: none");
  });
});
