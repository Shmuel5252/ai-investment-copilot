// Import Blockers V1 — production-path tests through the REAL import
// router (createCaller), repositories, the DB wrapper and Postgres, on the
// authorized test database only (tests/support). No AI is involved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { importRouter } from "@/server/routers/import";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { insertCorporateAction, listCorporateActionsForInvestor } from "@/db/repositories/corporate-actions";
import { loadIndependenceContext } from "@/lib/evidence/load-independence-resolver";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 6 });
const db = drizzle(client, { schema });
const caller = (investorId: string) => importRouter.createCaller({ session: { investorId } } as never);
const mapping = { date: "Date", ticker: "Symbol", type: "Action", quantity: "Qty", price: "Price", amount: "Amount", commission: "Commission" };
const HEADER = "Date,Symbol,Action,Qty,Price,Amount,Commission";
const csvOf = (...lines: string[]) => [HEADER, ...lines].join("\n");
const CRWD_CSV = csvOf("2026-04-17,CRWD,Buy,0.7383,423.90,,", "2026-07-13,CRWD,Sell,2.9532,187.84,,");
const CRWD_SPLIT = { ticker: "CRWD", effectiveDate: new Date("2026-07-02T00:00:00Z"), ratioNumerator: 4, ratioDenominator: 1, source: "issuer_disclosure" as const, evidence: "issuer 4-for-1 disclosure; broker 30.06 0.7383 @ 763.14, 13.07 2.9532 @ 187.84", confirmed: true as const };

let investorId: string;
let foreignInvestorId: string;

beforeAll(async () => {
  investorId = await mkInvestor(db, "import-blockers");
  foreignInvestorId = await mkInvestor(db, "import-blockers-foreign");
});
afterAll(async () => {
  await client.end();
});

const expectBadRequest = async (p: Promise<unknown>, pattern?: RegExp) => {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("BAD_REQUEST");
  if (pattern) expect((err as TRPCError).message).toMatch(pattern);
};

describe("migration 0012 on the scratch DB", () => {
  it("transaction_type carries tax_refund; corporate_actions exists with its CHECK and unique index", async () => {
    const enumRows = await db.execute(
      `select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'transaction_type' order by e.enumsortorder`
    );
    expect(enumRows.map((r) => r.label)).toEqual(["buy", "sell", "dividend", "deposit", "withdrawal", "fee", "tax_refund"]);
    const constraints = await db.execute(`select conname from pg_constraint where conrelid = 'corporate_actions'::regclass order by conname`);
    expect(constraints.map((r) => r.conname)).toEqual(
      expect.arrayContaining(["corporate_actions_ratio_positive", "corporate_actions_investor_id_investors_id_fk", "corporate_actions_pkey"])
    );
    const indexes = await db.execute(`select indexname from pg_indexes where tablename = 'corporate_actions'`);
    expect(indexes.map((r) => r.indexname)).toContain("corporate_actions_investor_ticker_effective_date_unique");
  });
});

