import type { db as Db } from "@/db/client";
import { computePositionsForInvestor } from "./compute-for-investor";
import {
  computePortfolioFit,
  type PortfolioFit,
  type PortfolioFitCandidate,
  type TickerClassification,
} from "./portfolio-fit";
import { getMarketIntelligence } from "@/lib/market/market-intelligence";

// Thin DB+FMP-fetching wrapper around the pure computePortfolioFit(),
// mirroring compute-for-investor.ts's role for computePositions(). Reuses
// getMarketIntelligence() (same cache) to price every *other* currently
// held ticker — the candidate's own price is passed in by the caller,
// since it's already been fetched once for the Investment Case itself and
// there's no reason to fetch it twice. Same reasoning for sector/industry
// (docs/backlog.md, Sector/Industry Exposure) — classification comes from
// the exact same MarketIntelligence instance already fetched for price,
// no separate fetch.
export async function computePortfolioFitForInvestor(
  db: typeof Db,
  investorId: string,
  candidate: PortfolioFitCandidate
): Promise<PortfolioFit> {
  const portfolio = await computePositionsForInvestor(db, investorId);

  const otherTickers = portfolio.positions
    .map((p) => p.ticker)
    .filter((ticker) => ticker !== candidate.ticker);

  const prices: Record<string, number> = {};
  const classification: Record<string, TickerClassification> = {};
  await Promise.all(
    otherTickers.map(async (ticker) => {
      try {
        const intelligence = await getMarketIntelligence(db, ticker);
        prices[ticker] = intelligence.price;
        classification[ticker] = { sector: intelligence.sector, industry: intelligence.industry };
      } catch {
        // Left out of `prices`/`classification` on purpose —
        // computePortfolioFit() falls back to cost basis (price) and an
        // Unclassified bucket (sector/industry) and records a warning;
        // a market-data hiccup for one held ticker shouldn't block
        // Portfolio Fit entirely.
      }
    })
  );

  return computePortfolioFit(portfolio, prices, candidate, classification);
}
