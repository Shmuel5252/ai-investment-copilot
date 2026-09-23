import { describe, expect, it } from "vitest";
import {
  selectInterestingTransactions,
  type TransactionForSelection,
} from "@/lib/interview/select-transactions";

let idCounter = 0;
function txn(
  overrides: Partial<TransactionForSelection> & Pick<TransactionForSelection, "transactionType">
): TransactionForSelection {
  idCounter += 1;
  return {
    id: `t${idCounter}`,
    ticker: "AAPL",
    quantity: null,
    price: null,
    amount: 0,
    transactionDate: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("selectInterestingTransactions", () => {
  it("returns nothing for an empty transaction list", () => {
    expect(selectInterestingTransactions([])).toEqual([]);
  });

  it("identifies the biggest realized gain and loss among sells", () => {
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "WIN", quantity: 10, price: 100, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "WIN", quantity: 10, price: 200, transactionDate: new Date("2025-02-01") }), // +100%
      txn({ transactionType: "buy", ticker: "LOSE", quantity: 10, price: 100, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "LOSE", quantity: 10, price: 50, transactionDate: new Date("2025-02-01") }), // -50%
    ];
    const result = selectInterestingTransactions(rows);
    const gain = result.find((r) => r.category === "biggest_gain");
    const loss = result.find((r) => r.category === "biggest_loss");
    expect(gain?.transaction.ticker).toBe("WIN");
    expect(gain?.realizedPnlPercent).toBeCloseTo(100);
    expect(loss?.transaction.ticker).toBe("LOSE");
    expect(loss?.realizedPnlPercent).toBeCloseTo(-50);
  });

  it("identifies longest hold and quickest flip independently of the gain/loss extremes", () => {
    const rows: TransactionForSelection[] = [
      // Mild, similar P/L on both so neither is the gain/loss extreme —
      // isolates the holding-period logic from the P/L logic.
      txn({ transactionType: "buy", ticker: "SLOW", quantity: 1, price: 10, transactionDate: new Date("2024-01-01") }),
      txn({ transactionType: "sell", ticker: "SLOW", quantity: 1, price: 10.5, transactionDate: new Date("2025-01-01") }), // 366 days (2024 is a leap year), +5%
      txn({ transactionType: "buy", ticker: "FAST", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "FAST", quantity: 1, price: 10.5, transactionDate: new Date("2025-01-03") }), // 2 days, +5%
      // Extreme gain/loss, both mid-length holds, so they win gain/loss
      // without also winning hold/flip.
      txn({ transactionType: "buy", ticker: "BIGGAIN", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "BIGGAIN", quantity: 1, price: 30, transactionDate: new Date("2025-01-11") }), // 10 days, +200%
      txn({ transactionType: "buy", ticker: "BIGLOSS", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "BIGLOSS", quantity: 1, price: 2, transactionDate: new Date("2025-01-11") }), // 10 days, -80%
    ];
    const result = selectInterestingTransactions(rows, [], 10);
    const longest = result.find((r) => r.category === "longest_hold");
    const quickest = result.find((r) => r.category === "quickest_flip");
    const gain = result.find((r) => r.category === "biggest_gain");
    const loss = result.find((r) => r.category === "biggest_loss");
    expect(longest?.transaction.ticker).toBe("SLOW");
    expect(longest?.holdingPeriodDays).toBe(366);
    expect(quickest?.transaction.ticker).toBe("FAST");
    expect(quickest?.holdingPeriodDays).toBe(2);
    expect(gain?.transaction.ticker).toBe("BIGGAIN");
    expect(loss?.transaction.ticker).toBe("BIGLOSS");
  });

  it("falls back to the next-most-extreme sell when the top pick is already claimed", () => {
    // Only 2 sells exist, so biggest_gain and biggest_loss necessarily
    // claim both of them; longest_hold/quickest_flip must fall back
    // rather than disappearing entirely.
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "SLOW", quantity: 1, price: 10, transactionDate: new Date("2024-01-01") }),
      txn({ transactionType: "sell", ticker: "SLOW", quantity: 1, price: 12, transactionDate: new Date("2025-01-01") }), // 366 days, +20%
      txn({ transactionType: "buy", ticker: "FAST", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "FAST", quantity: 1, price: 9, transactionDate: new Date("2025-01-03") }), // 2 days, -10%
    ];
    const result = selectInterestingTransactions(rows, [], 10);
    const categories = result.map((r) => r.category);
    // Both transactions still appear (via gain/loss), and no duplicate
    // transaction id is present.
    const ids = result.map((r) => r.transaction.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(categories).toContain("biggest_gain");
    expect(categories).toContain("biggest_loss");
  });

  it("identifies the largest buy by dollar amount", () => {
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "SMALL", quantity: 1, price: 10 }),
      txn({ transactionType: "buy", ticker: "BIG", quantity: 100, price: 50 }),
    ];
    const result = selectInterestingTransactions(rows);
    const largestBuy = result.find((r) => r.category === "largest_buy");
    expect(largestBuy?.transaction.ticker).toBe("BIG");
  });

  it("identifies the chronologically first trade (distinct from the largest buy)", () => {
    const rows: TransactionForSelection[] = [
      // Larger amount so it wins "largest_buy" instead, leaving the
      // smaller-but-earlier trade free to be labeled "first_trade".
      txn({ transactionType: "buy", ticker: "SECOND", quantity: 100, price: 50, transactionDate: new Date("2025-02-01") }),
      txn({ transactionType: "buy", ticker: "FIRST", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
    ];
    const result = selectInterestingTransactions(rows);
    const first = result.find((r) => r.category === "first_trade");
    const largestBuy = result.find((r) => r.category === "largest_buy");
    expect(first?.transaction.ticker).toBe("FIRST");
    expect(largestBuy?.transaction.ticker).toBe("SECOND");
  });

  it("omits the first_trade label (without mislabeling another trade) when the actual first trade is already claimed by another category", () => {
    // Single buy: it's simultaneously the largest buy AND the first
    // trade. largest_buy claims it; first_trade must not then mislabel
    // a later trade as "first".
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "ONLY", quantity: 1, price: 10, transactionDate: new Date("2025-01-01") }),
    ];
    const result = selectInterestingTransactions(rows);
    expect(result.find((r) => r.category === "largest_buy")?.transaction.ticker).toBe("ONLY");
    expect(result.find((r) => r.category === "first_trade")).toBeUndefined();
  });

  it("never selects the same transaction twice even if it wins multiple categories", () => {
    // A single buy+sell pair where the buy is also the largest buy and
    // also the first trade, and the sell is also biggest gain/loss/hold/flip
    // (only one of each side exists).
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "ONLY", quantity: 10, price: 100, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "ONLY", quantity: 10, price: 120, transactionDate: new Date("2025-02-01") }),
    ];
    const result = selectInterestingTransactions(rows);
    const ids = result.map((r) => r.transaction.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("ignores non-buy/sell transactions (deposit, withdrawal, dividend, fee)", () => {
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "deposit", ticker: null, amount: 5000 }),
      txn({ transactionType: "dividend", ticker: "AAPL", amount: 10 }),
      txn({ transactionType: "fee", ticker: null, amount: -1 }),
    ];
    expect(selectInterestingTransactions(rows)).toEqual([]);
  });

  it("skips a sell with no prior known holding rather than fabricating context", () => {
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "sell", ticker: "GHOST", quantity: 5, price: 100, transactionDate: new Date("2025-01-01") }),
    ];
    const result = selectInterestingTransactions(rows);
    expect(result.some((r) => r.transaction.ticker === "GHOST" && r.category !== "first_trade")).toBe(false);
  });

  it("caps the result at maxCount", () => {
    const rows: TransactionForSelection[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(
        txn({
          transactionType: "buy",
          ticker: `T${i}`,
          quantity: 1,
          price: 10 + i,
          transactionDate: new Date(2025, 0, i + 1),
        })
      );
    }
    const result = selectInterestingTransactions(rows, [], 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("seeds cost basis from PortfolioOpeningState, not just the imported transaction window", () => {
    // Regression test for a real bug caught via a live AI call: without
    // opening-state seeding, a sell of a position opened before the
    // import window computed P/L from an incomplete cost basis and could
    // even get labeled "biggest_loss" while actually showing a gain.
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "MSFT", quantity: 5, price: 380, transactionDate: new Date("2025-02-10") }),
      txn({ transactionType: "sell", ticker: "MSFT", quantity: 20, price: 400, transactionDate: new Date("2025-05-01") }),
    ];
    const openingStates = [
      { ticker: "MSFT", quantity: 20, costBasisPerShare: 300, costBasisConfidence: "approximate" as const, asOfDate: new Date("2024-12-01") },
    ];
    // avg cost = (20*300 + 5*380) / 25 = 316; sell at 400 -> +26.6%
    const result = selectInterestingTransactions(rows, openingStates, 10);
    const sell = result.find((r) => r.transaction.transactionType === "sell");
    expect(sell?.realizedPnlPercent).toBeCloseTo(((400 - 316) / 316) * 100, 1);
    expect(sell?.category).toBe("biggest_gain"); // it's a gain, not a loss
  });

  it("never labels a net-positive sell as biggest_loss, or a net-negative sell as biggest_gain", () => {
    // Two sells, both gains (one smaller than the other) — the smaller
    // gain must NOT be mislabeled "biggest_loss" just for being the
    // relatively worse of the two.
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "BIG", quantity: 1, price: 100, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "BIG", quantity: 1, price: 200, transactionDate: new Date("2025-02-01") }), // +100%
      txn({ transactionType: "buy", ticker: "SMALL", quantity: 1, price: 100, transactionDate: new Date("2025-01-01") }),
      txn({ transactionType: "sell", ticker: "SMALL", quantity: 1, price: 105, transactionDate: new Date("2025-02-01") }), // +5%
    ];
    const result = selectInterestingTransactions(rows, [], 10);
    expect(result.find((r) => r.category === "biggest_loss")).toBeUndefined();
    expect(result.find((r) => r.transaction.ticker === "SMALL")?.category).not.toBe("biggest_loss");
  });

  it("skips a sell that exceeds even the opening-state-seeded holdings", () => {
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "sell", ticker: "MSFT", quantity: 50, price: 400, transactionDate: new Date("2025-05-01") }),
    ];
    const openingStates = [
      { ticker: "MSFT", quantity: 20, costBasisPerShare: 300, costBasisConfidence: "approximate" as const, asOfDate: new Date("2024-12-01") },
    ];
    const result = selectInterestingTransactions(rows, openingStates, 10);
    expect(result.some((r) => r.transaction.ticker === "MSFT" && r.realizedPnlPercent !== undefined)).toBe(false);
  });

  it("applies recorded stock splits (Import Blockers V1): a post-split sale is judged against the split-adjusted cost", () => {
    // 1 @ 100, then a 4:1 split, then 1 of the 4 post-split shares sold @ 30:
    // adjusted cost 25 → +20%, a gain. Without the split the very same sale
    // reads as (30 − 100) / 100 = −70% and is labeled \"biggest_loss\" — the
    // phantom-loss mislabel this module's header warns about.
    const rows: TransactionForSelection[] = [
      txn({ transactionType: "buy", ticker: "SPL", quantity: 1, price: 100, transactionDate: new Date("2026-01-01") }),
      txn({ transactionType: "sell", ticker: "SPL", quantity: 1, price: 30, transactionDate: new Date("2026-03-01") }),
    ];
    const split = { ticker: "SPL", effectiveDate: new Date("2026-02-01"), ratioNumerator: 4, ratioDenominator: 1 };
    const withSplit = selectInterestingTransactions(rows, [], 10, [split]).find((r) => r.transaction.transactionType === "sell");
    expect(withSplit?.category).toBe("biggest_gain");
    expect(withSplit?.realizedPnlPercent).toBeCloseTo(20, 6);
    const without = selectInterestingTransactions(rows, [], 10).find((r) => r.transaction.transactionType === "sell");
    expect(without?.category).toBe("biggest_loss");
    expect(without?.realizedPnlPercent).toBeCloseTo(-70, 6);
  });
});
