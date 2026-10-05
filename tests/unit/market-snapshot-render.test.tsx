// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketRegion } from "@/components/case/research-regions";
import type { MarketIntelligence } from "@/lib/market/fmp";

// Synthetic values only; the point is what the region shows, not the data.
const M: MarketIntelligence = {
  ticker: "ABCD", companyName: "Example Holdings Inc.", sector: "Technology", industry: "Semiconductors",
  price: 182.4, changePercentage: -0.85, marketCap: 4_901_023_823_640, beta: 1.32, fiftyTwoWeekRange: "121.10-205.75", description: null,
  peRatioTtm: 28.4, priceToBookRatioTtm: 6.1, priceToSalesRatioTtm: 7.9, dividendYieldTtm: 0.0031766,
  valuationRatiosAvailable: true, fetchedAt: "2026-09-29T11:42:00.000Z", source: "financial_modeling_prep",
};
const fetch = { run: () => {}, pending: false, error: null };

describe("MarketRegion snapshot display", () => {
  it("shows Div yield as a percent and market cap compactly with the full value on hover", () => {
    const { container } = render(<MarketRegion intelligence={M} fetch={fetch} readOnly />);
    const text = container.textContent!;
    expect(text).toContain("Div yield 0.32%");
    expect(text).not.toContain("0.0031766");
    expect(text).toContain("$4.90T");
    expect(text).not.toContain("4,901,023,823,640");
    expect(container.querySelector('[title="$4,901,023,823,640"]')).not.toBeNull();
  });

  it("still says n/a for a missing yield", () => {
    const { container } = render(<MarketRegion intelligence={{ ...M, dividendYieldTtm: null }} fetch={fetch} readOnly />);
    expect(container.textContent).not.toMatch(/Div yield \d/);
  });
});
