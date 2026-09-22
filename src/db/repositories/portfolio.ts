import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { transactions, portfolioOpeningStates, importBatches } from "@/db/schema";
import {
  planInsertions,
  reconcileTransactions,
  type ReconciliationPlan,
  type ReconciliationResolution,
  type ReconciliationResult,
  type TransactionSource,
} from "@/lib/import/reconcile";

export type NewTransaction = InferInsertModel<typeof transactions>;
export type NewPortfolioOpeningState = InferInsertModel<typeof portfolioOpeningStates>;
export type NewImportBatch = InferInsertModel<typeof importBatches>;

// Transactions and PortfolioOpeningState are raw factual data, not
// judgments — correctable directly (docs/data-model.md §6), unlike
// everything in db/repositories/{dna,strategy,decisions,evidence}.ts.

export async function insertImportBatch(db: typeof Db, values: NewImportBatch) {
  const [row] = await db.insert(importBatches).values(values).returning();
  return row!;
}

// ImportBatch is traceability metadata about an import, not a judgment —
// same "raw fact, correctable" category as Transaction above, not the
// immutable-history tables in db/repositories/{dna,strategy,decisions,evidence}.ts.
// Narrow, explicitly-named exception (matching deleteTransaction below):
// used when an import needs to be fully reverted and redone (e.g. after
// fixing a real bug in the import logic itself), not a general-purpose
// "undo my import" UI action.
export async function deleteImportBatch(db: typeof Db, id: string) {
  await db.delete(importBatches).where(eq(importBatches.id, id));
}

// DbOrTx (not typeof Db) so this can run inside an outer db.transaction —
// Manual Historical Entry's batch submit wraps this call so a mid-batch
// failure leaves zero rows, not a partial batch (docs/backlog.md).
export async function insertTransactions(db: DbOrTx, values: NewTransaction[]) {
  if (values.length === 0) return [];
  return db.insert(transactions).values(values).returning();
}

// Thrown when a same-day group can't be safely auto-resolved and must be
// reported back to the user rather than silently reinterpreted — see
// confirmTransactionsWithOrdering's own comment for exactly which two
// cases this covers. Routers translate this into a clear TRPCError
// BAD_REQUEST (never let it surface as a raw 500); a distinct class
// rather than checking `err.message` keeps that translation reliable.
export class OrderResolutionError extends Error {}

export type NewTransactionWithOrder = NewTransaction & {
  /** User-declared relative order for a collision the client detected and let the user resolve — ignored (see below) once a cross-batch collision is discovered fresh, under the lock. */
  clientDeclaredOrder?: number;
  /** Correlation key for reconciliation resolutions (History Refresh V1) — must equal the key the preview used for this row (CSV: String(rowIndex)). Defaults to the row's position in the batch. */
  clientRowKey?: string;
};

export interface ConfirmTransactionsOptions {
  /** Which reconciliation policy applies (src/lib/import/reconcile.ts ReconcileOptions). */
  mode: TransactionSource;
  /** The investor's explicit answers for rows the preview flagged; verified against the fresh, under-lock classification — never trusted as-is. */
  resolutions?: readonly ReconciliationResolution[];
  /** CSV import only: create the ImportBatch row inside the same transaction and stamp it on every inserted row, so a refused import leaves no orphan batch and row_count always equals what the batch really contributed. */
  importBatch?: { filename: string };
}

export interface ConfirmTransactionsResult {
  inserted: InferSelectModel<typeof transactions>[];
  reconciliation: ReconciliationResult;
  plan: ReconciliationPlan;
  batch: InferSelectModel<typeof importBatches> | null;
}

