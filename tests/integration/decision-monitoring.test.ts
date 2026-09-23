// Open-Decision Monitoring V1 — production paths against the authorized
// test database only (tests/support): migration 0013, the write-once
// horizon (repository + router, ownership, concurrency), the explicit
// creation choice (router input validation, no AI reached) and the
// decisions.attention query over fixtures shaped like the real SNDK /
// AVGO / LLY decisions. No AI, no market data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { decisionsRouter } from "@/server/routers/decisions";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis, setReviewByDateIfUnset } from "@/db/repositories/decisions";
import { loadDecisionAttention } from "@/lib/monitoring/load-decision-attention";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });
const caller = (investorId: string) => decisionsRouter.createCaller({ session: { investorId } } as never);
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);

let investorId: string;
let foreignInvestorId: string;
let strategyVersionId: string;
let marketContextId: string;

interface DecisionFixture {
  ticker: string;
  decisionType: "BUY" | "PASS" | "HOLD" | "ADD" | "REDUCE" | "SELL";
  decisionDate: Date;
  snapshotCreatedAt?: Date;
  frozenPositions?: { ticker: string; quantity: number }[];
  predictions?: { status: "pending" | "confirmed" | "refuted" | "inconclusive"; checkableByDate: Date | null }[];
  reviewDates?: Date[];
  reviewByDate?: Date | null;
}

async function mkDecision(owner: string, f: DecisionFixture) {
  const [investmentCase] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker: f.ticker }).returning();
  const decision = await insertDecision(db, { investorId: owner, investmentCaseId: investmentCase!.id, ticker: f.ticker, decisionType: f.decisionType, decisionDate: f.decisionDate, reviewByDate: f.reviewByDate ?? null });
  const thesis = await insertThesis(db, { thesisText: "fixture thesis" });
  await insertDecisionSnapshot(
    db,
    {
      decisionId: decision.id,
      priceAtDecision: "100",
      userReasoningText: "fixture",
      portfolioStateJson: { cash: 0, positions: f.frozenPositions ?? [] },
      marketContextId,
      strategyVersionId,
      thesisId: thesis.id,
      investmentCaseSnapshotJson: {},
      createdAt: f.snapshotCreatedAt ?? f.decisionDate,
    },
    []
  );
  for (const p of f.predictions ?? []) {
    await insertPrediction(db, { thesisId: thesis.id, claimText: "fixture claim", status: p.status, checkableByDate: p.checkableByDate });
  }
  for (const reviewDate of f.reviewDates ?? []) {
    await db.insert(schema.decisionReviews).values({ decisionId: decision.id, reviewDate, narrativeSummaryText: "fixture", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {} });
  }
  return decision;
}

