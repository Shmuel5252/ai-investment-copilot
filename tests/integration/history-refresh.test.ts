// History Refresh V1 — production-path tests through the REAL import
// router (createCaller), repositories and Postgres. No AI is involved in
// any import path, so nothing is mocked. Runs only against the authorized
// test database (tests/support).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { importRouter } from "@/server/routers/import";
import { computePositionsForInvestor } from "@/lib/portfolio/compute-for-investor";
import { deriveEpisodeJournal } from "@/lib/portfolio/episodes";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import { listTransactionsForInvestor } from "@/db/repositories/portfolio";
import { insertInterviewAnswer, insertInterviewSession } from "@/db/repositories/interview";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });
const caller = (investorId: string) => importRouter.createCaller({ session: { investorId } } as never);

const mapping = { date: "Date", ticker: "Symbol", type: "Action", quantity: "Qty", price: "Price", commission: "Commission" };
const mappingWithAmount = { ...mapping, amount: "Amount" };
const HEADER = "Date,Symbol,Action,Qty,Price,Commission";
const csvOf = (...lines: string[]) => [HEADER, ...lines].join("\n");
const csvWithAmountOf = (...lines: string[]) => [HEADER + ",Amount", ...lines].join("\n");

// The broker's version of the four real August manual rows (same trades,
// commission on the file side), plus genuinely new September rows.
const AUG_CSV_LINES = [
  "2026-08-05,MP,Buy,20.6521,48.42,1.5",
  "2026-08-24,MP,Sell,12.1317,57.62,1.5",
  "2026-08-28,MRVL,Buy,4.5419,220.17,1.5",
  "2026-08-28,MP,Sell,8.5204,59.4,1.5",
];
const SEP_CSV_LINES = ["2026-09-08,AVGO,Buy,1.4,357.9,1.5", "2026-09-10,AVGO,Buy,1.4,357.9,1.5"]; // two identical fills — both real

let investorId: string;
let foreignInvestorId: string;

beforeAll(async () => {
  investorId = await mkInvestor(db, "history-refresh");
  foreignInvestorId = await mkInvestor(db, "history-refresh-foreign");
});

afterAll(async () => {
  await client.end();
});

const countRows = async (id: string) =>
  (await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, id))).length;
const batchFor = (id: string, filename: string) =>
  db.query.importBatches.findFirst({ where: (b, { and, eq }) => and(eq(b.investorId, id), eq(b.filename, filename)) });
// Resolutions exactly as the UI builds them: bound to the previewed row's identity.
type Preview = Awaited<ReturnType<ReturnType<typeof caller>["validate"]>>;
const resolve = (preview: Preview, key: string, action: "same" | "separate", existingTransactionId?: string) => ({
  clientRowKey: key,
  identityKey: preview.reconciliation.rows.find((r) => r.clientRowKey === key)!.identityKey,
  action,
  existingTransactionId,
});
const expectBadRequest = async (p: Promise<unknown>, pattern?: RegExp) => {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("BAD_REQUEST");
  if (pattern) expect((err as TRPCError).message).toMatch(pattern);
};

