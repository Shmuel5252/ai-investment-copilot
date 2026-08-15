import type { db as Db } from "@/db/client";
import { getRecentMarketContext, insertMarketContext } from "@/db/repositories/market-context";
import { fetchMarketContext } from "./market-context-fmp";

// Simple TTL reuse (docs/architecture.md §4: "אין Background Jobs —
// caching TTL פשוט"), but over a genuinely immutable, insert-only row:
// this doesn't overwrite or expire anything, it just means multiple
// decisions made within the window share one real captured
// MarketContext instead of minting a near-duplicate row for each. Once
// inserted, a MarketContext row is never touched again.
const REUSE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const SOURCE = "financial_modeling_prep" as const;

export async function getOrCaptureMarketContext(db: typeof Db) {
  const recent = await getRecentMarketContext(db, REUSE_WINDOW_MS, SOURCE);
  if (recent) return recent;

  const data = await fetchMarketContext();
  return insertMarketContext(db, {
    indexLevel: String(data.indexLevel),
    indexChange1d: String(data.indexChange1d),
    indexChange1m: data.indexChange1m === null ? null : String(data.indexChange1m),
    sectorPerformanceJson: data.sectorPerformance,
    volatilityIndexValue: data.volatilityIndexValue === null ? null : String(data.volatilityIndexValue),
    source: data.source,
    rawDataJson: data.rawData,
  });
}
