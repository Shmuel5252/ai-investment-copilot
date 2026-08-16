import { describe, expect, it } from "vitest";
import { validateImportRows } from "@/lib/import/validate";
import type { ColumnMapping } from "@/lib/import/types";

const mapping: ColumnMapping = {
  date: "Date",
  ticker: "Symbol",
  type: "Action",
  quantity: "Qty",
  price: "Price",
  amount: "Amount",
  notes: "Notes",
};

const mappingWithCommission: ColumnMapping = { ...mapping, commission: "Commission" };

describe("validateImportRows", () => {
  it("normalizes a valid buy row, deriving amount from quantity*price with correct sign", () => {
    const result = validateImportRows(
      [{ Date: "2025-01-15", Symbol: "aapl", Action: "Buy", Qty: "10", Price: "100", Amount: "", Notes: "" }],
      mapping
    );
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      ticker: "AAPL", // uppercased
      transactionType: "buy",
      quantity: 10,
      price: 100,
      amount: -1000, // cash out
    });
  });

  it("normalizes a sell row with positive cash effect", () => {
    const result = validateImportRows(
      [{ Date: "2025-02-01", Symbol: "AAPL", Action: "Sell", Qty: "4", Price: "150", Amount: "", Notes: "" }],
      mapping
    );
    expect(result.validRows[0]).toMatchObject({ transactionType: "sell", amount: 600 });
  });

  it("normalizes transaction type synonyms case-insensitively", () => {
    for (const [input, expected] of [
      ["PURCHASE", "buy"],
      ["sold", "sell"],
      ["Dividend", "dividend"],
      ["Transfer In", "deposit"],
      ["withdraw", "withdrawal"],
      ["Commission", "fee"],
    ] as const) {
      // buy/sell additionally require ticker+quantity — provide them so
      // this test isolates type-synonym normalization specifically.
      const needsPosition = expected === "buy" || expected === "sell";
      const result = validateImportRows(
        [
          {
            Date: "2025-01-01",
            Symbol: needsPosition ? "AAPL" : "",
            Action: input,
            Qty: needsPosition ? "1" : "",
            Price: needsPosition ? "1" : "",
            Amount: needsPosition ? "" : "100",
            Notes: "",
          },
        ],
        mapping
      );
      expect(result.invalidRows, `input "${input}"`).toEqual([]);
      expect(result.validRows[0]?.transactionType, `input "${input}"`).toBe(expected);
    }
  });

  it("rejects an unrecognized transaction type", () => {
    const result = validateImportRows(
      [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Frobnicate", Qty: "1", Price: "1", Amount: "", Notes: "" }],
      mapping
    );
    expect(result.validRows).toEqual([]);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.errors[0]).toMatch(/unrecognized transaction type/);
  });

  it("rejects an unparseable date", () => {
    const result = validateImportRows(
      [{ Date: "not-a-date", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" }],
      mapping
    );
    expect(result.invalidRows[0]?.errors).toContain("date is missing or unparseable");
  });

  it("requires ticker and quantity for buy/sell", () => {
    const result = validateImportRows(
      [{ Date: "2025-01-01", Symbol: "", Action: "Buy", Qty: "", Price: "100", Amount: "", Notes: "" }],
      mapping
    );
    expect(result.invalidRows[0]?.errors).toEqual(
      expect.arrayContaining(["buy requires a ticker", "buy requires a quantity"])
    );
  });

  it("normalizes deposit/withdrawal/fee/dividend using amount only, sign-corrected regardless of source sign", () => {
    const rows = [
      { Date: "2025-01-01", Symbol: "", Action: "Deposit", Qty: "", Price: "", Amount: "-5000", Notes: "" }, // source got sign "wrong" — we normalize
      { Date: "2025-01-02", Symbol: "", Action: "Withdrawal", Qty: "", Price: "", Amount: "200", Notes: "" },
      { Date: "2025-01-03", Symbol: "AAPL", Action: "Fee", Qty: "", Price: "", Amount: "1.5", Notes: "" },
      { Date: "2025-01-04", Symbol: "AAPL", Action: "Dividend", Qty: "", Price: "", Amount: "12.5", Notes: "" },
    ];
    const result = validateImportRows(rows, mapping);
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows.map((r) => r.amount)).toEqual([5000, -200, -1.5, 12.5]);
  });

  it("parses amounts with thousands separators, currency symbols, and parens-negative", () => {
    const result = validateImportRows(
      [
        { Date: "2025-01-01", Symbol: "", Action: "Deposit", Qty: "", Price: "", Amount: "$1,234.56", Notes: "" },
        { Date: "2025-01-02", Symbol: "", Action: "Fee", Qty: "", Price: "", Amount: "(2.50)", Notes: "" },
      ],
      mapping
    );
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows[0]?.amount).toBeCloseTo(1234.56);
    expect(result.validRows[1]?.amount).toBeCloseTo(-2.5);
  });

  it("collects detected tickers, deduplicated and sorted", () => {
    const rows = [
      { Date: "2025-01-01", Symbol: "MSFT", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" },
      { Date: "2025-01-02", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" },
      { Date: "2025-01-03", Symbol: "AAPL", Action: "Sell", Qty: "1", Price: "1", Amount: "", Notes: "" },
    ];
    const result = validateImportRows(rows, mapping);
    expect(result.detectedTickers).toEqual(["AAPL", "MSFT"]);
  });

  it("reports the correct rowIndex for invalid rows amid valid ones", () => {
    const rows = [
      { Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" },
      { Date: "bad-date", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" },
      { Date: "2025-01-03", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "1", Amount: "", Notes: "" },
    ];
    const result = validateImportRows(rows, mapping);
    expect(result.validRows.map((r) => r.rowIndex)).toEqual([0, 2]);
    expect(result.invalidRows.map((r) => r.rowIndex)).toEqual([1]);
  });

  // Regression coverage for a real bug found on a real manual import
  // (not a synthetic test): CANONICAL_FIELDS had no "commission" entry
  // at all, so a mapped Commission column was silently never read —
  // 85 of 153 real rows lost their commission, producing a cash balance
  // that matched sum(amount) exactly but was off from the true balance
  // by the sum of all commissions ($126.11 on that file). Kept as a
  // permanent fixture so this can't silently regress again.
  describe("commission (folded into amount, never silently dropped)", () => {
    it("reduces a buy's cash-out amount by the commission, beyond the trade principal", () => {
      const result = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "1.50", Notes: "" }],
        mappingWithCommission
      );
      expect(result.invalidRows).toEqual([]);
      // Without commission this would be -1000 (see the very first test above).
      expect(result.validRows[0]?.amount).toBeCloseTo(-1001.5);
    });

    it("reduces a sell's cash-in amount by the commission too, not increases it", () => {
      const result = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Sell", Qty: "4", Price: "150", Amount: "", Commission: "1.50", Notes: "" }],
        mappingWithCommission
      );
      // Without commission this would be +600 (see the sell test above).
      expect(result.validRows[0]?.amount).toBeCloseTo(598.5);
    });

    it("treats commission as a cost regardless of the source file's own sign convention", () => {
      const negativeConvention = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "100", Amount: "", Commission: "-1.50", Notes: "" }],
        mappingWithCommission
      );
      const positiveConvention = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "1", Price: "100", Amount: "", Commission: "1.50", Notes: "" }],
        mappingWithCommission
      );
      expect(negativeConvention.validRows[0]?.amount).toBeCloseTo(-101.5);
      expect(positiveConvention.validRows[0]?.amount).toBeCloseTo(-101.5);
    });

    it("leaves amount unchanged when commission is zero, blank, or the column isn't mapped at all", () => {
      const zero = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "0", Notes: "" }],
        mappingWithCommission
      );
      const blank = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "", Notes: "" }],
        mappingWithCommission
      );
      const unmapped = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Notes: "" }],
        mapping // no commission key in this mapping at all
      );
      expect(zero.validRows[0]?.amount).toBeCloseTo(-1000);
      expect(blank.validRows[0]?.amount).toBeCloseTo(-1000);
      expect(unmapped.validRows[0]?.amount).toBeCloseTo(-1000);
    });

    it("preserves the raw commission fact in notes rather than silently discarding it", () => {
      const result = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "1.50", Notes: "" }],
        mappingWithCommission
      );
      expect(result.validRows[0]?.notes).toBe("Commission: $1.50");
    });

    it("appends the commission note to an existing note rather than overwriting it", () => {
      const result = validateImportRows(
        [{ Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "1.50", Notes: "limit order" }],
        mappingWithCommission
      );
      expect(result.validRows[0]?.notes).toBe("limit order | Commission: $1.50");
    });

    it("the fixture that caught the real bug: sum(amount) across a small multi-row import equals the true net cash effect, not just sum of trade principals", () => {
      // Mirrors the real broker file: several buys/sells each with a small
      // non-zero commission. Before the fix, sum(amount) silently ignored
      // all four commissions; after the fix it must equal the true total.
      const rows = [
        { Date: "2025-01-01", Symbol: "AAPL", Action: "Buy", Qty: "10", Price: "100", Amount: "", Commission: "1.50", Notes: "" }, // -1001.50
        { Date: "2025-01-02", Symbol: "MSFT", Action: "Buy", Qty: "2", Price: "50", Amount: "", Commission: "1.50", Notes: "" }, // -101.50
        { Date: "2025-01-03", Symbol: "AAPL", Action: "Sell", Qty: "5", Price: "120", Amount: "", Commission: "1.50", Notes: "" }, // +598.50
        { Date: "2025-01-04", Symbol: "", Action: "Deposit", Qty: "", Price: "", Amount: "5000", Commission: "0", Notes: "" }, // +5000 (deposits aren't charged commission)
      ];
      const result = validateImportRows(rows, mappingWithCommission);
      expect(result.invalidRows).toEqual([]);
      const totalCash = result.validRows.reduce((sum, r) => sum + r.amount, 0);
      // True total: -1001.50 - 101.50 + 598.50 + 5000 = 4495.50
      expect(totalCash).toBeCloseTo(4495.5);
    });
  });
});