// The atomic confirm-time contract for BOTH transaction-history questions
// — "is this row already in the history?" (History Refresh V1,
// reconciliation) and the same-day ordering ambiguity (Investment Episode
// Independence design, "Ordering contract" + "Atomic confirm-time
// contract"). The ONE place either CSV import (confirmImport) or Manual
// Historical Entry (confirmManualEntry) writes transactions — never a
// second, parallel implementation of this locking/resolution logic for
// the other entry point.
//
// Per (investor_id, ticker, transaction_date) key touched by this batch
// (ticker-less rows — fees, deposits — take a key with an empty ticker so
// they are reconciled under a lock too; they never take part in ordering):
//   1. A PostgreSQL transaction-scoped advisory lock is acquired
//      (pg_advisory_xact_lock(hashtext(investorId+ticker+date))) —
//      EVERY key this batch touches, even ones the client never flagged
//      as colliding, so two truly concurrent inserts to the same
//      previously-empty key are always serialized, never silently both
//      written as if nothing collided. Multi-key batches acquire every
//      lock up front, in canonical sorted (string) order, before any
//      resolution work — the standard fixed-order-acquisition rule that
//      avoids deadlock between two concurrent multi-group confirms.
//   2. Existing members for that key are re-fetched fresh, INSIDE the
//      lock (never trusting a client-supplied snapshot from an earlier,
//      separate preview query) — this is the "revalidate at confirm
//      time" step.
//   2b. Reconciliation (reconcileTransactions + planInsertions) runs on
//      exactly those fresh rows: exact duplicates are dropped (multiset:
//      only the excess over what is already persisted is new), rows that
//      may be a manual transcription of the same trade stop the import
//      unless the investor resolved them, and a resolution that no longer
//      matches the fresh classification fails the whole batch (stale).
//      Only the rows the plan keeps go on to ordering below. Two
//      concurrent confirms of the same overlapping file therefore
//      serialize on the locks and the second one finds nothing new.
//   3. Resolution:
//      - total members (existing + incoming) <= 1: no ambiguity at all;
//        both fields stay null.
//      - an existing member already has a declared order: this flow
//        doesn't support retroactively re-declaring an already-resolved
//        group (Non-goal, deferred product decision) -> OrderResolutionError.
//      - collision entirely within THIS batch (no existing members): if
//        every incoming row in the group has a distinct
//        clientDeclaredOrder, honor it (declared); otherwise the whole
//        group becomes orderUnknownReason='user_declared' (a human had
//        the opportunity, via the preview query, to resolve this and
//        didn't provide a complete declaration).
//      - collision involves a pre-existing row: if any incoming row in
//        the group carries a clientDeclaredOrder, that declaration was
//        computed against a preview that's now stale (a row appeared
//        since) -> OrderResolutionError, never silently overridden.
//        Otherwise, the whole group (existing rows whose reason is still
//        null included) is safely auto-resolved to
//        orderUnknownReason='never_recorded' — ambiguity discovered
//        after the fact, exactly the same semantics the migration's own
//        backfill uses for pre-existing data.
//   4. Insert, all in the same outer transaction — a mid-batch failure
//      (including an OrderResolutionError) leaves zero rows and no
//      existing-row updates, not a partial batch.
export async function confirmTransactionsWithOrdering(
  db: typeof Db,
  investorId: string,
  values: NewTransactionWithOrder[],
  options: ConfirmTransactionsOptions
): Promise<ConfirmTransactionsResult> {
  for (const v of values) {
    if (v.investorId !== investorId) {
      throw new Error("confirmTransactionsWithOrdering: a row's investorId does not match the confirming investor.");
    }
  }

  return db.transaction(async (tx) => {
    const keys = new Map<string, { ticker: string | null; date: Date }>();
    for (const v of values) {
      const date = v.transactionDate as Date;
      keys.set(`${v.ticker ?? ""}::${date.getTime()}`, { ticker: v.ticker ?? null, date });
    }

    const sortedKeyStrings = [...keys.keys()].sort();
    for (const keyStr of sortedKeyStrings) {
      const { ticker, date } = keys.get(keyStr)!;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${investorId} || ':' || ${ticker ?? ""} || ':' || ${date.toISOString()}))`
      );
    }

    // Fresh existing members per key, fetched once under the locks and
    // shared by reconciliation (2b) and ordering (3).
    const existingByKey = new Map<string, InferSelectModel<typeof transactions>[]>();
    for (const keyStr of sortedKeyStrings) {
      const { ticker, date } = keys.get(keyStr)!;
      const members = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.investorId, investorId),
            ticker === null ? isNull(transactions.ticker) : eq(transactions.ticker, ticker),
            eq(transactions.transactionDate, date)
          )
        );
      existingByKey.set(keyStr, members);
    }
    const existingAll = [...existingByKey.values()].flat();

    const reconciliation = reconcileTransactions(
      values.map((v, i) => ({
        clientRowKey: v.clientRowKey ?? String(i),
        ticker: v.ticker ?? null,
        transactionType: v.transactionType,
        quantity: v.quantity ?? null,
        price: v.price ?? null,
        amount: v.amount,
        transactionDate: v.transactionDate as Date,
        source: v.source,
      })),
      existingAll.map((e) => ({
        id: e.id,
        ticker: e.ticker,
        transactionType: e.transactionType,
        quantity: e.quantity,
        price: e.price,
        amount: e.amount,
        transactionDate: e.transactionDate,
        source: e.source,
      })),
      { mode: options.mode }
    );
    const plan = planInsertions(reconciliation, options.resolutions ?? []);
    const keep = new Set(plan.insert);
    const kept = values.filter((v, i) => keep.has(v.clientRowKey ?? String(i)));

    const batch = options.importBatch
      ? (
          await tx
            .insert(importBatches)
            .values({ investorId, filename: options.importBatch.filename, rowCount: kept.length, status: "completed" })
            .returning()
        )[0]!
      : null;

    const resolvedOrder: (number | null)[] = kept.map(() => null);
    const resolvedReason: ("user_declared" | "never_recorded" | null)[] = kept.map(() => null);

    for (const keyStr of sortedKeyStrings) {
      const { ticker, date } = keys.get(keyStr)!;
      if (ticker === null) continue; // ordering is a same-ticker question only
      const indices = kept
        .map((v, i) => i)
        .filter((i) => kept[i]!.ticker === ticker && (kept[i]!.transactionDate as Date).getTime() === date.getTime());
      if (indices.length === 0) continue; // every row for this key was reconciled away

      const existingMembers = existingByKey.get(keyStr)!;

      const total = existingMembers.length + indices.length;
      if (total <= 1) continue; // both fields stay null — no ambiguity

      if (existingMembers.some((m) => m.intraDayOrder !== null)) {
        throw new OrderResolutionError(
          `${ticker} on ${date.toISOString().slice(0, 10)} already has a declared transaction order among existing rows — adding another same-day transaction here isn't supported yet.`
        );
      }

      if (existingMembers.length === 0) {
        const declared = indices.map((i) => kept[i]!.clientDeclaredOrder);
        const allDeclared = declared.every((o) => typeof o === "number");
        const distinct = new Set(declared).size === declared.length;
        if (allDeclared && distinct) {
          indices.forEach((i, n) => {
            resolvedOrder[i] = declared[n]!;
          });
        } else {
          indices.forEach((i) => {
            resolvedReason[i] = "user_declared";
          });
        }
      } else {
        if (indices.some((i) => typeof kept[i]!.clientDeclaredOrder === "number")) {
          throw new OrderResolutionError(
            `${ticker} on ${date.toISOString().slice(0, 10)} now collides with an existing transaction that wasn't there when this order was declared — please reload and try again.`
          );
        }
        indices.forEach((i) => {
          resolvedReason[i] = "never_recorded";
        });
        const staleExisting = existingMembers.filter((m) => m.orderUnknownReason === null);
        if (staleExisting.length > 0) {
          await tx
            .update(transactions)
            .set({ orderUnknownReason: "never_recorded", updatedAt: new Date() })
            .where(inArray(transactions.id, staleExisting.map((m) => m.id)));
        }
      }
    }

    const finalValues: NewTransaction[] = kept.map((v, i) => ({
      // clientDeclaredOrder / clientRowKey are client-side hints only,
      // consumed above — never real columns, so they're simply not copied
      // here rather than destructured-and-discarded.
      investorId: v.investorId,
      ticker: v.ticker,
      transactionType: v.transactionType,
      quantity: v.quantity,
      price: v.price,
      amount: v.amount,
      transactionDate: v.transactionDate,
      source: v.source,
      importBatchId: batch ? batch.id : v.importBatchId,
      notes: v.notes,
      intraDayOrder: resolvedOrder[i],
      orderUnknownReason: resolvedReason[i],
    }));

    const inserted = finalValues.length === 0 ? [] : await tx.insert(transactions).values(finalValues).returning();
    return { inserted, reconciliation, plan, batch };
  });
}

