import { describe, expect, it } from "vitest";
import { describeTransactionFacts } from "@/lib/ai/interview";
import type { SelectedTransaction } from "@/lib/interview/select-transactions";

describe("describeTransactionFacts", () => {
  it("describes a buy with no P/L context", () => {
    const candidate: SelectedTransaction = {
      transaction: {
        id: "t1",
        ticker: "AAPL",
        transactionType: "buy",
        quantity: 10,
        price: 150,
        amount: -1500,
        transactionDate: new Date("2025-01-05"),
      },
      category: "largest_buy",
    };
    const facts = describeTransactionFacts(candidate);
    expect(facts).toContain("Bought AAPL on 2025-01-05");
    expect(facts).toContain("10 shares at $150.00/share");
    expect(facts).toContain("largest buy");
    expect(facts).not.toContain("gain");
    expect(facts).not.toContain("loss");
  });

  it("describes a sell with P/L and holding period", () => {
    const candidate: SelectedTransaction = {
      transaction: {
        id: "t2",
        ticker: "TSLA",
        transactionType: "sell",
        quantity: 5,
        price: 300,
        amount: 1500,
        transactionDate: new Date("2025-06-01"),
      },
      category: "biggest_gain",
      realizedPnlPercent: 42.5,
      holdingPeriodDays: 90,
    };
    const facts = describeTransactionFacts(candidate);
    expect(facts).toContain("Sold TSLA");
    expect(facts).toContain("42.5% gain");
    expect(facts).toContain("Held for 90 day(s)");
  });

  it("describes a loss as a loss, not a negative gain", () => {
    const candidate: SelectedTransaction = {
      transaction: {
        id: "t3",
        ticker: "GME",
        transactionType: "sell",
        quantity: 5,
        price: 10,
        amount: 50,
        transactionDate: new Date("2025-03-01"),
      },
      category: "biggest_loss",
      realizedPnlPercent: -30,
      holdingPeriodDays: 5,
    };
    const facts = describeTransactionFacts(candidate);
    expect(facts).toContain("30.0% loss");
    expect(facts).not.toContain("-30");
  });

  it("never fabricates numbers it wasn't given", () => {
    const candidate: SelectedTransaction = {
      transaction: {
        id: "t4",
        ticker: "MSFT",
        transactionType: "buy",
        quantity: null,
        price: null,
        amount: -500,
        transactionDate: new Date("2025-01-01"),
      },
      category: "first_trade",
    };
    const facts = describeTransactionFacts(candidate);
    // Falls back to the total amount when quantity/price aren't present.
    expect(facts).toContain("$500.00");
    expect(facts).not.toMatch(/\d+ shares/);
  });
});
