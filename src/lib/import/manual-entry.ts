import { z } from "zod";
import { computeAmountFromQuantityPrice } from "./validate";
import type { NewTransactionWithOrder } from "@/db/repositories/portfolio";

// Manual Historical Entry (docs/backlog.md) — Actual trades only, entered
// one batch at a time from the /import page's "manual" mode. Restricted
// to buy/sell on purpose (matches the approved UI spec literally: "כל
// row: ticker, BUY/SELL, quantity, price, date, notes") — dividend/
// deposit/withdrawal/fee have different required-field rules (see
// validate.ts's normalizeRow) and aren't part of this task's scope.
export const manualTransactionRowSchema = z.object({
  ticker: z.string().min(1),
  transactionType: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  price: z.number().positive(),
  transactionDate: z.coerce.date(),
  // General note about the row itself — never the investment rationale.
  // That distinction is enforced by UI copy (src/lib/i18n/strings.ts
  // manualEntryPage.notesPlaceholder), not by validation: notes is never
  // read by the DNA/Strategy Evidence pipeline (transactions.notes is
  // write-only there today, docs/backlog.md) — only InterviewAnswer.
  // answerText is, via the separate "Tell me why" flow.
  notes: z.string().optional(),
  // Same-day ordering (Investment Episode Independence design) — set only
  // when the client detected a same-day collision (via
  // import.checkManualEntryCollisions) and the user declared a relative
  // order for it. Absent/undefined means "no declaration" — the atomic
  // confirm-time contract (confirmTransactionsWithOrdering) then either
  // finds there's no real collision after all (most rows, most of the
  // time) or falls back to orderUnknownReason automatically; it never
  // trusts this field alone to prove there's no ambiguity.
  intraDayOrder: z.number().int().optional(),
});

// History Refresh V1 — the investor's explicit answer for a row the
// reconciliation preview flagged (src/lib/import/reconcile.ts
// ReconciliationResolution). Shared by CSV import and manual entry; keyed
// by the same clientRowKey the preview used for that row.
export const reconciliationResolutionSchema = z.object({
  clientRowKey: z.string().min(1),
  identityKey: z.string().min(1),
  action: z.enum(["same", "separate"]),
  existingTransactionId: z.string().uuid().optional(),
});

export const manualEntryBatchSchema = z.object({
  rows: z.array(manualTransactionRowSchema).min(1),
  // Keyed by String(row index) in `rows` — the key checkManualEntry used.
  resolutions: z.array(reconciliationResolutionSchema).default([]),
});

export type ManualTransactionRow = z.infer<typeof manualTransactionRowSchema>;

// The one place manual-entry input rows become real transaction values —
// exported and unit-tested directly (not duplicated in a test file) so
// the amount computation and source/importBatchId defaults stay provably
// correct as this evolves. `amount` is never accepted from the client
// (AI vs Code: deterministic facts are computed here, in code) —
// computeAmountFromQuantityPrice is the same canonical rule CSV import
// uses (validate.ts), not a second copy of it.
export function buildManualTransactionValues(
  investorId: string,
  rows: ManualTransactionRow[]
): NewTransactionWithOrder[] {
  return rows.map((row, index) => {
    const ticker = row.ticker.trim().toUpperCase();
    const amount = computeAmountFromQuantityPrice(row.transactionType, row.quantity, row.price);
    return {
      investorId,
      ticker,
      transactionType: row.transactionType,
      quantity: String(row.quantity),
      price: String(row.price),
      amount: String(amount),
      transactionDate: row.transactionDate,
      source: "manual_entry" as const,
      importBatchId: null,
      notes: row.notes?.trim() || null,
      clientDeclaredOrder: row.intraDayOrder,
      // Same key the checkManualEntry preview reports this row under.
      clientRowKey: String(index),
    };
  });
}