describe("CSV import — idempotent overlapping imports", () => {
  const JAN = csvOf("2026-01-07,AAPL,Buy,10,100,1", "2026-02-01,AAPL,Sell,4,150,1", "2026-02-01,AAPL,Sell,4,150,1");

  it("the same file three times: the first import inserts every row (identical repeats included), later ones insert zero and record 0-row batches", async () => {
    const preview = await caller(investorId).validate({ csvContent: JAN, mapping });
    expect(preview.reconciliation.counts).toEqual({ new: 3, exact_duplicate: 0, probable_manual_match: 0, ambiguous: 0, requiresResolution: 0 });

    const first = await caller(investorId).confirmImport({ csvContent: JAN, mapping, filename: "jan.csv" });
    expect(first).toMatchObject({ importedCount: 3, skippedExactCount: 0, skippedSameCount: 0, separateCount: 0 });
    expect(await countRows(investorId)).toBe(3);

    for (const filename of ["jan-again.csv", "jan-third.csv"]) {
      const again = await caller(investorId).validate({ csvContent: JAN, mapping });
      expect(again.reconciliation.counts).toEqual({ new: 0, exact_duplicate: 3, probable_manual_match: 0, ambiguous: 0, requiresResolution: 0 });
      const result = await caller(investorId).confirmImport({ csvContent: JAN, mapping, filename });
      expect(result).toMatchObject({ importedCount: 0, skippedExactCount: 3 });
      expect(await countRows(investorId)).toBe(3);
      expect(await batchFor(investorId, filename)).toMatchObject({ rowCount: 0, status: "completed" });
    }
    expect((await batchFor(investorId, "jan.csv"))!.rowCount).toBe(3);
    const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.importBatchId, first.batchId));
    expect(rows).toHaveLength(3); // every inserted row carries the batch created in the same transaction
  });

  it("identical re-import leaves every downstream derived state byte-identical (positions, episode keys, journal)", async () => {
    const snapshot = async () => {
      const portfolio = await computePositionsForInvestor(db, investorId);
      const txns = await listTransactionsForInvestor(db, investorId);
      const journal = deriveEpisodeJournal(
        txns.map((t) => ({ id: t.id, ticker: t.ticker, transactionType: t.transactionType, quantity: t.quantity === null ? null : Number(t.quantity), price: t.price === null ? null : Number(t.price), amount: Number(t.amount), transactionDate: t.transactionDate, intraDayOrder: t.intraDayOrder })),
        portfolio,
        []
      );
      return JSON.stringify({ positions: portfolio.positions, cash: portfolio.cash, sellTrace: portfolio.sellTrace, keys: [...portfolio.episodeKeyByTransactionId.entries()].sort(), journal: journal.episodes.map((e) => [e.key, e.transactions.map((t) => t.id)]) });
    };
    const before = await snapshot();
    await caller(investorId).confirmImport({ csvContent: JAN, mapping, filename: "jan-fourth.csv" });
    expect(await snapshot()).toBe(before);
  });

  it("an overlapping file inserts only the genuinely new rows; a third identical fill beyond the persisted two is new (multiset)", async () => {
    const overlapping = csvOf(
      "2026-01-07,AAPL,Buy,10,100,1", // already there
      "2026-02-01,AAPL,Sell,4,150,1", // already there ×2
      "2026-02-01,AAPL,Sell,4,150,1",
      "2026-02-01,AAPL,Sell,4,150,1", // third fill → new
      "2026-04-01,MSFT,Buy,2,300,1" // new
    );
    const preview = await caller(investorId).validate({ csvContent: overlapping, mapping });
    expect(preview.reconciliation.counts).toMatchObject({ new: 2, exact_duplicate: 3, requiresResolution: 0 });
    const result = await caller(investorId).confirmImport({ csvContent: overlapping, mapping, filename: "overlap.csv" });
    expect(result).toMatchObject({ importedCount: 2, skippedExactCount: 3 });
    expect(await countRows(investorId)).toBe(5);
    const sells = await db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.investorId, investorId), eq(schema.transactions.transactionType, "sell")));
    expect(sells).toHaveLength(3);
    // The ordering contract still applies to what was inserted: three same-day sells, all order-unknown, never mixed.
    expect(sells.every((s) => s.intraDayOrder === null && s.orderUnknownReason !== null)).toBe(true);
  });

  it("ticker-less rows (fees) are reconciled in the preview and at confirm like any other row", async () => {
    const file = csvWithAmountOf("2026-03-01,,Fee,,,,2.5", "2026-03-01,,Fee,,,,2.5");
    const p1 = await caller(investorId).validate({ csvContent: file, mapping: mappingWithAmount });
    expect(p1.reconciliation.rows.map((r) => [r.incoming.ticker, r.incoming.amount, r.class])).toEqual([[null, "-2.5", "new"], [null, "-2.5", "new"]]);
    await caller(investorId).confirmImport({ csvContent: file, mapping: mappingWithAmount, filename: "fees.csv" });
    const p2 = await caller(investorId).validate({ csvContent: file, mapping: mappingWithAmount });
    expect(p2.reconciliation.counts).toMatchObject({ new: 0, exact_duplicate: 2 });
  });

  it("an ordering failure after reconciliation rolls back everything — no rows, no orphan batch", async () => {
    // A declared order on a row that collides with a pre-existing same-day row is refused by the ordering contract.
    const file = csvOf("2026-02-01,AAPL,Buy,1,151,1");
    const before = await countRows(investorId);
    await expectBadRequest(
      caller(investorId).confirmImport({ csvContent: file, mapping, filename: "order-fail.csv", rowOrderDeclarations: { "0": 1 } }),
      /collides with an existing transaction/
    );
    expect(await countRows(investorId)).toBe(before);
    expect(await batchFor(investorId, "order-fail.csv")).toBeUndefined();
  });

  it("two concurrent confirmations of the same overlapping file → exactly one logical set of new rows", async () => {
    const file = csvWithAmountOf("2026-05-05,NVDA,Buy,1,500,1,", "2026-05-05,NVDA,Buy,1,500,1,", "2026-05-06,,Fee,,,,2.5");
    const before = await countRows(investorId);
    const results = await Promise.all([
      caller(investorId).confirmImport({ csvContent: file, mapping: mappingWithAmount, filename: "race-a.csv" }),
      caller(investorId).confirmImport({ csvContent: file, mapping: mappingWithAmount, filename: "race-b.csv" }),
    ]);
    expect(results.map((r) => r.importedCount).sort()).toEqual([0, 3]);
    expect(await countRows(investorId)).toBe(before + 3);
    const fees = await db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.investorId, investorId), eq(schema.transactions.transactionDate, new Date("2026-05-06T00:00:00Z"))));
    expect(fees).toHaveLength(1); // ticker-less rows are reconciled under a lock too
  });

  it("two concurrent batches sharing some but not all lock keys both complete (sorted acquisition, no deadlock) with the right rows", async () => {
    const a = csvOf("2026-07-01,ORCL,Buy,1,100,1", "2026-07-02,ORCL,Buy,1,100,1"); // keys K1, K2
    const b = csvOf("2026-07-02,ORCL,Buy,1,100,1", "2026-07-03,ORCL,Buy,1,100,1"); // keys K2, K3 — K2 identical in both
    const before = await countRows(investorId);
    const [ra, rb] = await Promise.all([
      caller(investorId).confirmImport({ csvContent: a, mapping, filename: "shared-a.csv" }),
      caller(investorId).confirmImport({ csvContent: b, mapping, filename: "shared-b.csv" }),
    ]);
    expect(ra.importedCount + rb.importedCount).toBe(3); // K2 inserted exactly once, whichever batch won it
    expect(await countRows(investorId)).toBe(before + 3);
  });
});

