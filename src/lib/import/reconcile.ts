// History Refresh V1 — deterministic transaction reconciliation. Pure,
// DB-free, no AI: the ONE engine both CSV import (confirmImport) and Manual
// Historical Entry (confirmManualEntry) run BEFORE any row reaches the
// same-day ordering insertion in confirmTransactionsWithOrdering
// (src/db/repositories/portfolio.ts). Used twice per import — once for the
// read-only preview (import.validate / import.checkManualEntry) and again,
// authoritatively, at confirm time under the same advisory locks the
// ordering contract already takes; the preview is never trusted.
//
// Why it exists: before this unit the import path was fail-open — an
// identical row confirmed twice was persisted twice (proved on a scratch
// DB during the unit, see docs/backlog.md "History Refresh V1"), silently
// doubling positions, sellTrace, episode membership and every later frozen
// Decision Snapshot.
//
// Identity (docs/data-model.md §6 "Transaction identity"):
//   (ticker, transaction_type, transaction_date, quantity, price, amount)
// with each numeric in canonical decimal form (canonicalDecimal below).
// Identity is MULTISET-aware: N existing occurrences of a key absorb at
// most N incoming occurrences; any excess is genuinely new (two identical
// same-day buys are a real thing). No DB UNIQUE constraint can express
// that, so none is added.
//
// Cross-source near-match ("probable manual match"): a manually entered
// row is a human transcription of a broker trade that may later arrive in
// a CSV with a different amount (commission folded in by validate.ts) or
// fewer/more decimals. Two rows with the same ticker/type/date whose
// quantity AND price agree at the coarser of their two recorded
// precisions (nearDecimal) are a CANDIDATE pair — never automatically the
// same trade. Only pairs with a manual_entry row on at least one side are
// considered; two CSV rows are either identical or different.
import type { CanonicalTransactionType } from "./types";

export type TransactionSource = "csv_import" | "manual_entry";

export interface ReconcilableTransaction {
  ticker: string | null;
  transactionType: CanonicalTransactionType;
  quantity: number | string | null;
  price: number | string | null;
  amount: number | string;
  transactionDate: Date;
  source: TransactionSource;
}

export interface ExistingTransaction extends ReconcilableTransaction {
  id: string;
}

export interface IncomingTransaction extends ReconcilableTransaction {
  /** Caller-assigned key, stable between preview and confirm (CSV: String(rowIndex); manual: String(index)). */
  clientRowKey: string;
}

// --- Numeric canonical form -------------------------------------------
//
// The pipeline's authoritative numeric representation is `String(number)`
// written into a Postgres `numeric` (validate.ts / manual-entry.ts), which
// leaks IEEE-754 noise: the real MRVL manual row stores
// amount = -999.9901229999999 for 4.5419 × 220.17 (true value 999.990123).
// True precision never exceeds 6 decimals (4-dp quantity × 2-dp price;
// CSV amounts are ≤ 2 dp — measured on the real data set), so rounding to
// IDENTITY_SCALE decimals removes only that noise and never a real digit.
// This is representation canonicalization, not a similarity tolerance.
export const IDENTITY_SCALE = 8;

export function canonicalDecimal(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`canonicalDecimal: not a finite number: ${String(value)}`);
  const fixed = n.toFixed(IDENTITY_SCALE);
  // toFixed falls back to exponent notation at |n| >= 1e21 — no real
  // transaction gets there, and a key built from "1e+21" would silently
  // equate everything past that magnitude. Fail loudly instead.
  if (!/^-?\d+\.\d+$/.test(fixed)) throw new Error(`canonicalDecimal: value out of supported range: ${String(value)}`);
  const stripped = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return stripped === "-0" ? "0" : stripped;
}

export function decimalScale(canonical: string): number {
  const dot = canonical.indexOf(".");
  return dot === -1 ? 0 : canonical.length - dot - 1;
}

