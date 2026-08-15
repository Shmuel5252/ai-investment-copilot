// Market-wide snapshot for MarketContext (docs/data-model.md §7) — a
// different real FMP source than fmp.ts (which is ticker-scoped): the
// broad index level, its 1d/1m change, sector performance across the
// market, and a volatility index. Captured once per Decision Snapshot
// (via market-context.ts's TTL wrapper), not per ticker.
//
// Endpoint choice, checked live against the real key in .env before
// writing this file: unlike the ticker-scoped `/stable/quote` (gated to
// a symbol whitelist on this plan — see fmp.ts), index symbols (^GSPC,
// ^VIX) work fine on that same `/stable/quote` endpoint — the premium
// gating is apparently specific to individual-stock quotes, not
// indices. `/stable/historical-price-eod/light` also works for an index
// symbol, used here to compute a real ~1-month change (oldest vs newest
// close in a ~40-calendar-day window) instead of inventing one — FMP's
// index quote itself has no ready-made "1 month change" field.
// `/stable/sector-performance-snapshot?date=YYYY-MM-DD` lags by at least
// one trading day (today's date and weekend dates come back as an empty
// array, not an error) — this walks backward a few calendar days to
// find the most recent date that actually has data, the same
// "don't fabricate, surface what's real" approach as fmp.ts's
// best-effort ratios-ttm.

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const BENCHMARK_INDEX_SYMBOL = "^GSPC"; // S&P 500
const VOLATILITY_INDEX_SYMBOL = "^VIX";

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set. Copy .env.example to .env first.");
  return key;
}

async function fmpGet(path: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ ...params, apikey: apiKey() });
  const url = `${FMP_BASE_URL}${path}?${query.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`FMP ${path} request failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
  }

  return response.json();
}

interface FmpQuoteResponse {
  symbol: string;
  price: number;
  changePercentage: number;
}

interface FmpHistoricalPricePoint {
  symbol: string;
  date: string;
  price: number;
}

export interface SectorPerformanceEntry {
  date: string;
  sector: string;
  exchange: string;
  averageChange: number;
}

export interface MarketContextData {
  indexLevel: number;
  indexChange1d: number;
  /** null only if FMP didn't have enough history in the lookback window to compute this. */
  indexChange1m: number | null;
  /** null only if the ^VIX quote wasn't available. */
  volatilityIndexValue: number | null;
  sectorPerformance: SectorPerformanceEntry[];
  source: "financial_modeling_prep";
  rawData: Record<string, unknown>;
}

// Pure, so it's cheap to unit test on its own (tests/unit/percent-change.test.ts)
// rather than only indirectly through a network call — the same
// "extract the deterministic core, unit test that, keep the fetch
// wrapper thin" split used throughout this codebase (e.g.
// computePositions() vs computePositionsForInvestor()).
export function computePercentChange(oldest: number, newest: number): number | null {
  if (oldest === 0) return null;
  return ((newest - oldest) / oldest) * 100;
}

async function fetchIndexQuote(symbol: string): Promise<FmpQuoteResponse | null> {
  const data = await fmpGet("/quote", { symbol });
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as FmpQuoteResponse;
}

async function fetchIndexChange1m(symbol: string): Promise<number | null> {
  const to = new Date();
  const from = new Date(to.getTime() - 40 * 86_400_000); // ~40 calendar days comfortably covers ~1 trading month
  const data = await fmpGet("/historical-price-eod/light", {
    symbol,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  if (!Array.isArray(data) || data.length < 2) return null;

  const points = data as FmpHistoricalPricePoint[]; // observed order: most-recent-first
  const newest = points[0]!.price;
  const oldest = points[points.length - 1]!.price;
  return computePercentChange(oldest, newest);
}

async function fetchLatestSectorPerformance(): Promise<{
  date: string;
  entries: SectorPerformanceEntry[];
} | null> {
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const data = await fmpGet("/sector-performance-snapshot", { date });
    if (Array.isArray(data) && data.length > 0) {
      return { date, entries: data as SectorPerformanceEntry[] };
    }
  }
  return null; // genuinely no recent data — reflected honestly as an empty sectorPerformance[], never guessed.
}

// Real data only, or a thrown error — never a plausible-looking fallback
// (docs/CLAUDE.md "נתוני השקעות"). Only the required benchmark index
// quote is a hard failure; 1-month change, sector performance, and VIX
// are each best-effort and simply come back null/empty when unavailable.
export async function fetchMarketContext(): Promise<MarketContextData> {
  const [indexQuote, indexChange1m, sectorPerformance, volatilityQuote] = await Promise.all([
    fetchIndexQuote(BENCHMARK_INDEX_SYMBOL),
    fetchIndexChange1m(BENCHMARK_INDEX_SYMBOL).catch(() => null),
    fetchLatestSectorPerformance().catch(() => null),
    fetchIndexQuote(VOLATILITY_INDEX_SYMBOL).catch(() => null),
  ]);

  if (!indexQuote) {
    throw new Error(`FMP returned no quote for the benchmark index (${BENCHMARK_INDEX_SYMBOL}).`);
  }

  return {
    indexLevel: indexQuote.price,
    indexChange1d: indexQuote.changePercentage,
    indexChange1m,
    volatilityIndexValue: volatilityQuote?.price ?? null,
    sectorPerformance: sectorPerformance?.entries ?? [],
    source: "financial_modeling_prep",
    rawData: {
      indexQuote,
      indexChange1mWindowDays: 40,
      sectorPerformanceDate: sectorPerformance?.date ?? null,
      volatilityQuote,
    },
  };
}
