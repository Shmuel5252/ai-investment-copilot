import { and, desc, eq, gt } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { marketDataCache } from "@/db/schema";

export type NewMarketDataCache = InferInsertModel<typeof marketDataCache>;

// Infrastructure cache, not Investment Memory (docs/data-model.md §7) —
// ordinary insert/read, no immutability rule applies here.
export async function insertMarketDataCache(db: typeof Db, values: NewMarketDataCache) {
  const [row] = await db.insert(marketDataCache).values(values).returning();
  return row!;
}

// Most recent row for this ticker+dataType that hasn't expired yet.
// "profile" is reused as the bucket for the combined MarketIntelligence
// object (profile + best-effort ratios fetched together) — see
// src/lib/market/market-intelligence.ts; "quote"/"historical_price"
// aren't accurate fits for that combined shape and Slice 1 has no
// separate use for them yet.
export async function getFreshMarketDataCache(
  db: typeof Db,
  ticker: string,
  dataType: "quote" | "profile" | "historical_price"
) {
  const [row] = await db
    .select()
    .from(marketDataCache)
    .where(
      and(
        eq(marketDataCache.ticker, ticker),
        eq(marketDataCache.dataType, dataType),
        gt(marketDataCache.expiresAt, new Date())
      )
    )
    .orderBy(desc(marketDataCache.fetchedAt))
    .limit(1);
  return row;
}