// Half-up rounding on the decimal DIGITS of a canonical string — never
// through a float — so 20.655 → 20.66 and 1.005 → 1.01 exactly.
export function roundDecimalString(canonical: string, scale: number): string {
  const negative = canonical.startsWith("-");
  const digits = negative ? canonical.slice(1) : canonical;
  const [intPart, fracPart = ""] = digits.split(".");
  if (fracPart.length <= scale) return canonical;
  const keep = fracPart.slice(0, scale);
  const next = fracPart.charCodeAt(scale) - 48;
  let combined = (intPart! + keep).split("").map((c) => c.charCodeAt(0) - 48);
  if (next >= 5) {
    let i = combined.length - 1;
    while (i >= 0) {
      if (combined[i]! < 9) {
        combined[i]!++;
        break;
      }
      combined[i] = 0;
      i--;
    }
    if (i < 0) combined = [1, ...combined];
  }
  const all = combined.join("");
  const newInt = all.slice(0, all.length - scale) || "0";
  const newFrac = scale > 0 ? all.slice(all.length - scale) : "";
  let out = newFrac ? `${newInt}.${newFrac}`.replace(/0+$/, "").replace(/\.$/, "") : newInt;
  out = out.replace(/^0+(?=\d)/, "");
  if (/^0(\.0*)?$/.test(out) || out === "") return "0";
  return negative ? `-${out}` : out;
}

// Two recorded values agree at the coarser of their two precisions: the
// manual entry "20.65" and the broker's "20.6521" agree (scale 2);
// "20.6521" and "20.6522" do not (scale 4). The narrowest rule the data
// contract itself justifies — a typed value is a rounding of the true one.
export function nearDecimal(a: number | string | null, b: number | string | null): boolean {
  const ca = canonicalDecimal(a);
  const cb = canonicalDecimal(b);
  if (ca === null || cb === null) return ca === cb;
  const scale = Math.min(decimalScale(ca), decimalScale(cb));
  return roundDecimalString(ca, scale) === roundDecimalString(cb, scale);
}

export function normalizeTicker(ticker: string | null): string | null {
  const t = ticker?.trim().toUpperCase();
  return t ? t : null;
}

export function transactionIdentityKey(row: ReconcilableTransaction): string {
  return [
    normalizeTicker(row.ticker) ?? "",
    row.transactionType,
    row.transactionDate.toISOString(),
    canonicalDecimal(row.quantity) ?? "",
    canonicalDecimal(row.price) ?? "",
    canonicalDecimal(row.amount) ?? "",
  ].join("|");
}

// Same investor is implicit (callers scope both sides to one investor).
export function isNearMatch(a: ReconcilableTransaction, b: ReconcilableTransaction): boolean {
  if (a.source !== "manual_entry" && b.source !== "manual_entry") return false;
  if (normalizeTicker(a.ticker) !== normalizeTicker(b.ticker)) return false;
  if (a.transactionType !== b.transactionType) return false;
  if (a.transactionDate.getTime() !== b.transactionDate.getTime()) return false;
  if (a.transactionType === "buy" || a.transactionType === "sell") {
    if (a.quantity === null || b.quantity === null || a.price === null || b.price === null) return false;
    return nearDecimal(a.quantity, b.quantity) && nearDecimal(a.price, b.price);
  }
  return nearDecimal(a.amount, b.amount);
}

// --- Classification ------------------------------------------------------

export type ReconciliationClass = "new" | "exact_duplicate" | "probable_manual_match" | "ambiguous";

export interface TransactionFacts {
  ticker: string | null;
  transactionType: CanonicalTransactionType;
  transactionDate: Date;
  quantity: string | null;
  price: string | null;
  amount: string;
  source: TransactionSource;
}

export interface CandidateFacts extends TransactionFacts {
  id: string;
}

export interface RowReconciliation {
  clientRowKey: string;
  class: ReconciliationClass;
  identityKey: string;
  incoming: TransactionFacts;
  /** exact_duplicate: the persisted row consumed by this one (absent when the duplicate is an earlier row of THIS batch). */
  matchedExistingId: string | null;
  /** exact_duplicate only: true when the duplicate is another row of the same batch, not a persisted row. */
  withinBatch: boolean;
  /** probable_manual_match: exactly one; ambiguous: one or more (shared, or several). */
  candidates: CandidateFacts[];
  /** Whether confirm refuses to proceed without an explicit resolution for this row. */
  requiresResolution: boolean;
}

export interface ReconciliationCounts {
  new: number;
  exact_duplicate: number;
  probable_manual_match: number;
  ambiguous: number;
  requiresResolution: number;
}

export interface ReconciliationResult {
  mode: TransactionSource;
  rows: RowReconciliation[];
  counts: ReconciliationCounts;
}