describe("manual-vs-CSV reconciliation through the router", () => {
  let manualIds: Record<string, string>;
  const FILE = csvOf(...AUG_CSV_LINES, ...SEP_CSV_LINES);
  const sameAll = (preview: Preview, id: (key: string) => string | undefined) => [
    resolve(preview, "0", "same", id("MP-buy-2026-08-05")),
    resolve(preview, "1", "same", id("MP-sell-2026-08-24")),
    resolve(preview, "2", "same", id("MRVL-buy-2026-08-28")),
    resolve(preview, "3", "same", id("MP-sell-2026-08-28")),
  ];

  it("manual rows entered first, then the broker file: the four August rows are PROBABLE matches and the import is refused until resolved", async () => {
    const manual = await caller(investorId).confirmManualEntry({
      rows: [
        { ticker: "MP", transactionType: "buy", quantity: 20.6521, price: 48.42, transactionDate: new Date("2026-08-05T00:00:00Z") },
        { ticker: "MP", transactionType: "sell", quantity: 12.1317, price: 57.62, transactionDate: new Date("2026-08-24T00:00:00Z") },
        { ticker: "MRVL", transactionType: "buy", quantity: 4.5419, price: 220.17, transactionDate: new Date("2026-08-28T00:00:00Z") },
        { ticker: "MP", transactionType: "sell", quantity: 8.5204, price: 59.4, transactionDate: new Date("2026-08-28T00:00:00Z") },
      ],
    });
    expect(manual.transactions).toHaveLength(4);
    manualIds = Object.fromEntries(manual.transactions.map((t) => [`${t.ticker}-${t.transactionType}-${t.transactionDate.toISOString().slice(0, 10)}`, t.id]));

    const preview = await caller(investorId).validate({ csvContent: FILE, mapping });
    expect(preview.reconciliation.counts).toEqual({ new: 2, exact_duplicate: 0, probable_manual_match: 4, ambiguous: 0, requiresResolution: 4 });
    const mpBuy = preview.reconciliation.rows.find((r) => r.clientRowKey === "0")!;
    expect(mpBuy.candidates).toHaveLength(1);
    expect(mpBuy.candidates[0]).toMatchObject({ id: manualIds["MP-buy-2026-08-05"], source: "manual_entry", quantity: "20.6521", price: "48.42" });

    const before = await countRows(investorId);
    await expectBadRequest(caller(investorId).confirmImport({ csvContent: FILE, mapping, filename: "aug.csv" }), /entered manually/);
    expect(await countRows(investorId)).toBe(before); // nothing inserted, nothing partial
    expect(await batchFor(investorId, "aug.csv")).toBeUndefined(); // no orphan batch: it is created inside the same transaction as the rows
  });

  it("stale resolutions are rejected: a foreign transaction id, an answer for a row that needs none, an unresolved row, and an answer reused for a changed file", async () => {
    const preview = await caller(investorId).validate({ csvContent: FILE, mapping });
    const foreignRow = (await caller(foreignInvestorId).confirmManualEntry({
      rows: [{ ticker: "MP", transactionType: "buy", quantity: 20.6521, price: 48.42, transactionDate: new Date("2026-08-05T00:00:00Z") }],
    })).transactions[0]!;
    const before = await countRows(investorId);
    const attempts: Array<[string, ReturnType<typeof resolve>[], string?]> = [
      ["foreign id", sameAll(preview, (k) => (k === "MP-buy-2026-08-05" ? foreignRow.id : manualIds[k]))],
      ["row 4 needs none", [...sameAll(preview, (k) => manualIds[k]), resolve(preview, "4", "separate")]],
      ["row 0 unresolved", sameAll(preview, (k) => manualIds[k]).slice(1)],
    ];
    for (const [, reconciliationResolutions] of attempts) {
      await expectBadRequest(caller(investorId).confirmImport({ csvContent: FILE, mapping, filename: "aug.csv", reconciliationResolutions }));
    }
    // The file changed after the preview: row 0 is now a DIFFERENT MP buy (rounded quantity) that still matches the same manual
    // candidate. The answers given for the previewed file must not carry over just because the position is the same.
    const changed = csvOf("2026-08-05,MP,Buy,20.65,48.42,1.5", ...AUG_CSV_LINES.slice(1), ...SEP_CSV_LINES);
    const changedPreview = await caller(investorId).validate({ csvContent: changed, mapping });
    expect(changedPreview.reconciliation.rows[0]!.class).toBe("probable_manual_match");
    for (const action of ["same", "separate"] as const) {
      const reused = [
        { ...resolve(preview, "0", action, action === "same" ? manualIds["MP-buy-2026-08-05"] : undefined) },
        ...sameAll(preview, (k) => manualIds[k]).slice(1),
      ];
      await expectBadRequest(
        caller(investorId).confirmImport({ csvContent: changed, mapping, filename: "aug-changed.csv", reconciliationResolutions: reused }),
        /not the row this answer was given for/
      );
    }
    expect(await countRows(investorId)).toBe(before);
    expect(await batchFor(investorId, "aug-changed.csv")).toBeUndefined();
  });

  it("resolved: three 'same' keep the manual rows and skip the CSV rows; one 'separate' inserts alongside its manual twin; the new rows land", async () => {
    const preview = await caller(investorId).validate({ csvContent: FILE, mapping });
    const before = await countRows(investorId);
    const result = await caller(investorId).confirmImport({
      csvContent: FILE,
      mapping,
      filename: "aug.csv",
      reconciliationResolutions: [...sameAll(preview, (k) => manualIds[k]).slice(0, 3), resolve(preview, "3", "separate")],
    });
    expect(result).toMatchObject({ importedCount: 3, skippedExactCount: 0, skippedSameCount: 3, separateCount: 1 });
    expect(await countRows(investorId)).toBe(before + 3);

    // The manual rows are untouched (never replaced/edited).
    for (const id of Object.values(manualIds)) {
      const row = await db.query.transactions.findFirst({ where: (t, { eq }) => eq(t.id, id) });
      expect(row).toMatchObject({ source: "manual_entry", importBatchId: null });
    }
    // The 'separate' MP sell on 08-28 now sits beside its manual twin — same-day ordering contract applied to both.
    const mpSells0828 = await db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.investorId, investorId), eq(schema.transactions.ticker, "MP"), eq(schema.transactions.transactionDate, new Date("2026-08-28T00:00:00Z"))));
    expect(mpSells0828).toHaveLength(2);
    expect(mpSells0828.every((s) => s.orderUnknownReason === "never_recorded")).toBe(true);

    // Re-importing the same file now: the three 'same' rows are still probable matches (the manual rows remain), the separate one and the September rows are exact duplicates.
    const again = await caller(investorId).validate({ csvContent: FILE, mapping });
    expect(again.reconciliation.counts).toMatchObject({ exact_duplicate: 3, probable_manual_match: 3, new: 0 });
  });

  it("concurrent CSV import vs manual entry of the same trade, and two concurrent identical manual entries: exactly one row survives, the loser is refused", async () => {
    const manualRow = { ticker: "AMD", transactionType: "buy" as const, quantity: 3, price: 120, transactionDate: new Date("2026-06-15T00:00:00Z") };
    const file = csvOf("2026-06-15,AMD,Buy,3,120,1"); // commission-adjusted amount → near, not exact, to the manual row
    const before = await countRows(investorId);
    const [c, m] = await Promise.allSettled([
      caller(investorId).confirmImport({ csvContent: file, mapping, filename: "amd.csv" }),
      caller(investorId).confirmManualEntry({ rows: [manualRow] }),
    ]);
    expect([c.status, m.status].sort()).toEqual(["fulfilled", "rejected"]);
    const loser = [c, m].find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect((loser.reason as TRPCError).code).toBe("BAD_REQUEST");
    expect(await countRows(investorId)).toBe(before + 1);

    const twin = { ticker: "INTC", transactionType: "buy" as const, quantity: 5, price: 30, transactionDate: new Date("2026-06-16T00:00:00Z") };
    const [x, y] = await Promise.allSettled([
      caller(investorId).confirmManualEntry({ rows: [twin] }),
      caller(investorId).confirmManualEntry({ rows: [twin] }),
    ]);
    expect([x.status, y.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(((([x, y].find((r) => r.status === "rejected") as PromiseRejectedResult).reason) as TRPCError).message).toMatch(/identical/);
    expect(await countRows(investorId)).toBe(before + 2);
  });
});

