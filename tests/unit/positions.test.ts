import { describe, expect, it } from "vitest";
import {
  computePositions,
  type TransactionInput,
  type OpeningStateInput,
} from "@/lib/portfolio/positions";

function buy(
  ticker: string,
  quantity: number,
  price: number,
  date: string,
  id?: string
): TransactionInput {
  return {
    id,
    ticker,
    transactionType: "buy",
    quantity,
    price,
    amount: -(quantity * price),
    transactionDate: new Date(date),
  };
}

function sell(
  ticker: string,
  quantity: number,
  price: number,
  date: string,
  id?: string
): TransactionInput {
  return {
    id,
    ticker,
    transactionType: "sell",
    quantity,
    price,
    amount: quantity * price,
    transactionDate: new Date(date),
  };
}

function cashMovement(
  type: "deposit" | "withdrawal" | "fee" | "dividend",
  amount: number,
  date: string,
  ticker: string | null = null
): TransactionInput {
  return { ticker, transactionType: type, quantity: null, price: null, amount, transactionDate: new Date(date) };
}

describe("computePositions", () => {
  it("computes a single buy correctly", () => {
    const result = computePositions([buy("AAPL", 10, 100, "2025-01-01")], []);
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
    ]);
    expect(result.cash).toBe(-1000);
    expect(result.warnings).toEqual([]);
  });

  it("averages cost basis across multiple buys", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), buy("AAPL", 10, 200, "2025-02-01")],
      []
    );
    // 10@100 + 10@200 = 20 shares, total cost 3000 -> avg 150
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 20, costBasisPerShare: 150, costBasisConfidence: "known" },
    ]);
  });

  it("leaves cost basis per share unchanged on a partial sell", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), sell("AAPL", 4, 500, "2025-03-01")],
      []
    );
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 6, costBasisPerShare: 100, costBasisConfidence: "known" },
    ]);
  });

  it("removes a position entirely once fully sold", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), sell("AAPL", 10, 500, "2025-03-01")],
      []
    );
    expect(result.positions).toEqual([]);
  });

  it("blends an opening state with subsequent transactions", () => {
    const opening: OpeningStateInput[] = [
      {
        ticker: "MSFT",
        quantity: 5,
        costBasisPerShare: 200,
        costBasisConfidence: "approximate",
        asOfDate: new Date("2025-01-01"),
      },
    ];
    const result = computePositions([buy("MSFT", 5, 400, "2025-02-01")], opening);
    // 5@200 (opening) + 5@400 (buy) = 10 shares, total cost 3000 -> avg 300
    expect(result.positions).toEqual([
      { ticker: "MSFT", quantity: 10, costBasisPerShare: 300, costBasisConfidence: "approximate" },
    ]);
  });

  it("flags a SELL that exceeds known holdings instead of going negative", () => {
    const result = computePositions([sell("TSLA", 10, 300, "2025-01-01")], []);
    expect(result.positions).toEqual([]);
    expect(result.warnings).toEqual([
      {
        ticker: "TSLA",
        message: expect.stringContaining("PortfolioOpeningState may be missing"),
      },
    ]);
  });

  it("flags a SELL that exceeds a partial known holding", () => {
    const result = computePositions(
      [buy("TSLA", 3, 300, "2025-01-01"), sell("TSLA", 10, 350, "2025-02-01")],
      []
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.ticker).toBe("TSLA");
  });

  it("respects the asOfDate cutoff, excluding later transactions", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), buy("AAPL", 10, 200, "2025-06-01")],
      [],
      new Date("2025-03-01")
    );
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
    ]);
  });

  it("applies dividend/deposit/withdrawal/fee to cash only, never positions", () => {
    const result = computePositions(
      [
        buy("AAPL", 10, 100, "2025-01-01"),
        cashMovement("deposit", 5000, "2024-12-01"),
        cashMovement("dividend", 12.5, "2025-02-01", "AAPL"),
        cashMovement("fee", -1.5, "2025-02-02"),
        cashMovement("withdrawal", -200, "2025-03-01"),
      ],
      []
    );
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 10, costBasisPerShare: 100, costBasisConfidence: "known" },
    ]);
    // deposit 5000 - buy 1000 + dividend 12.5 - fee 1.5 - withdrawal 200
    expect(result.cash).toBeCloseTo(5000 - 1000 + 12.5 - 1.5 - 200);
  });

  it("tracks multiple tickers independently", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), buy("MSFT", 5, 400, "2025-01-02")],
      []
    );
    expect(result.positions).toHaveLength(2);
    expect(result.positions.map((p) => p.ticker)).toEqual(["AAPL", "MSFT"]); // sorted
  });

  it("returns no warnings for a clean, fully-explained history", () => {
    const result = computePositions(
      [buy("AAPL", 10, 100, "2025-01-01"), sell("AAPL", 5, 200, "2025-02-01")],
      []
    );
    expect(result.warnings).toEqual([]);
  });

  it("processes out-of-order input transactions in date order", () => {
    // Sell listed before buy in the input array, but dated after it.
    const result = computePositions(
      [sell("AAPL", 4, 200, "2025-03-01"), buy("AAPL", 10, 100, "2025-01-01")],
      []
    );
    expect(result.warnings).toEqual([]);
    expect(result.positions).toEqual([
      { ticker: "AAPL", quantity: 6, costBasisPerShare: 100, costBasisConfidence: "known" },
    ]);
  });

  describe("sellTrace", () => {
    it("records realized P&L, holding period, and the linked transaction id for each sell", () => {
      const result = computePositions(
        [
          buy("AAPL", 10, 100, "2025-01-01", "buy-1"),
          sell("AAPL", 4, 150, "2025-04-01", "sell-1"), // +50%, 90 days
        ],
        []
      );
      expect(result.sellTrace).toEqual([
        {
          transactionId: "sell-1",
          ticker: "AAPL",
          transactionDate: new Date("2025-04-01"),
          realizedPnlPercent: 50,
          holdingPeriodDays: 90,
          sufficientHoldings: true,
        },
      ]);
    });

    it("seeds holding period from PortfolioOpeningState's asOfDate, not the first transaction", () => {
      const result = computePositions(
        [buy("MSFT", 5, 380, "2025-02-10", "buy-1"), sell("MSFT", 20, 400, "2025-05-01", "sell-1")],
        [
          {
            ticker: "MSFT",
            quantity: 20,
            costBasisPerShare: 300,
            costBasisConfidence: "approximate",
            asOfDate: new Date("2024-12-01"),
          },
        ]
      );
      // avg cost = (20*300 + 5*380)/25 = 316; sell at 400 -> +26.6%
      expect(result.sellTrace).toHaveLength(1);
      expect(result.sellTrace[0]?.realizedPnlPercent).toBeCloseTo(((400 - 316) / 316) * 100, 5);
      expect(result.sellTrace[0]?.sufficientHoldings).toBe(true);
      // 2024-12-01 -> 2025-05-01 = 151 days
      expect(result.sellTrace[0]?.holdingPeriodDays).toBe(151);
    });

    it("flags sufficientHoldings=false for a sell exceeding known holdings, matching the warning", () => {
      const result = computePositions(
        [buy("TSLA", 3, 300, "2025-01-01", "buy-1"), sell("TSLA", 10, 350, "2025-02-01", "sell-1")],
        []
      );
      expect(result.sellTrace).toHaveLength(1);
      expect(result.sellTrace[0]?.sufficientHoldings).toBe(false);
      expect(result.warnings).toHaveLength(1);
    });

    it("omits a trace entry entirely for a sell with no prior holding at all", () => {
      const result = computePositions([sell("GHOST", 5, 100, "2025-01-01", "sell-1")], []);
      expect(result.sellTrace).toEqual([]);
      expect(result.warnings).toHaveLength(1);
    });
  });
});