export interface ReconcileOptions {
  /**
   * csv_import: identical rows inside the batch are legitimate repeats (a
   * broker file lists each fill); exact duplicates of persisted rows are
   * skipped silently and cannot be overridden.
   * manual_entry: an identical row — persisted OR earlier in the same form
   * — is flagged and blocks until the investor explicitly says it is a
   * separate identical trade.
   */
  mode: TransactionSource;
}

function facts(row: ReconcilableTransaction): TransactionFacts {
  return {
    ticker: normalizeTicker(row.ticker),
    transactionType: row.transactionType,
    transactionDate: row.transactionDate,
    quantity: canonicalDecimal(row.quantity),
    price: canonicalDecimal(row.price),
    amount: canonicalDecimal(row.amount)!,
    source: row.source,
  };
}

export function reconcileTransactions(
  incoming: readonly IncomingTransaction[],
  existing: readonly ExistingTransaction[],
  options: ReconcileOptions
): ReconciliationResult {
  const manual = options.mode === "manual_entry";

  // Multiset of persisted rows per identity key, in id order so which
  // occurrence a duplicate "consumes" is deterministic.
  const existingByKey = new Map<string, ExistingTransaction[]>();
  for (const row of [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const key = transactionIdentityKey(row);
    const list = existingByKey.get(key);
    if (list) list.push(row);
    else existingByKey.set(key, [row]);
  }
  const consumed = new Set<string>();
  const seenInBatch = new Set<string>();

  // Pass 1 — exact identity, in batch order (identical rows are
  // interchangeable, so batch order only decides WHICH of them is "new").
  type Draft = Omit<RowReconciliation, "candidates" | "requiresResolution"> & { candidates: ExistingTransaction[] };
  const drafts: Draft[] = incoming.map((row) => {
    const key = transactionIdentityKey(row);
    const base = { clientRowKey: row.clientRowKey, identityKey: key, incoming: facts(row), withinBatch: false };
    const pool = existingByKey.get(key);
    const match = pool?.find((e) => !consumed.has(e.id));
    const seenBefore = seenInBatch.has(key);
    seenInBatch.add(key);
    if (match) {
      consumed.add(match.id);
      return { ...base, class: "exact_duplicate", matchedExistingId: match.id, candidates: [] };
    }
    if (manual && seenBefore) {
      return { ...base, class: "exact_duplicate", matchedExistingId: null, withinBatch: true, candidates: [] };
    }
    return { ...base, class: "new", matchedExistingId: null, candidates: [] };
  });

  // Pass 2 — near-match candidates among the persisted rows no exact
  // duplicate consumed.
  const free = existing.filter((e) => !consumed.has(e.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const candidateUse = new Map<string, number>();
  drafts.forEach((draft, i) => {
    if (draft.class !== "new") return;
    const row = incoming[i]!;
    draft.candidates = free.filter((e) => isNearMatch(row, e));
    for (const c of draft.candidates) candidateUse.set(c.id, (candidateUse.get(c.id) ?? 0) + 1);
  });

  const rows: RowReconciliation[] = drafts.map((draft) => {
    let cls: ReconciliationClass = draft.class;
    if (cls === "new" && draft.candidates.length > 0) {
      const sole = draft.candidates.length === 1 && candidateUse.get(draft.candidates[0]!.id) === 1;
      cls = sole ? "probable_manual_match" : "ambiguous";
    }
    const requiresResolution =
      cls === "probable_manual_match" || cls === "ambiguous" || (cls === "exact_duplicate" && manual);
    return {
      clientRowKey: draft.clientRowKey,
      class: cls,
      identityKey: draft.identityKey,
      incoming: draft.incoming,
      matchedExistingId: draft.matchedExistingId,
      withinBatch: draft.withinBatch,
      candidates: draft.candidates.map((c) => ({ id: c.id, ...facts(c) })),
      requiresResolution,
    };
  });

  const counts: ReconciliationCounts = { new: 0, exact_duplicate: 0, probable_manual_match: 0, ambiguous: 0, requiresResolution: 0 };
  for (const r of rows) {
    counts[r.class]++;
    if (r.requiresResolution) counts.requiresResolution++;
  }
  return { mode: options.mode, rows, counts };
}

// --- Resolutions → insertion plan -----------------------------------------

export interface ReconciliationResolution {
  clientRowKey: string;
  /**
   * The identity key of the incoming row this answer was given for, as the
   * preview reported it. A clientRowKey is only a position; binding the
   * answer to the row's identity means a payload whose row at that position
   * changed (different file, edited form) can never inherit the answer.
   */
  identityKey: string;
  /** "same": the incoming row IS the referenced persisted row — keep the persisted one, skip this row. "separate": insert it. */
  action: "same" | "separate";
  /** Required for "same" on a probable/ambiguous row; must be one of that row's current candidates. */
  existingTransactionId?: string;
}

export type ReconciliationErrorCode = "unresolved" | "stale" | "invalid";

// Routers translate this into a BAD_REQUEST with the message as-is; the
// code lets tests pin the exact failure without matching prose.
export class ReconciliationError extends Error {
  constructor(
    public readonly code: ReconciliationErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface ReconciliationPlan {
  /** clientRowKeys to insert, in incoming order. */
  insert: string[];
  skippedExact: string[];
  skippedSame: string[];
  /** rows the investor explicitly declared separate (subset of insert). */
  separate: string[];
}

// Fail-closed: every row that requires a resolution must have exactly one
// valid one, and a resolution for a row that (now) needs none is treated as
// stale — history changed between preview and confirm — never silently
// applied.
export function planInsertions(
  result: ReconciliationResult,
  resolutions: readonly ReconciliationResolution[]
): ReconciliationPlan {
  const manual = result.mode === "manual_entry";
  const byKey = new Map<string, ReconciliationResolution>();
  for (const r of resolutions) {
    if (byKey.has(r.clientRowKey)) {
      throw new ReconciliationError("invalid", `Row ${r.clientRowKey} was resolved more than once.`);
    }
    byKey.set(r.clientRowKey, r);
  }
  const known = new Set(result.rows.map((r) => r.clientRowKey));
  for (const key of byKey.keys()) {
    if (!known.has(key)) {
      throw new ReconciliationError("stale", `Row ${key} is not part of this import any more — review the file again.`);
    }
  }

  const plan: ReconciliationPlan = { insert: [], skippedExact: [], skippedSame: [], separate: [] };
  const claimed = new Set<string>();

  for (const row of result.rows) {
    const resolution = byKey.get(row.clientRowKey);
    if (resolution && resolution.identityKey !== row.identityKey) {
      throw new ReconciliationError(
        "stale",
        `Row ${row.clientRowKey} is not the row this answer was given for — the file changed since the preview. Review it again.`
      );
    }

    if (row.class === "new") {
      if (resolution) {
        throw new ReconciliationError(
          "stale",
          `Row ${row.clientRowKey} no longer needs a resolution — history changed since the preview. Review the file again.`
        );
      }
      plan.insert.push(row.clientRowKey);
      continue;
    }

    if (row.class === "exact_duplicate") {
      if (!manual) {
        if (resolution) {
          throw new ReconciliationError(
            "invalid",
            `Row ${row.clientRowKey} is an exact duplicate of an already-imported transaction and is always skipped.`
          );
        }
        plan.skippedExact.push(row.clientRowKey);
        continue;
      }
      if (!resolution) {
        throw new ReconciliationError(
          "unresolved",
          `Row ${row.clientRowKey} is identical to an existing transaction — confirm it is a separate trade, or remove it.`
        );
      }
      if (resolution.action === "separate") {
        plan.insert.push(row.clientRowKey);
        plan.separate.push(row.clientRowKey);
      } else {
        plan.skippedExact.push(row.clientRowKey);
      }
      continue;
    }

    // probable_manual_match / ambiguous
    if (!resolution) {
      throw new ReconciliationError(
        "unresolved",
        `Row ${row.clientRowKey} may be a transaction you already entered manually — decide whether it is the same trade or a separate one.`
      );
    }
    if (resolution.action === "separate") {
      plan.insert.push(row.clientRowKey);
      plan.separate.push(row.clientRowKey);
      continue;
    }
    const target = resolution.existingTransactionId;
    if (!target || !row.candidates.some((c) => c.id === target)) {
      throw new ReconciliationError(
        "stale",
        `Row ${row.clientRowKey} was matched to a transaction that is no longer a candidate — review the file again.`
      );
    }
    if (claimed.has(target)) {
      throw new ReconciliationError("invalid", `Two rows were both marked as the same trade as one existing transaction.`);
    }
    claimed.add(target);
    plan.skippedSame.push(row.clientRowKey);
  }

  return plan;
}
