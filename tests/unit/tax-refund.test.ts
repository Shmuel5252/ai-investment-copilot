// Import Blockers V1 — tax_refund as a first-class cash-in transaction type,
// through the production parser (validateImportRows), the production
// accounting walk (computePositions) and the production reconciliation
// engine (reconcileTransactions/planInsertions).
import { describe, expect, it } from "vitest";
import { validateImportRows, CASH_DIRECTION } from "@/lib/import/validate";
import type { ColumnMapping } from "@/lib/import/types";
import { computePositions } from "@/lib/portfolio/positions";
import { planInsertions, reconcileTransactions, transactionIdentityKey, type ExistingTransaction, type IncomingTransaction } from "@/lib/import/reconcile";

const mapping: ColumnMapping = { date: "date", ticker: "ticker", type: "type", quantity: "quantity", price: "price", amount: "amount", commission: "commission", notes: "notes" };
const row = (type: string, extra: Record<string, string> = {}) => ({ date: "2026-09-01", ticker: "", type, quantity: "", price: "", amount: "26.65", commission: "0", notes: "", ...extra });

describe("parsing", () => {
  it("canonical value, spaced form and the Hebrew broker label all parse to tax_refund with a positive cash effect", () => {
    for (const label of ["tax_refund", "tax refund", "Tax Refund", "refund", "זיכוי מס"]) {
      const r = validateImportRows([row(label)], mapping);
      expect(r.invalidRows, label).toEqual([]);
      expect(r.validRows[0], label).toMatchObject({ transactionType: "tax_refund", ticker: null, quantity: null, price: null, amount: 26.65 });
    }
    expect(CASH_DIRECTION.tax_refund).toBe(1);
  });
  it("sign is normalized: a negative amount in the file still becomes cash in", () => {
    expect(validateImportRows([row("tax_refund", { amount: "-26.65" })], mapping).validRows[0]!.amount).toBe(26.65);
  });
  it("ticker/quantity/price are not required; amount is", () => {
    expect(validateImportRows([row("tax_refund", { ticker: "AAPL" })], mapping).validRows[0]).toMatchObject({ ticker: "AAPL", transactionType: "tax_refund" });
    const missing = validateImportRows([row("tax_refund", { amount: "" })], mapping);
    expect(missing.validRows).toEqual([]);
    expect(missing.invalidRows[0]!.errors.join(" ")).toMatch(/amount is missing/);
  });
  it("historical tax charges are still 'fee' — nothing about them changed", () => {
    expect(validateImportRows([row("fee", { amount: "-31.65" })], mapping).validRows[0]).toMatchObject({ transactionType: "fee", amount: -31.65 });
    expect(validateImportRows([row("tax")], mapping).invalidRows).toHaveLength(1); // still unrecognized: no silent mapping
  });
});

describe("portfolio effect", () => {
  it("adds to cash only; never a position, never a warning, never an episode key", () => {
    const state = computePositions(
      [
        { id: "b", ticker: "A", transactionType: "buy", quantity: 1, price: 10, amount: -10, transactionDate: new Date("2026-08-01T00:00:00Z") },
        { id: "r", ticker: null, transactionType: "tax_refund", quantity: null, price: null, amount: 26.65, transactionDate: new Date("2026-09-01T00:00:00Z") },
      ],
      []
    );
    expect(state.cash).toBeCloseTo(16.65, 8);
    expect(state.positions.map((p) => p.ticker)).toEqual(["A"]);
    expect(state.warnings).toEqual([]);
    expect(state.episodeKeyByTransactionId.has("r")).toBe(false);
  });
});

describe("reconciliation", () => {
  const refund = (source: "csv_import" | "manual_entry" = "csv_import", amount: number | string = 26.65) => ({
    ticker: null, transactionType: "tax_refund" as const, quantity: null, price: null, amount, transactionDate: new Date("2026-09-01T00:00:00Z"), source,
  });
  it("identity is (no ticker, tax_refund, date, amount); a second import of the same refund is an exact duplicate; a different amount is new", () => {
    const incoming: IncomingTransaction[] = [{ clientRowKey: "0", ...refund() }];
    const first = reconcileTransactions(incoming, [], { mode: "csv_import" });
    expect(first.rows[0]!.class).toBe("new");
    expect(transactionIdentityKey(refund())).toBe("|tax_refund|2026-09-01T00:00:00.000Z|||26.65");
    const persisted: ExistingTransaction[] = [{ id: "e1", ...refund() }];
    const second = reconcileTransactions(incoming, persisted, { mode: "csv_import" });
    expect(second.rows[0]).toMatchObject({ class: "exact_duplicate", matchedExistingId: "e1" });
    expect(planInsertions(second, []).insert).toEqual([]);
    expect(reconcileTransactions([{ clientRowKey: "0", ...refund("csv_import", 26.66) }], persisted, { mode: "csv_import" }).rows[0]!.class).toBe("new");
  });
});