describe("manual entry protection", () => {
  it("an exact duplicate manual entry is refused without an explicit override, then saved once with it; a 'same' answer skips it", async () => {
    const row = { ticker: "TSLA", transactionType: "buy" as const, quantity: 2, price: 200, transactionDate: new Date("2026-06-01T00:00:00Z") };
    await caller(investorId).confirmManualEntry({ rows: [row] });

    const check = await caller(investorId).checkManualEntry({ rows: [row, row] });
    expect(check.reconciliation.rows.map((r) => [r.class, r.withinBatch, r.requiresResolution])).toEqual([
      ["exact_duplicate", false, true],
      ["exact_duplicate", true, true],
    ]);

    const before = await countRows(investorId);
    await expectBadRequest(caller(investorId).confirmManualEntry({ rows: [row] }), /identical/);
    expect(await countRows(investorId)).toBe(before);

    const key = (i: string) => check.reconciliation.rows.find((r) => r.clientRowKey === i)!.identityKey;
    const saved = await caller(investorId).confirmManualEntry({
      rows: [row, row],
      resolutions: [
        { clientRowKey: "0", identityKey: key("0"), action: "separate" }, // intentionally a second identical trade
        { clientRowKey: "1", identityKey: key("1"), action: "same" }, // this one was a form slip
      ],
    });
    expect(saved.transactions).toHaveLength(1);
    expect(saved.skippedCount).toBe(1);
    expect(await countRows(investorId)).toBe(before + 1);
  });

  it("a manual row near an already-imported CSV row is a probable match and must be resolved", async () => {
    const check = await caller(investorId).checkManualEntry({
      rows: [{ ticker: "AAPL", transactionType: "buy", quantity: 10, price: 100, transactionDate: new Date("2026-01-07T00:00:00Z") }],
    });
    // amount differs (the CSV row carried a $1 commission), so it is not exact — but quantity/price/date match
    expect(check.reconciliation.rows[0]).toMatchObject({ class: "probable_manual_match", requiresResolution: true });
    expect(check.reconciliation.rows[0]!.candidates[0]).toMatchObject({ source: "csv_import" });
  });
});

