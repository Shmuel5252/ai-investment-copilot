import type { db as Db } from "@/db/client";
import { getFreshMarketDataCache, insertMarketDataCache } from "@/db/repositories/market";
import { fetchMarketIntelligence, type MarketIntelligence } from "./fmp";

// Simple synchronous fetch + TTL cache (docs/architecture.md §4:
// "Background Jobs — אין ב-Slice 1; fetch synchronous + caching TTL
// פשוט") — no queue, no background refresh, just don't re-hit FMP for
// the same ticker more often than this.
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// The one place callers go for a ticker's market data — used both for
// an Investment Case's own ticker and, via computePortfolioFitForInvestor,
// for pricing the investor's other held positions, so both paths share
// the same cache instead of double-fetching the same ticker.
export async function getMarketIntelligence(
  db: typeof Db,
  ticker: string,
  opts?: { forceRefresh?: boolean }
): Promise<MarketIntelligence> {
  const normalizedTicker = ticker.trim().toUpperCase();

  if (!opts?.forceRefresh) {
    const cached = await getFreshMarketDataCache(db, normalizedTicker, "profile");
    if (cached) return cached.payloadJson as MarketIntelligence;
  }

  const intelligence = await fetchMarketIntelligence(normalizedTicker);
  const fetchedAt = new Date(intelligence.fetchedAt);
  await insertMarketDataCache(db, {
    ticker: normalizedTicker,
    dataType: "profile",
    payloadJson: intelligence,
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + CACHE_TTL_MS),
  });

  return intelligence;
}