// Raw `sql` aggregates bypass drizzle's column-level Date mapping (the
// postgres-js driver hands timestamptz back as text), so parse explicitly
// and loudly rather than trusting a duck-typed value.
function aggregateDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`getHistoryFreshness: unparseable timestamp "${String(value)}"`);
  return d;
}

// History freshness (History Refresh V1) — plain facts about how far the
// persisted history reaches, never a claim about the live portfolio:
// the latest transaction date, the latest import batch and the date
// window its rows cover, and manual-entry reach. Age in days is computed
// by the router (it needs "now").
export async function getHistoryFreshness(db: typeof Db, investorId: string) {
  const [overall] = await db
    .select({
      latestTransactionDate: sql<string | null>`max(${transactions.transactionDate})`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(eq(transactions.investorId, investorId));

  const [manual] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latestDate: sql<string | null>`max(${transactions.transactionDate})`,
    })
    .from(transactions)
    .where(and(eq(transactions.investorId, investorId), eq(transactions.source, "manual_entry")));

  const latestBatchRow = await db.query.importBatches.findFirst({
    where: (b, { eq }) => eq(b.investorId, investorId),
    orderBy: (b, { desc }) => desc(b.uploadedAt),
  });
  let latestBatch: {
    id: string;
    filename: string;
    uploadedAt: Date;
    rowCount: number;
    windowStart: Date | null;
    windowEnd: Date | null;
  } | null = null;
  if (latestBatchRow) {
    const [window] = await db
      .select({
        windowStart: sql<string | null>`min(${transactions.transactionDate})`,
        windowEnd: sql<string | null>`max(${transactions.transactionDate})`,
      })
      .from(transactions)
      .where(eq(transactions.importBatchId, latestBatchRow.id));
    latestBatch = {
      id: latestBatchRow.id,
      filename: latestBatchRow.filename,
      uploadedAt: latestBatchRow.uploadedAt,
      rowCount: latestBatchRow.rowCount,
      windowStart: aggregateDate(window?.windowStart),
      windowEnd: aggregateDate(window?.windowEnd),
    };
  }

  return {
    latestTransactionDate: aggregateDate(overall?.latestTransactionDate),
    transactionCount: overall?.transactionCount ?? 0,
    manualEntry: { count: manual?.count ?? 0, latestDate: aggregateDate(manual?.latestDate) },
    latestBatch,
  };
}