describe("ownership, freshness and downstream non-regression", () => {
  it("the foreign investor's history is never scanned or matched, and their freshness is their own", async () => {
    const preview = await caller(foreignInvestorId).validate({ csvContent: csvOf(...AUG_CSV_LINES), mapping });
    // The foreign investor entered only the MP buy manually; the other three rows are new to them.
    expect(preview.reconciliation.counts).toMatchObject({ probable_manual_match: 1, new: 3 });
    expect(preview.reconciliation.rows[0]!.candidates.every((c) => c.id !== undefined)).toBe(true);
    const ownIds = new Set((await db.select().from(schema.transactions).where(eq(schema.transactions.investorId, foreignInvestorId))).map((t) => t.id));
    expect(preview.reconciliation.rows.flatMap((r) => r.candidates).every((c) => ownIds.has(c.id))).toBe(true);
    const h = await caller(foreignInvestorId).history();
    expect(h.transactionCount).toBe(1);
    expect(h.latestBatch).toBeNull();
  });

  it("history freshness reports the latest persisted date, age, batch window and manual reach — nothing more", async () => {
    const h = await caller(investorId).history();
    expect(h.latestTransactionDate!.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(h.ageDays).toBe(Math.floor((Date.now() - Date.parse("2026-09-10T00:00:00Z")) / 86_400_000));
    // The latest batch is whichever import committed last (the CSV-vs-manual race above may have gone either way) — pin it to the DB's own ordering.
    const newest = (await db.query.importBatches.findMany({ where: (b, { eq }) => eq(b.investorId, investorId), orderBy: (b, { desc }) => desc(b.uploadedAt) }))[0]!;
    expect(h.latestBatch).toMatchObject({ id: newest.id, filename: newest.filename, rowCount: newest.rowCount });
    const window = await db.select().from(schema.transactions).where(eq(schema.transactions.importBatchId, newest.id));
    if (window.length > 0) {
      expect(h.latestBatch!.windowStart!.getTime()).toBe(Math.min(...window.map((t) => t.transactionDate.getTime())));
      expect(h.latestBatch!.windowEnd!.getTime()).toBe(Math.max(...window.map((t) => t.transactionDate.getTime())));
    } else {
      expect(h.latestBatch!.windowStart).toBeNull();
    }
    expect(h.manualEntry.latestDate!.toISOString().slice(0, 10)).toBe("2026-08-28");
    expect(h.manualEntry.count).toBeGreaterThanOrEqual(6);
  });

  it("a future-dated transaction never yields a negative age", async () => {
    const future = await mkInvestor(db, "history-refresh-future");
    await caller(future).confirmManualEntry({ rows: [{ ticker: "FUT", transactionType: "buy", quantity: 1, price: 1, transactionDate: new Date(Date.now() + 5 * 86_400_000) }] });
    expect((await caller(future).history()).ageDays).toBe(0);
    const empty = await mkInvestor(db, "history-refresh-empty");
    expect(await caller(empty).history()).toMatchObject({ latestTransactionDate: null, ageDays: null, transactionCount: 0, latestBatch: null, manualEntry: { count: 0, latestDate: null } });
  });

  it("downstream: positions, the derived episode journal and the frozen independence resolver see exactly the persisted rows", async () => {
    const portfolio = await computePositionsForInvestor(db, investorId);
    const txns = await listTransactionsForInvestor(db, investorId);
    const journal = deriveEpisodeJournal(
      txns.map((t) => ({ id: t.id, ticker: t.ticker, transactionType: t.transactionType, quantity: t.quantity === null ? null : Number(t.quantity), price: t.price === null ? null : Number(t.price), amount: Number(t.amount), transactionDate: t.transactionDate, intraDayOrder: t.intraDayOrder })),
      portfolio,
      []
    );
    const mrvl = portfolio.positions.find((p) => p.ticker === "MRVL")!;
    expect(mrvl.quantity).toBeCloseTo(4.5419, 6); // ONE MRVL buy, not two — the CSV twin was skipped
    const avgo = portfolio.positions.find((p) => p.ticker === "AVGO")!;
    expect(avgo.quantity).toBeCloseTo(2.8, 6); // both identical fills are real
    const mp = journal.episodes.filter((e) => e.ticker === "MP");
    expect(mp).toHaveLength(1);
    expect(mp[0]!.transactions).toHaveLength(4); // buy, sell, sell + the one 'separate' sell

    // Rationale anchored to the manual MP buy still resolves to that one episode; the resolver groups by the same map.
    const session = await insertInterviewSession(db, { investorId, origin: "user_initiated" });
    const mpBuyId = txns.find((t) => t.ticker === "MP" && t.transactionType === "buy")!.id;
    const answer = await insertInterviewAnswer(db, { interviewSessionId: session.id, transactionId: mpBuyId, questionText: "q", answerText: "MP rationale" });
    const resolver = await loadIndependenceResolver(db, investorId);
    const resolved = resolver.resolve([{ interviewAnswerId: answer.id, stance: "supporting" }]);
    expect(resolved.groups).toHaveLength(1);
    expect(resolved.confidenceInputs).toEqual({ supporting: 1, contradicting: 0 });
  });
});