async function mkTrade(owner: string, ticker: string, type: "buy" | "sell", date: string, createdAt: string, qty = "1", price = "10") {
  const [row] = await db
    .insert(schema.transactions)
    .values({ investorId: owner, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`, transactionDate: at(date), createdAt: at(createdAt), source: "manual_entry" })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  investorId = await mkInvestor(db, "monitoring");
  foreignInvestorId = await mkInvestor(db, "monitoring-foreign");
  const [sv] = await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "fixture" }).returning();
  strategyVersionId = sv!.id;
  const [mc] = await db.insert(schema.marketContexts).values({ source: "test" }).returning();
  marketContextId = mc!.id;
});
afterAll(async () => {
  await client.end();
});

describe("migration 0013 on the scratch DB", () => {
  it("decisions.review_by_date exists, nullable timestamptz, and new rows default to NULL", async () => {
    const cols = await db.execute(`select data_type, is_nullable from information_schema.columns where table_name = 'decisions' and column_name = 'review_by_date'`);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "YES" });
    const d = await mkDecision(investorId, { ticker: "NULLD", decisionType: "HOLD", decisionDate: at("2026-06-01T09:00:00Z") });
    expect((await db.query.decisions.findFirst({ where: (x, { eq }) => eq(x.id, d.id) }))!.reviewByDate).toBeNull();
  });
});

describe("decisions.attention over the canonical real-data shapes", () => {
  let sndkId: string, avgoId: string, llyId: string;
  beforeAll(async () => {
    // LLY: reviewed twice, history known before, nothing after.
    llyId = (await mkDecision(investorId, { ticker: "LLY", decisionType: "BUY", decisionDate: at("2026-08-19T19:58:22Z"), predictions: [1, 2, 3].map(() => ({ status: "inconclusive" as const, checkableByDate: null })), reviewDates: [at("2026-09-06T16:24:03Z"), at("2026-09-07T04:09:15Z")] })).id;
    await mkTrade(investorId, "LLY", "buy", "2026-04-09", "2026-08-16T12:35:37Z", "0.6788", "957.47");
    await mkTrade(investorId, "LLY", "sell", "2026-05-12", "2026-08-16T12:35:37Z", "0.6788", "991.65");
    // SNDK: PASS, reviewed 09-06, three trades persisted 09-23.
    sndkId = (await mkDecision(investorId, { ticker: "SNDK", decisionType: "PASS", decisionDate: at("2026-08-20T14:07:46Z"), predictions: [{ status: "inconclusive", checkableByDate: null }], reviewDates: [at("2026-09-06T16:03:03Z")] })).id;
    await mkTrade(investorId, "SNDK", "buy", "2026-08-24", "2026-09-23T16:38:28Z", "0.5962", "1492.62");
    await mkTrade(investorId, "SNDK", "sell", "2026-09-02", "2026-09-23T16:38:28Z", "0.0974", "1539.65");
    await mkTrade(investorId, "SNDK", "sell", "2026-09-08", "2026-09-23T16:38:28Z", "0.1129", "1771.41");
    // AVGO: BUY 09-08, snapshot froze the June lot; the 08-05 sell and 09-02 buy entered on 09-23.
    avgoId = (await mkDecision(investorId, { ticker: "AVGO", decisionType: "BUY", decisionDate: at("2026-09-08T07:10:53Z"), snapshotCreatedAt: at("2026-09-08T07:10:53.802Z"), frozenPositions: [{ ticker: "AVGO", quantity: 1.2169 }], predictions: [1, 2, 3, 4].map(() => ({ status: "pending" as const, checkableByDate: null })) })).id;
    await mkTrade(investorId, "AVGO", "buy", "2026-06-18", "2026-08-16T12:35:37Z", "1.2169", "410.85");
    await mkTrade(investorId, "AVGO", "sell", "2026-08-05", "2026-09-23T16:38:28Z", "1.2169", "422.24");
    await mkTrade(investorId, "AVGO", "buy", "2026-09-02", "2026-09-23T16:38:28Z", "1.8121", "369.72");
    // a later ticker so history freshness reaches every decision
    await mkTrade(investorId, "MRVL", "sell", "2026-09-21", "2026-09-23T16:38:28Z");
    await mkTrade(investorId, "MRVL", "buy", "2026-09-01", "2026-09-23T16:38:28Z", "2");
  });

  it("SNDK → NEW_EXECUTION_AFTER_DECISION, AVGO → HISTORY_BACKFILLED, LLY → settled; ordering and counts are deterministic", async () => {
    const r = await caller(investorId).attention({ timeZone: "Asia/Jerusalem" });
    const byId = new Map(r.items.map((i) => [i.decisionId, i]));
    const sndk = byId.get(sndkId)!, avgo = byId.get(avgoId)!, lly = byId.get(llyId)!;
    expect(sndk.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(sndk.newExecutionAfterDecision.map((f) => [f.transactionType, f.transactionDate.toISOString().slice(0, 10)])).toEqual([["buy", "2026-08-24"], ["sell", "2026-09-02"], ["sell", "2026-09-08"]]);
    expect(sndk.baseline.kind).toBe("latest_review");
    expect(sndk.position).toMatchObject({ status: "ok", held: true, episodeKeys: ["SNDK#1"] });
    expect(sndk.position.quantity).toBeCloseTo(0.3859, 8);
    expect(avgo.reasons).toEqual(["HISTORY_BACKFILLED"]);
    expect(avgo.backfilled.map((f) => [f.transactionType, f.transactionDate.toISOString().slice(0, 10)])).toEqual([["sell", "2026-08-05"], ["buy", "2026-09-02"]]);
    expect(avgo.execution.knownBefore).toHaveLength(1);
    expect(avgo.execution.after).toEqual([]);
    expect(avgo.predictions).toMatchObject({ pending: 4, undated: 4, due: [] });
    expect(avgo.position).toMatchObject({ frozenHoldingQuantity: 1.2169, held: true, episodeKeys: ["AVGO#1", "AVGO#2"] });
    expect(lly).toMatchObject({ reasons: [], state: "settled" });
    expect(r.attention.map((i) => i.decisionId)).toEqual([sndkId, avgoId]); // same newest fact → decision date ascending
    expect(r.historyThrough!.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(r.portfolioStatus).toBe("ok");
    expect(r.attention.every((i) => i.reasons.every((x) => ["REVIEW_DUE", "PREDICTION_DUE", "NEW_EXECUTION_AFTER_DECISION", "HISTORY_BACKFILLED"].includes(x)))).toBe(true);
  });

  it("a decision recorded at 00:30 Jerusalem time with a trade dated that Jerusalem day: same-day in the investor's zone, no reason; an unknown zone is refused", async () => {
    const night = await mkInvestor(db, "monitoring-night");
    const d = await mkDecision(night, { ticker: "N", decisionType: "BUY", decisionDate: at("2026-09-07T21:30:00Z") });
    await mkTrade(night, "N", "buy", "2026-09-08", "2026-09-20T00:00:00Z");
    await mkTrade(night, "NX", "sell", "2026-09-21", "2026-09-20T00:00:00Z"); // another ticker: only moves history freshness
    const il = (await caller(night).attention({ timeZone: "Asia/Jerusalem" })).items.find((i) => i.decisionId === d.id)!;
    expect(il.execution.sameDay).toHaveLength(1);
    expect(il.reasons).toEqual([]);
    const utc = (await caller(night).attention({ timeZone: "UTC" })).items.find((i) => i.decisionId === d.id)!;
    expect(utc.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]); // what a server-side UTC day would have claimed
    const bad = await caller(night).attention({ timeZone: "Mars/Olympus" }).catch((e) => e);
    expect((bad as TRPCError).code).toBe("BAD_REQUEST");
    const missing = await caller(night).attention(undefined as never).catch((e) => e);
    expect((missing as TRPCError).code).toBe("BAD_REQUEST");
  });

  it("ownership: another investor sees none of it; the frozen snapshot is untouched", async () => {
    const foreign = await caller(foreignInvestorId).attention({ timeZone: "Asia/Jerusalem" });
    expect(foreign.items).toEqual([]);
    const snap = await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, avgoId) });
    expect(snap!.portfolioStateJson).toEqual({ cash: 0, positions: [{ ticker: "AVGO", quantity: 1.2169 }] });
  });

  it("fail closed: an accounting warning marks the position unavailable but keeps the raw facts; history that stops before a decision yields no execution reasons", async () => {
    const warned = await mkInvestor(db, "monitoring-warn");
    await mkDecision(warned, { ticker: "W", decisionType: "BUY", decisionDate: at("2026-08-01T09:00:00Z") });
    await mkTrade(warned, "W", "sell", "2026-08-10", "2026-09-20T00:00:00Z", "5"); // oversell → warning
    const r = await loadDecisionAttention(db, warned, "Asia/Jerusalem", at("2026-09-23T12:00:00Z"));
    expect(r.portfolioStatus).toBe("warnings");
    expect(r.items[0]!.position).toMatchObject({ status: "warnings", held: null, quantity: null });
    expect(r.items[0]!.reasons).toEqual(["NEW_EXECUTION_AFTER_DECISION"]);
    expect(r.items[0]!.newExecutionAfterDecision[0]!.episodeKey).toBeNull();

    const stale = await mkInvestor(db, "monitoring-stale");
    await mkDecision(stale, { ticker: "S", decisionType: "BUY", decisionDate: at("2026-09-10T09:00:00Z"), reviewByDate: at("2026-09-15") });
    await mkTrade(stale, "S", "buy", "2026-09-01", "2026-09-20T00:00:00Z");
    const s = await loadDecisionAttention(db, stale, "Asia/Jerusalem", at("2026-09-23T12:00:00Z"));
    expect(s.items[0]!.execution.status).toBe("history_before_decision");
    expect(s.items[0]!.reasons).toEqual(["REVIEW_DUE"]);
  });
});

describe("write-once legacy horizon", () => {
  it("NULL → date succeeds (normalized to 00:00Z) and is visible to attention; a second date and NULL are refused; before the decision date is refused", async () => {
    const d = await mkDecision(investorId, { ticker: "WO", decisionType: "BUY", decisionDate: at("2026-06-01T09:00:00Z") });
    const set = await caller(investorId).setReviewByDate({ decisionId: d.id, reviewByDate: new Date("2026-07-01T15:00:00Z") });
    expect(set.reviewByDate!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    const again = await caller(investorId).setReviewByDate({ decisionId: d.id, reviewByDate: new Date("2026-08-01") }).catch((e) => e);
    expect(again).toBeInstanceOf(TRPCError);
    expect((again as TRPCError).code).toBe("BAD_REQUEST");
    expect((again as TRPCError).message).toMatch(/only once/);
    const toNull = await caller(investorId).setReviewByDate({ decisionId: d.id, reviewByDate: null as unknown as Date }).catch((e) => e);
    expect((toNull as TRPCError).code).toBe("BAD_REQUEST");
    expect(await setReviewByDateIfUnset(db, { decisionId: d.id, investorId, reviewByDate: new Date("2026-09-01") })).toBeNull();
    expect((await db.query.decisions.findFirst({ where: (x, { eq }) => eq(x.id, d.id) }))!.reviewByDate!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    const item = (await caller(investorId).attention({ timeZone: "Asia/Jerusalem" })).items.find((i) => i.decisionId === d.id)!;
    expect(item.horizon).toMatchObject({ status: "due" });
    expect(item.reasons).toEqual(["REVIEW_DUE"]);

    const early = await mkDecision(investorId, { ticker: "WOE", decisionType: "BUY", decisionDate: at("2026-06-01T09:00:00Z") });
    const before = await caller(investorId).setReviewByDate({ decisionId: early.id, reviewByDate: new Date("2026-05-31") }).catch((e) => e);
    expect((before as TRPCError).message).toMatch(/before the decision date/);
  });

  it("ownership isolation: a foreign investor cannot set it (NOT_FOUND) and the repository predicate refuses too", async () => {
    const d = await mkDecision(investorId, { ticker: "WOF", decisionType: "BUY", decisionDate: at("2026-06-01T09:00:00Z") });
    const err = await caller(foreignInvestorId).setReviewByDate({ decisionId: d.id, reviewByDate: new Date("2026-07-01") }).catch((e) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(await setReviewByDateIfUnset(db, { decisionId: d.id, investorId: foreignInvestorId, reviewByDate: new Date("2026-07-01") })).toBeNull();
    expect((await db.query.decisions.findFirst({ where: (x, { eq }) => eq(x.id, d.id) }))!.reviewByDate).toBeNull();
  });

  it("concurrent writes: exactly one wins, the rest are translated BAD_REQUEST, one value persisted", async () => {
    const d = await mkDecision(investorId, { ticker: "WOC", decisionType: "BUY", decisionDate: at("2026-06-01T09:00:00Z") });
    const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 6, 1 + i)));
    const results = await Promise.allSettled(dates.map((reviewByDate) => caller(investorId).setReviewByDate({ decisionId: d.id, reviewByDate })));
    const won = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected" && (r.reason as TRPCError).code === "BAD_REQUEST");
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(7);
    const persisted = (await db.query.decisions.findFirst({ where: (x, { eq }) => eq(x.id, d.id) }))!.reviewByDate!;
    expect(dates.map((x) => x.getTime())).toContain(persisted.getTime());
    expect((won[0] as PromiseFulfilledResult<{ reviewByDate: Date | null }>).value.reviewByDate!.getTime()).toBe(persisted.getTime());
  });
});

describe("decisions.create — the explicit horizon choice (input validation runs before any AI/market call)", () => {
  const base = { caseId: "00000000-0000-4000-8000-000000000000", decisionType: "PASS" as const, reasoningText: "fixture" };
  it("a missing choice is rejected as validation (never mapped to 'none')", async () => {
    const err = await caller(investorId).create(base as never).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect((err as TRPCError).message).toMatch(/reviewHorizon/);
  });
  it("an explicit date choice and an explicit 'none' (PASS allowed) pass validation and reach the ownership check", async () => {
    for (const reviewHorizon of [{ choice: "date" as const, reviewByDate: new Date("2026-12-01") }, { choice: "none" as const }]) {
      const err = await caller(investorId).create({ ...base, reviewHorizon }).catch((e) => e);
      expect((err as TRPCError).code).toBe("NOT_FOUND"); // the fixture case does not exist: validation passed, nothing external was reached
    }
  });
  it("insertDecision persists the chosen horizon exactly", async () => {
    const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "CRT" }).returning();
    const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker: "CRT", decisionType: "BUY", decisionDate: at("2026-09-20T09:00:00Z"), reviewByDate: at("2026-12-01") });
    expect((await db.query.decisions.findFirst({ where: (x, { eq }) => eq(x.id, d.id) }))!.reviewByDate!.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const item = (await caller(investorId).attention({ timeZone: "Asia/Jerusalem" })).items.find((i) => i.decisionId === d.id)!;
    expect(item.horizon).toMatchObject({ status: "upcoming" });
    expect(item.state).toBe("monitoring");
  });
});

describe("no writes from reads", () => {
  it("attention leaves every table it reads unchanged", async () => {
    const count = async (t: string) => (await db.execute(`select count(*)::int n from ${t}`))[0]!.n as number;
    const before = await Promise.all(["decisions", "decision_snapshots", "predictions", "decision_reviews", "transactions"].map(count));
    await caller(investorId).attention({ timeZone: "Asia/Jerusalem" });
    await loadDecisionAttention(db, investorId, "Asia/Jerusalem");
    const after = await Promise.all(["decisions", "decision_snapshots", "predictions", "decision_reviews", "transactions"].map(count));
    expect(after).toEqual(before);
    expect((await db.select().from(schema.decisions).where(eq(schema.decisions.investorId, investorId))).every((d) => d.investorId === investorId)).toBe(true);
  });
});