describe("recording stock splits", () => {
  it("before any split, the CRWD preview flags an oversell (opening-state warning) — the pre-unit behaviour", async () => {
    const preview = await caller(investorId).validate({ csvContent: CRWD_CSV, mapping });
    expect(preview.tickersNeedingOpeningState).toEqual(["CRWD"]);
    expect(await caller(investorId).corporateActions()).toEqual([]);
  });

  it("records the approved CRWD 4:1 fact (date normalized to 00:00Z, ticker upper-cased), lists it, and refuses the same split twice", async () => {
    const row = await caller(investorId).recordStockSplit({ ...CRWD_SPLIT, ticker: " crwd ", effectiveDate: new Date("2026-07-02T15:30:00Z") });
    expect(row).toMatchObject({ investorId, ticker: "CRWD", kind: "stock_split", ratioNumerator: 4, ratioDenominator: 1, source: "issuer_disclosure" });
    expect(row.effectiveDate.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    const listed = await caller(investorId).corporateActions();
    expect(listed.map((a) => a.id)).toEqual([row.id]);
    await expectBadRequest(caller(investorId).recordStockSplit(CRWD_SPLIT), /already recorded/);
    expect(await caller(investorId).corporateActions()).toHaveLength(1);
  });

  it("rejects invalid ratios at the API (zod) and at the DB (CHECK), and a 1:1 non-split", async () => {
    for (const bad of [{ ratioNumerator: 0 }, { ratioDenominator: 0 }, { ratioNumerator: -4 }, { ratioNumerator: 2.5 }]) {
      const err = await caller(investorId).recordStockSplit({ ...CRWD_SPLIT, ticker: "BADR", ...bad }).catch((e) => e);
      expect(err, JSON.stringify(bad)).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code, JSON.stringify(bad)).toBe("BAD_REQUEST");
    }
    await expectBadRequest(caller(investorId).recordStockSplit({ ...CRWD_SPLIT, ticker: "ONE", ratioNumerator: 1, ratioDenominator: 1 }), /1:1/);
    const dbErr = await insertCorporateAction(db, { investorId, ticker: "DBCHK", kind: "stock_split", effectiveDate: new Date("2026-01-01T00:00:00Z"), ratioNumerator: 0, ratioDenominator: 1, source: "user_declared", evidence: "x" }).catch((e) => e);
    const cause = (dbErr as { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(cause).toMatchObject({ code: "23514", constraint_name: "corporate_actions_ratio_positive" }); // CHECK violation, not a 500 path
    expect((await caller(investorId).corporateActions()).map((a) => a.ticker)).toEqual(["CRWD"]);
  });

  it("without explicit confirmation the record is refused", async () => {
    const err = await caller(investorId).recordStockSplit({ ...CRWD_SPLIT, ticker: "NOCONF", confirmed: false as unknown as true }).catch((e) => e);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });

  it("ownership isolation: another investor sees no splits and cannot make the first investor's list grow", async () => {
    expect(await caller(foreignInvestorId).corporateActions()).toEqual([]);
    await caller(foreignInvestorId).recordStockSplit({ ...CRWD_SPLIT, ticker: "ZZZF" });
    expect((await caller(investorId).corporateActions()).map((a) => a.ticker)).toEqual(["CRWD"]);
    expect((await listCorporateActionsForInvestor(db, foreignInvestorId)).map((a) => a.ticker)).toEqual(["ZZZF"]);
    expect(await listCorporateActionsForInvestor(db, investorId, new Date("2026-07-01T00:00:00Z"))).toEqual([]); // asOfDate cutoff
    expect(await listCorporateActionsForInvestor(db, investorId, new Date("2026-07-02T00:00:00Z"))).toHaveLength(1);
  });
});

describe("the recorded split reaches every consumer through the one wrapper", () => {
  it("import preview no longer reports the post-split CRWD sale as exceeding holdings", async () => {
    const preview = await caller(investorId).validate({ csvContent: CRWD_CSV, mapping });
    expect(preview.tickersNeedingOpeningState).toEqual([]);
    expect(preview.reconciliation.counts).toMatchObject({ new: 2, exact_duplicate: 0 });
    // and the foreign investor (no CRWD split) still sees the warning for the same file
    expect((await caller(foreignInvestorId).validate({ csvContent: CRWD_CSV, mapping })).tickersNeedingOpeningState).toEqual(["CRWD"]);
  });

  it("after importing the CRWD rows, computePositionsForInvestor applies the split: exact close, true sufficientHoldings, +77.2%, one episode; point-in-time before the split is pre-split", async () => {
    const result = await caller(investorId).confirmImport({ csvContent: CRWD_CSV, mapping, filename: "crwd.csv" });
    expect(result.importedCount).toBe(2);
    const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, investorId));
    expect(rows.map((r) => [r.transactionType, r.quantity]).sort()).toEqual([["buy", "0.7383"], ["sell", "2.9532"]]); // original rows, never rewritten

    const now = await computePositionsForInvestor(db, investorId);
    expect(now.positions.filter((p) => p.ticker === "CRWD")).toEqual([]);
    expect(now.warnings).toEqual([]);
    const trace = now.sellTrace.find((s) => s.ticker === "CRWD")!;
    expect(trace.sufficientHoldings).toBe(true);
    expect(trace.realizedPnlPercent).toBeCloseTo(((187.84 - 105.975) / 105.975) * 100, 6);
    const buyId = rows.find((r) => r.transactionType === "buy")!.id;
    const sellId = rows.find((r) => r.transactionType === "sell")!.id;
    expect(now.episodeKeyByTransactionId.get(buyId)).toBe("CRWD#1");
    expect(now.episodeKeyByTransactionId.get(sellId)).toBe("CRWD#1");

    const preSplit = await computePositionsForInvestor(db, investorId, new Date("2026-07-01T00:00:00Z"));
    expect(preSplit.positions.find((p) => p.ticker === "CRWD")).toMatchObject({ quantity: 0.7383, costBasisPerShare: 423.9 });
    const onSplit = await computePositionsForInvestor(db, investorId, new Date("2026-07-02T00:00:00Z"));
    expect(onSplit.positions.find((p) => p.ticker === "CRWD")!.quantity).toBeCloseTo(2.9532, 10);
    expect(onSplit.positions.find((p) => p.ticker === "CRWD")!.costBasisPerShare).toBeCloseTo(105.975, 10);

    // The frozen Decision Independence context is built from the same wrapper: one case.
    const context = await loadIndependenceContext(db, investorId, []);
    expect(context.episodeKeyByTransactionId.get(buyId)).toBe("CRWD#1");
    expect(context.episodeKeyByTransactionId.get(sellId)).toBe("CRWD#1");
  });
});

