// Financial Modeling Prep adapter — the one real market-data source for
// Slice 1 (docs/architecture.md §2.5: "מחיר/valuation בסיסי מ-API אמיתי
// אחד (FMP)"). Every field on MarketIntelligence traces back to a real
// FMP response; nothing here is invented or filled in with a plausible
// guess (docs/CLAUDE.md "נתוני השקעות — כלל מחייב").
//
// Endpoint choice, checked live against the real key in this project's
// .env before writing this file: FMP's `/stable/quote` and
// `/stable/ratios-ttm` endpoints are gated to a whitelist of symbols on
// this plan tier (a real ticker outside that whitelist returns HTTP 402
// "Premium Query Parameter", not a normal empty result) — confirmed with
// IBM/GME/SNOW/a made-up ticker, all 402 on `quote`. `/stable/profile`
// had no such restriction for any real ticker tried. So `profile` is the
// required primary source (has price, market cap, sector, industry,
// beta, 52-week range, day change%, description); `ratios-ttm` (P/E,
// price/book, price/sales, dividend yield) is fetched best-effort and
// simply omitted — with `valuationRatiosAvailable: false`, never a
// fabricated fallback — when the plan doesn't allow it for that ticker.

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set. Copy .env.example to .env first.");
  return key;
}

async function fmpGet(path: string, ticker: string): Promise<unknown> {
  const url = `${FMP_BASE_URL}/${path}?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey()}`;
  const response = await fetch(url);

  if (!response.ok) {
    // FMP returns plain-text (not JSON) bodies for some error statuses
    // (e.g. 402 "Premium Query Parameter...") — read as text first so a
    // failed .json() parse doesn't mask the real error underneath it.
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `FMP ${path} request failed for ${ticker}: HTTP ${response.status} ${bodyText.slice(0, 200)}`
    );
  }

  return response.json();
}

interface FmpProfileResponse {
  symbol: string;
  companyName: string;
  price: number;
  changePercentage: number;
  marketCap: number;
  beta: number | null;
  range: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  exchange: string | null;
  currency: string | null;
}

interface FmpRatiosTtmResponse {
  priceToEarningsRatioTTM: number | null;
  priceToBookRatioTTM: number | null;
  priceToSalesRatioTTM: number | null;
  dividendYieldTTM: number | null;
}

async function fetchProfile(ticker: string): Promise<FmpProfileResponse> {
  const data = await fmpGet("profile", ticker);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No company profile found for "${ticker}" — check the ticker is correct.`);
  }
  return data[0] as FmpProfileResponse;
}

// Best-effort only — the caller treats a thrown error here as "valuation
// ratios unavailable for this ticker on the current plan", not a hard
// failure (unlike fetchProfile, which is required).
async function fetchRatiosTtm(ticker: string): Promise<FmpRatiosTtmResponse | null> {
  try {
    const data = await fmpGet("ratios-ttm", ticker);
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as FmpRatiosTtmResponse;
  } catch {
    return null;
  }
}

export interface MarketIntelligence {
  ticker: string;
  companyName: string;
  sector: string | null;
  industry: string | null;
  price: number;
  changePercentage: number;
  marketCap: number;
  beta: number | null;
  fiftyTwoWeekRange: string | null;
  description: string | null;
  peRatioTtm: number | null;
  priceToBookRatioTtm: number | null;
  priceToSalesRatioTtm: number | null;
  dividendYieldTtm: number | null;
  valuationRatiosAvailable: boolean;
  fetchedAt: string; // ISO — this object round-trips through jsonb, where a Date becomes a string anyway
  source: "financial_modeling_prep";
}

// The only place that talks to FMP. Real data only, or a thrown error —
// never a plausible-looking fallback (docs/CLAUDE.md "נתוני השקעות").
export async function fetchMarketIntelligence(ticker: string): Promise<MarketIntelligence> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const profile = await fetchProfile(normalizedTicker);
  const ratios = await fetchRatiosTtm(normalizedTicker);

  return {
    ticker: profile.symbol,
    companyName: profile.companyName,
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    price: profile.price,
    changePercentage: profile.changePercentage,
    marketCap: profile.marketCap,
    beta: profile.beta ?? null,
    fiftyTwoWeekRange: profile.range ?? null,
    description: profile.description ?? null,
    peRatioTtm: ratios?.priceToEarningsRatioTTM ?? null,
    priceToBookRatioTtm: ratios?.priceToBookRatioTTM ?? null,
    priceToSalesRatioTtm: ratios?.priceToSalesRatioTTM ?? null,
    dividendYieldTtm: ratios?.dividendYieldTTM ?? null,
    valuationRatiosAvailable: ratios !== null,
    fetchedAt: new Date().toISOString(),
    source: "financial_modeling_prep",
  };
}
