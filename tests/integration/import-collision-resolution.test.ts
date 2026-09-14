// Integration coverage for the atomic same-day ordering confirm-time
// contract (Investment Episode Independence design) — exercises the real
// confirmTransactionsWithOrdering against a real local Postgres, the same
// convention every other integration test in this repo follows. Never
// calls dna.generate/proposeDnaHypotheses or writes any AI/hypothesis
// data — this is purely about the transactions table + its ordering
// columns.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  confirmTransactionsWithOrdering,
  OrderResolutionError,
  type NewTransactionWithOrder,
} from "@/db/repositories/portfolio";

const client = postgres(process.env.DATABASE_URL!, { max: 10 });
const db = drizzle(client, { schema });

let investorId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `collision-resolution-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Collision Resolution Test",
    })
    .returning();
  investorId = investor!.id;
});

afterAll(async () => {
  await db.delete(schema.transactions).where(eq(schema.transactions.investorId, investorId));
  await db.delete(schema.investors).where(eq(schema.investors.id, investorId));
  await client.end();
});

function row(
  ticker: string,
  type: "buy" | "sell",
  quantity: number,
  date: string,
  clientDeclaredOrder?: number
): NewTransactionWithOrder {
  return {
    investorId,
    ticker,
    transactionType: type,
    quantity: String(quantity),
    price: "10",
    amount: String(type === "buy" ? -quantity * 10 : quantity * 10),
    transactionDate: new Date(date),
    source: "manual_entry",
    importBatchId: null,
    notes: null,
    clientDeclaredOrder,
  };
}

describe("confirmTransactionsWithOrdering", () => {
  it("a batch with no same-day collision leaves both ordering fields null", async () => {
    const inserted = await confirmTransactionsWithOrdering(db, investorId, [
      row("NOCOL", "buy", 10, "2026-01-01"),
      row("NOCOL", "sell", 5, "2026-02-01"),
    ]);
    expect(inserted).toHaveLength(2);
    for (const t of inserted) {
      expect(t.intraDayOrder).toBeNull();
      expect(t.orderUnknownReason).toBeNull();
    }
  });

  it("a same-day collision purely within the batch, with distinct declared orders, is honored exactly", async () => {
    const inserted = await confirmTransactionsWithOrdering(db, investorId, [
      row("DECL", "sell", 8, "2026-03-01", 1),
      row("DECL", "buy", 2, "2026-03-01", 2),
    ]);
    expect(inserted).toHaveLength(2);
    const sell = inserted.find((t) => t.transactionType === "sell")!;
    const buy = inserted.find((t) => t.transactionType === "buy")!;
    expect(sell.intraDayOrder).toBe(1);
    expect(sell.orderUnknownReason).toBeNull();
    expect(buy.intraDayOrder).toBe(2);
    expect(buy.orderUnknownReason).toBeNull();
  });

  it("a same-day collision within the batch with an incomplete/missing declaration falls back to user_declared for the whole group", async () => {
    const inserted = await confirmTransactionsWithOrdering(db, investorId, [
      row("UNDECL", "sell", 8, "2026-04-01", 1), // only one row declared, the other wasn't
      row("UNDECL", "buy", 2, "2026-04-01"),
    ]);
    expect(inserted).toHaveLength(2);
    for (const t of inserted) {
      expect(t.intraDayOrder).toBeNull();
      expect(t.orderUnknownReason).toBe("user_declared");
    }
  });

  it("a new row colliding with an already-persisted row is auto-resolved to never_recorded on BOTH sides", async () => {
    const [existing] = await confirmTransactionsWithOrdering(db, investorId, [
      row("CROSS", "buy", 10, "2026-05-01"),
    ]);
    expect(existing!.intraDayOrder).toBeNull();
    expect(existing!.orderUnknownReason).toBeNull(); // lone row, no collision yet

    const inserted = await confirmTransactionsWithOrdering(db, investorId, [
      row("CROSS", "sell", 3, "2026-05-01"), // same investor+ticker+date as `existing`
    ]);
    expect(inserted[0]!.orderUnknownReason).toBe("never_recorded");
    expect(inserted[0]!.intraDayOrder).toBeNull();

    const refetched = await db.query.transactions.findFirst({ where: (t, { eq }) => eq(t.id, existing!.id) });
    expect(refetched!.orderUnknownReason).toBe("never_recorded"); // the OLD row was updated too
  });

  it("rejects (does not silently override) a declared order that turns out to collide with a pre-existing row", async () => {
    await confirmTransactionsWithOrdering(db, investorId, [row("STALE", "buy", 10, "2026-06-01")]);

    await expect(
      confirmTransactionsWithOrdering(db, investorId, [row("STALE", "sell", 3, "2026-06-01", 1)])
    ).rejects.toThrow(OrderResolutionError);

    // No partial write: the rejected row must not have been inserted.
    const rows = await db.query.transactions.findMany({
      where: (t, { and, eq }) => and(eq(t.investorId, investorId), eq(t.ticker, "STALE")),
    });
    expect(rows).toHaveLength(1); // only the original row
  });

  it("rejects adding another same-day transaction to a group that already has a declared order", async () => {
    await confirmTransactionsWithOrdering(db, investorId, [
      row("REDECL", "sell", 8, "2026-07-01", 1),
      row("REDECL", "buy", 2, "2026-07-01", 2),
    ]);

    await expect(
      confirmTransactionsWithOrdering(db, investorId, [row("REDECL", "buy", 1, "2026-07-01")])
    ).rejects.toThrow(OrderResolutionError);

    const rows = await db.query.transactions.findMany({
      where: (t, { and, eq }) => and(eq(t.investorId, investorId), eq(t.ticker, "REDECL")),
    });
    expect(rows).toHaveLength(2); // the third row was never inserted
  });

  it("resolves a multi-group batch (two independently colliding tickers) correctly in one call", async () => {
    const inserted = await confirmTransactionsWithOrdering(db, investorId, [
      row("MULTIA", "sell", 8, "2026-08-01", 2), // declared, out-of-numeric-order on purpose
      row("MULTIA", "buy", 2, "2026-08-01", 1),
      row("MULTIB", "sell", 5, "2026-08-01"), // undeclared -> user_declared
      row("MULTIB", "buy", 1, "2026-08-01"),
    ]);
    const aRows = inserted.filter((t) => t.ticker === "MULTIA");
    const bRows = inserted.filter((t) => t.ticker === "MULTIB");
    expect(aRows.every((t) => t.orderUnknownReason === null && t.intraDayOrder !== null)).toBe(true);
    expect(new Set(aRows.map((t) => t.intraDayOrder))).toEqual(new Set([1, 2]));
    expect(bRows.every((t) => t.orderUnknownReason === "user_declared" && t.intraDayOrder === null)).toBe(true);
  });

  it("two concurrent confirms targeting the same previously-empty group both succeed and both end up consistently order-unknown, never a partial mixed state", async () => {
    const [resultA, resultB] = await Promise.all([
      confirmTransactionsWithOrdering(db, investorId, [row("RACE", "buy", 10, "2026-09-01")]),
      confirmTransactionsWithOrdering(db, investorId, [row("RACE", "sell", 3, "2026-09-01")]),
    ]);

    const all = [...resultA, ...resultB];
    expect(all).toHaveLength(2);

    const refetched = await db.query.transactions.findMany({
      where: (t, { and, eq }) => and(eq(t.investorId, investorId), eq(t.ticker, "RACE")),
    });
    expect(refetched).toHaveLength(2);
    // Whichever committed first was a lone row (null/null) at that
    // instant; the second one, serialized behind the advisory lock, must
    // see it and force BOTH to never_recorded — never left as a silent,
    // unmarked, undetected collision, and never a mixed declared+unknown
    // state.
    for (const t of refetched) {
      expect(t.intraDayOrder).toBeNull();
      expect(t.orderUnknownReason).toBe("never_recorded");
    }
  });

  it("validates ownership: refuses a batch containing a row for a different investor", async () => {
    await expect(
      confirmTransactionsWithOrdering(db, investorId, [
        { ...row("OWNER", "buy", 1, "2026-10-01"), investorId: "00000000-0000-0000-0000-000000000000" },
      ])
    ).rejects.toThrow();
  });
});
