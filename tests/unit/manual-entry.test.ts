import { describe, expect, it } from "vitest";
import {
  manualTransactionRowSchema,
  manualEntryBatchSchema,
  buildManualTransactionValues,
} from "@/lib/import/manual-entry";
import { computeAmountFromQuantityPrice } from "@/lib/import/validate";

describe("computeAmountFromQuantityPrice", () => {
  it("buy: negative amount (cash left the account)", () => {
    expect(computeAmountFromQuantityPrice("buy", 20.6521, 48.42)).toBeCloseTo(-999.97, 2);
  });

  it("sell: positive amount (cash entered the account)", () => {
    expect(computeAmountFromQuantityPrice("sell", 12.1317, 57.62)).toBeCloseTo(699.03, 2);
  });

  it("ignores the sign of quantity/price it's given — direction comes only from type", () => {
    expect(computeAmountFromQuantityPrice("buy", 10, 5)).toBe(-50);
  });
});

describe("manualTransactionRowSchema", () => {
  const validRow = {
    ticker: "MP",
    transactionType: "buy" as const,
    quantity: 20.6521,
    price: 48.42,
    transactionDate: "2026-08-05",
  };

  it("accepts a valid row", () => {
    expect(manualTransactionRowSchema.safeParse(validRow).success).toBe(true);
  });

  it("rejects a missing ticker", () => {
    expect(manualTransactionRowSchema.safeParse({ ...validRow, ticker: "" }).success).toBe(false);
  });

  it.each(["hold", "PASS", "", "dividend"])("rejects an invalid transaction type: %p", (bad) => {
    expect(
      manualTransactionRowSchema.safeParse({ ...validRow, transactionType: bad }).success
    ).toBe(false);
  });

  it.each([0, -1, -20.6521])("rejects a non-positive quantity: %p", (bad) => {
    expect(manualTransactionRowSchema.safeParse({ ...validRow, quantity: bad }).success).toBe(false);
  });

  it.each([0, -1, -48.42])("rejects a non-positive price: %p", (bad) => {
    expect(manualTransactionRowSchema.safeParse({ ...validRow, price: bad }).success).toBe(false);
  });

  it("rejects an unparseable date", () => {
    expect(
      manualTransactionRowSchema.safeParse({ ...validRow, transactionDate: "not-a-date" }).success
    ).toBe(false);
  });

  it("accepts a row with no notes (optional)", () => {
    expect(manualTransactionRowSchema.safeParse(validRow).success).toBe(true);
  });
});

describe("manualEntryBatchSchema", () => {
  const validRow = {
    ticker: "MP",
    transactionType: "buy" as const,
    quantity: 1,
    price: 1,
    transactionDate: "2026-08-05",
  };

  it("rejects an empty batch", () => {
    expect(manualEntryBatchSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("accepts a batch with at least one valid row", () => {
    expect(manualEntryBatchSchema.safeParse({ rows: [validRow] }).success).toBe(true);
  });
});

describe("buildManualTransactionValues", () => {
  it("computes amount server-side (never trusts a client-supplied amount — there's no amount field to trust in the first place)", () => {
    const [value] = buildManualTransactionValues("investor-1", [
      {
        ticker: "mp",
        transactionType: "buy",
        quantity: 20.6521,
        price: 48.42,
        transactionDate: new Date("2026-08-05"),
      },
    ]);
    expect(Number(value!.amount)).toBeCloseTo(-999.97, 2);
  });

  it("normalizes ticker to trimmed uppercase", () => {
    const [value] = buildManualTransactionValues("investor-1", [
      {
        ticker: "  mp  ",
        transactionType: "buy",
        quantity: 1,
        price: 1,
        transactionDate: new Date("2026-08-05"),
      },
    ]);
    expect(value!.ticker).toBe("MP");
  });

  it("always sets source=manual_entry and importBatchId=null", () => {
    const [value] = buildManualTransactionValues("investor-1", [
      { ticker: "MP", transactionType: "buy", quantity: 1, price: 1, transactionDate: new Date() },
    ]);
    expect(value!.source).toBe("manual_entry");
    expect(value!.importBatchId).toBeNull();
  });

  it("preserves each row's own transactionDate — order in the array doesn't imply chronological order", () => {
    const values = buildManualTransactionValues("investor-1", [
      {
        ticker: "MP",
        transactionType: "sell",
        quantity: 12.1317,
        price: 57.62,
        transactionDate: new Date("2026-08-24"),
      },
      {
        ticker: "MP",
        transactionType: "buy",
        quantity: 20.6521,
        price: 48.42,
        transactionDate: new Date("2026-08-05"),
      },
    ]);
    expect(values[0]!.transactionDate).toEqual(new Date("2026-08-24"));
    expect(values[1]!.transactionDate).toEqual(new Date("2026-08-05"));
  });

  it("stores an empty/whitespace-only note as null, not an empty string", () => {
    const [value] = buildManualTransactionValues("investor-1", [
      {
        ticker: "MP",
        transactionType: "buy",
        quantity: 1,
        price: 1,
        transactionDate: new Date(),
        notes: "   ",
      },
    ]);
    expect(value!.notes).toBeNull();
  });
});