export async function getTransaction(db: typeof Db, id: string) {
  return db.query.transactions.findFirst({ where: (t, { eq }) => eq(t.id, id) });
}

export async function updateTransaction(
  db: typeof Db,
  id: string,
  values: Partial<NewTransaction>
) {
  await db
    .update(transactions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}

export async function deleteTransaction(db: typeof Db, id: string) {
  await db.delete(transactions).where(eq(transactions.id, id));
}

export async function listTransactionsForInvestor(db: typeof Db, investorId: string) {
  return db.query.transactions.findMany({
    where: (t, { eq }) => eq(t.investorId, investorId),
    orderBy: (t, { asc }) => asc(t.transactionDate),
  });
}

export async function insertPortfolioOpeningState(
  db: typeof Db,
  values: NewPortfolioOpeningState
) {
  const [row] = await db.insert(portfolioOpeningStates).values(values).returning();
  return row!;
}

export async function updatePortfolioOpeningState(
  db: typeof Db,
  id: string,
  values: Partial<NewPortfolioOpeningState>
) {
  await db
    .update(portfolioOpeningStates)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(portfolioOpeningStates.id, id));
}

export async function getPortfolioOpeningState(db: typeof Db, investorId: string, ticker: string) {
  return db.query.portfolioOpeningStates.findFirst({
    where: (o, { eq, and }) => and(eq(o.investorId, investorId), eq(o.ticker, ticker)),
  });
}

export async function listPortfolioOpeningStatesForInvestor(db: typeof Db, investorId: string) {
  return db.query.portfolioOpeningStates.findMany({
    where: (o, { eq }) => eq(o.investorId, investorId),
  });
}
