import { describe, expect, it } from "vitest";
import { suggestColumnMapping } from "@/lib/import/suggest-mapping";
import { parseCsv } from "@/lib/import/csv";

describe("suggestColumnMapping", () => {
  it("maps common broker export header names to canonical fields", () => {
    const mapping = suggestColumnMapping([
      "Trade Date",
      "Symbol",
      "Action",
      "Quantity",
      "Price",
      "Amount",
      "Notes",
    ]);
    expect(mapping).toEqual({
      date: "Trade Date",
      ticker: "Symbol",
      type: "Action",
      quantity: "Quantity",
      price: "Price",
      amount: "Amount",
      notes: "Notes",
    });
  });

  it("is case- and whitespace-insensitive", () => {
    const mapping = suggestColumnMapping(["  DATE  ", "ticker", "TYPE"]);
    expect(mapping.date).toBe("  DATE  ");
    expect(mapping.ticker).toBe("ticker");
    expect(mapping.type).toBe("TYPE");
  });

  it("leaves a field unmapped when nothing matches", () => {
    const mapping = suggestColumnMapping(["Column A", "Column B"]);
    expect(mapping.date).toBeUndefined();
    expect(mapping.ticker).toBeUndefined();
  });

  it("prefers an exact header match over a partial one", () => {
    // "Transaction Type" contains "type" as a substring of "action"-style
    // synonyms too, but "Type" should win as the exact match.
    const mapping = suggestColumnMapping(["Some Related Type Field", "Type"]);
    expect(mapping.type).toBe("Type");
  });
});

describe("parseCsv", () => {
  it("parses headers and rows from a simple CSV", () => {
    const csv = "Date,Symbol,Action\n2025-01-01,AAPL,Buy\n2025-01-02,MSFT,Sell";
    const result = parseCsv(csv);
    expect(result.headers).toEqual(["Date", "Symbol", "Action"]);
    expect(result.rows).toEqual([
      { Date: "2025-01-01", Symbol: "AAPL", Action: "Buy" },
      { Date: "2025-01-02", Symbol: "MSFT", Action: "Sell" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Date,Notes\n2025-01-01,"Bought on a dip, felt good"';
    const result = parseCsv(csv);
    expect(result.rows[0]?.Notes).toBe("Bought on a dip, felt good");
  });

  it("trims header whitespace", () => {
    const csv = " Date , Symbol \n2025-01-01,AAPL";
    const result = parseCsv(csv);
    expect(result.headers).toEqual(["Date", "Symbol"]);
  });
});