describe("tax_refund end to end", () => {
  const REFUND_CSV = csvOf("2026-09-01,,tax refund,,,26.65,", "2026-09-01,,זיכוי מס,,,10.00,");
  it("imports as a cash-in row with no ticker, re-reconciles as an exact duplicate (idempotent), and only moves cash", async () => {
    const preview = await caller(investorId).validate({ csvContent: REFUND_CSV, mapping });
    expect(preview.invalidRows).toEqual([]);
    expect(preview.reconciliation.rows.map((r) => [r.incoming.transactionType, r.incoming.ticker, r.incoming.amount, r.class])).toEqual([
      ["tax_refund", null, "26.65", "new"],
      ["tax_refund", null, "10", "new"],
    ]);
    const first = await caller(investorId).confirmImport({ csvContent: REFUND_CSV, mapping, filename: "refund.csv" });
    expect(first.importedCount).toBe(2);
    const persisted = await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, investorId));
    const refunds = persisted.filter((r) => r.transactionType === "tax_refund");
    expect(refunds.map((r) => [r.ticker, r.amount]).sort()).toEqual([[null, "10"], [null, "26.65"]]);

    const again = await caller(investorId).validate({ csvContent: REFUND_CSV, mapping });
    expect(again.reconciliation.counts).toMatchObject({ new: 0, exact_duplicate: 2 });
    const second = await caller(investorId).confirmImport({ csvContent: REFUND_CSV, mapping, filename: "refund-again.csv" });
    expect(second.importedCount).toBe(0);
    expect((await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, investorId))).length).toBe(persisted.length);

    const state = await computePositionsForInvestor(db, investorId);
    // the CRWD rows carried no Amount column, so their cash effect is q×p exactly as validate.ts computes it
    expect(state.cash).toBeCloseTo(-(0.7383 * 423.9) + 2.9532 * 187.84 + 26.65 + 10, 6);
    expect(state.episodeKeyByTransactionId.has(refunds[0]!.id)).toBe(false);
    const h = await caller(investorId).history();
    expect(h.latestTransactionDate!.toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});
