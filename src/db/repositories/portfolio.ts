import { eq, and, inArray, sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { transactions, portfolioOpeningStates, importBatches } from "@/db/schema";

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
};

// The atomic confirm-time contract for the same-day ordering ambiguity
// (Investment Episode Independence design, "Ordering contract" +
// "Atomic confirm-time contract"). The ONE place either CSV import
// (confirmImport) or Manual Historical Entry (confirmManualEntry) writes
// transactions that might collide on (investor_id, ticker,
// transaction_date) — never a second, parallel implementation of this
// locking/resolution logic for the other entry point.
//
// Per (investor_id, ticker, transaction_date) key touched by this batch:
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
  values: NewTransactionWithOrder[]
): Promise<InferSelectModel<typeof transactions>[]> {
  if (values.length === 0) return [];

  for (const v of values) {
    if (v.investorId !== investorId) {
      throw new Error("confirmTransactionsWithOrdering: a row's investorId does not match the confirming investor.");
    }
  }

  return db.transaction(async (tx) => {
    const keys = new Map<string, { ticker: string; date: Date }>();
    for (const v of values) {
      if (!v.ticker) continue;
      const date = v.transactionDate as Date;
      keys.set(`${v.ticker}::${date.getTime()}`, { ticker: v.ticker, date });
    }

    const sortedKeyStrings = [...keys.keys()].sort();
    for (const keyStr of sortedKeyStrings) {
      const { ticker, date } = keys.get(keyStr)!;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${investorId} || ':' || ${ticker} || ':' || ${date.toISOString()}))`
      );
    }

    const resolvedOrder: (number | null)[] = values.map(() => null);
    const resolvedReason: ("user_declared" | "never_recorded" | null)[] = values.map(() => null);

    for (const keyStr of sortedKeyStrings) {
      const { ticker, date } = keys.get(keyStr)!;
      const indices = values
        .map((v, i) => i)
        .filter((i) => values[i]!.ticker === ticker && (values[i]!.transactionDate as Date).getTime() === date.getTime());

      const existingMembers = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.investorId, investorId), eq(transactions.ticker, ticker), eq(transactions.transactionDate, date)));

      const total = existingMembers.length + indices.length;
      if (total <= 1) continue; // both fields stay null — no ambiguity

      if (existingMembers.some((m) => m.intraDayOrder !== null)) {
        throw new OrderResolutionError(
          `${ticker} on ${date.toISOString().slice(0, 10)} already has a declared transaction order among existing rows — adding another same-day transaction here isn't supported yet.`
        );
      }

      if (existingMembers.length === 0) {
        const declared = indices.map((i) => values[i]!.clientDeclaredOrder);
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
        if (indices.some((i) => typeof values[i]!.clientDeclaredOrder === "number")) {
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

    const finalValues: NewTransaction[] = values.map((v, i) => ({
      // clientDeclaredOrder is a client-side hint only, consumed above —
      // never a real column, so it's simply not copied here rather than
      // destructured-and-discarded.
      investorId: v.investorId,
      ticker: v.ticker,
      transactionType: v.transactionType,
      quantity: v.quantity,
      price: v.price,
      amount: v.amount,
      transactionDate: v.transactionDate,
      source: v.source,
      importBatchId: v.importBatchId,
      notes: v.notes,
      intraDayOrder: resolvedOrder[i],
      orderUnknownReason: resolvedReason[i],
    }));

    return tx.insert(transactions).values(finalValues).returning();
  });
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
