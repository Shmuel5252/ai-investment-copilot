// Prior Record Brief V1 — production paths on the authorized test database
// only (tests/support): migration 0015, cases.priorRecord (ownership, ticker
// and investor isolation, own-case exclusion, real episodes/answers) and the
// REAL decisions.create mutation freezing the brief into the new snapshot.
// Only the three external boundaries are mocked: the Anthropic decision
// synthesis, the FMP ticker fetch and the FMP market-context fetch.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ext = vi.hoisted(() => ({ decisionCalls: 0, marketContextId: "" }));
vi.mock("@/lib/ai/decision", () => ({
  synthesizeDecisionContext: async () => {
    ext.decisionCalls += 1;
    return { thesisInterpretationText: "mock interpretation", realtimeAssessmentText: "mock assessment", predictions: [{ claimText: "reconsider if margins fall", kind: "reentry_condition", timeframeDays: null }] };
  },
}));
vi.mock("@/lib/market/market-intelligence", () => ({
  getMarketIntelligence: async (_db: unknown, ticker: string) => ({
    ticker, companyName: `${ticker} Inc`, sector: "Technology", industry: "Semiconductors", price: 100, changePercentage: 0, marketCap: 1, beta: null,
    fiftyTwoWeekRange: null, description: null, peRatioTtm: null, priceToBookRatioTtm: null, priceToSalesRatioTtm: null, dividendYieldTtm: null,
    valuationRatiosAvailable: false, fetchedAt: new Date().toISOString(), source: "financial_modeling_prep",
  }),
}));
vi.mock("@/lib/market/market-context", async () => {
  const { db } = await import("@/db/client");
  return { getOrCaptureMarketContext: async () => (await db.query.marketContexts.findFirst({ where: (m, { eq }) => eq(m.id, ext.marketContextId) }))! };
});

import { casesRouter } from "@/server/routers/cases";
import { decisionsRouter } from "@/server/routers/decisions";
import { loadPriorRecordBrief } from "@/lib/prior-record/load-prior-record";
import { loadEpisodeJournal } from "@/lib/portfolio/load-episode-journal";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis, insertLaterContext } from "@/db/repositories/decisions";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 6 });
const db = drizzle(client, { schema });
const cases = (investorId: string) => casesRouter.createCaller({ session: { investorId } } as never);
const decisions = (investorId: string) => decisionsRouter.createCaller({ session: { investorId } } as never);
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const withoutGeneratedAt = (b: PriorRecordBrief) => ({ ...b, generatedAt: "<t>", asOf: "<t>" });

let investorId: string, foreignId: string, strategyVersionId: string;

async function mkCase(owner: string, ticker: string) {
  return (await db.insert(schema.investmentCases).values({ investorId: owner, ticker }).returning())[0]!;
}
async function mkPriorDecision(owner: string, ticker: string, o: { type?: "BUY" | "PASS"; date: string; reentry?: string }) {
  const c = await mkCase(owner, ticker);
  await db.update(schema.investmentCases).set({ status: "decided" }).where(eq(schema.investmentCases.id, c.id));
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c.id, ticker, decisionType: o.type ?? "BUY", decisionDate: at(o.date) });
  const thesis = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "95.5", userReasoningText: `reasoning for ${ticker} ${o.date}`, exitConditionsText: "a pullback", portfolioStateJson: { cash: 0, positions: [] }, marketContextId: ext.marketContextId, strategyVersionId, thesisId: thesis.id, investmentCaseSnapshotJson: {} }, []);
  if (o.reentry) await insertPrediction(db, { thesisId: thesis.id, claimText: o.reentry, kind: "reentry_condition" });
  return { decisionId: d.id, caseId: c.id };
}
async function mkTrade(owner: string, ticker: string, type: "buy" | "sell", qty: string, price: string, date: string, createdAt?: string) {
  return (await db.insert(schema.transactions).values({ investorId: owner, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`, transactionDate: at(date), source: "manual_entry", ...(createdAt ? { createdAt: at(createdAt) } : {}) }).returning())[0]!.id;
}

beforeAll(async () => {
  investorId = await mkInvestor(db, "prior-record");
  foreignId = await mkInvestor(db, "prior-record-foreign");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  await db.insert(schema.strategyVersions).values({ investorId: foreignId, versionNumber: 1, changeSummary: "f" });
  ext.marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("migration 0015 on the scratch DB", () => {
  it("adds decision_snapshots.prior_record_json as nullable jsonb with no default", async () => {
    const cols = await db.execute(`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'decision_snapshots' and column_name = 'prior_record_json'`);
    expect(cols).toEqual([{ data_type: "jsonb", is_nullable: "YES", column_default: null }]);
  });
});

describe("cases.priorRecord", () => {
  it("shows the investor's own prior decisions and episodes on the ticker, with rationale; never another ticker's or another investor's", async () => {
    const prior = await mkPriorDecision(investorId, "MUX", { type: "PASS", date: "2026-08-01T10:00:00Z", reentry: "reconsider if HBM demand slows" });
    await insertLaterContext(db, { decisionId: prior.decisionId, text: "clarification", addedBy: "user" });
    await db.insert(schema.decisionReviews).values({ decisionId: prior.decisionId, narrativeSummaryText: "n", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {} });
    const buy = await mkTrade(investorId, "MUX", "buy", "2", "80", "2026-05-01");
    await mkTrade(investorId, "MUX", "sell", "2", "100", "2026-06-01");
    await mkTrade(investorId, "MUX", "buy", "1", "90", "2026-09-01");
    const [session] = await db.insert(schema.interviewSessions).values({ investorId }).returning();
    await db.insert(schema.interviewAnswers).values({ interviewSessionId: session!.id, transactionId: buy, questionText: "why?", answerText: "cheap in the cycle" });
    // noise: another ticker, and another investor with the same ticker
    await mkPriorDecision(investorId, "OTHERX", { date: "2026-08-02T10:00:00Z" });
    await mkPriorDecision(foreignId, "MUX", { date: "2026-08-03T10:00:00Z", reentry: "foreign condition" });
    await mkTrade(foreignId, "MUX", "buy", "5", "70", "2026-04-01");

    const current = await mkCase(investorId, "MUX");
    const b = await cases(investorId).priorRecord({ caseId: current.id });
    expect(b.ticker).toBe("MUX");
    expect(b.decisions.map((d) => d.decisionId)).toEqual([prior.decisionId]);
    expect(b.decisions[0]).toMatchObject({ decisionType: "PASS", reasoningText: "reasoning for MUX 2026-08-01T10:00:00Z", exitConditionsText: "a pullback", reviewCount: 1, latestReview: { decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive" } });
    expect(b.decisions[0]!.laterContexts.map((l) => l.text)).toEqual(["clarification"]);
    expect(b.summary.pendingReentryConditions.map((c) => c.claimText)).toEqual(["reconsider if HBM demand slows"]);
    expect(b.episodes.map((e) => [e.key, e.status])).toEqual([["MUX#2", "open"], ["MUX#1", "closed"]]);
    expect(b.episodes[1]!.sells[0]).toMatchObject({ realizedPnlPercent: 25, trusted: true });
    expect(b.episodes[1]!.rationale.map((r) => r.answerText)).toEqual(["cheap in the cycle"]);
    expect(b.position).toEqual({ status: "held", quantity: 1, costBasisPerShare: 90 });
    expect(JSON.stringify(b)).not.toMatch(/foreign condition|OTHERX/);
  });
  it("a foreign investor gets NOT_FOUND for someone else's case", async () => {
    const c = await mkCase(investorId, "MUX");
    const err = await cases(foreignId).priorRecord({ caseId: c.id }).catch((e) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
  it("the case's own decision is not part of its prior record", async () => {
    const own = await mkPriorDecision(investorId, "OWNX", { date: "2026-08-01T10:00:00Z" });
    const b = await cases(investorId).priorRecord({ caseId: own.caseId });
    expect(b.decisions).toEqual([]);
  });
  it("an oversold ticker (accounting warning) withholds the position and the untrusted P&L", async () => {
    await mkTrade(investorId, "WARNX", "buy", "1", "10", "2026-01-01");
    await mkTrade(investorId, "WARNX", "sell", "3", "12", "2026-02-01");
    const b = await cases(investorId).priorRecord({ caseId: (await mkCase(investorId, "WARNX")).id });
    expect(b.position).toEqual({ status: "unavailable" });
    expect(b.episodes[0]!.sells[0]).toMatchObject({ realizedPnlPercent: null, trusted: false });
  });
});

describe("decisions.create freezes the brief into the new snapshot", () => {
  it("the frozen brief equals the live brief at recording time, excludes the new decision, and never changes afterwards", async () => {
    const first = await mkCase(investorId, "FRZX");
    await mkTrade(investorId, "FRZX", "buy", "3", "50", "2026-03-01");
    const liveBefore = await cases(investorId).priorRecord({ caseId: first.id });
    const callsBefore = ext.decisionCalls;
    const r1 = await decisions(investorId).create({ caseId: first.id, decisionType: "BUY", reasoningText: "first", reviewHorizon: { choice: "none" } });
    expect(ext.decisionCalls).toBe(callsBefore + 1);
    const snap1 = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r1.decision.id) }))!;
    const frozen1 = snap1.priorRecordJson as PriorRecordBrief;
    expect(withoutGeneratedAt(frozen1)).toEqual(withoutGeneratedAt(liveBefore));
    expect(frozen1.decisions).toEqual([]); // its own decision is never "prior"
    expect(frozen1.position).toEqual({ status: "held", quantity: 3, costBasisPerShare: 50 });

    // a second decision on the same ticker sees the first one (with its reentry condition)
    const second = await mkCase(investorId, "FRZX");
    const r2 = await decisions(investorId).create({ caseId: second.id, decisionType: "PASS", reasoningText: "second", reviewHorizon: { choice: "none" } });
    const frozen2 = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r2.decision.id) }))!.priorRecordJson as PriorRecordBrief;
    expect(frozen2.decisions.map((d) => [d.decisionId, d.reasoningText])).toEqual([[r1.decision.id, "first"]]);
    expect(frozen2.summary.pendingReentryConditions.map((c) => c.claimText)).toEqual(["reconsider if margins fall"]);

    // later facts (a review, later context, new trades) change the LIVE brief, never the frozen copies
    await db.insert(schema.decisionReviews).values({ decisionId: r1.decision.id, narrativeSummaryText: "n", decisionQualityOverall: "weak", thesisAccuracy: "refuted", outcomeJson: {} });
    await insertLaterContext(db, { decisionId: r1.decision.id, text: "added later", addedBy: "user" });
    await mkTrade(investorId, "FRZX", "sell", "3", "60", "2026-09-10");
    const third = await mkCase(investorId, "FRZX");
    const live = await cases(investorId).priorRecord({ caseId: third.id });
    expect(live.decisions.find((d) => d.decisionId === r1.decision.id)).toMatchObject({ reviewCount: 1, latestReview: { decisionQualityOverall: "weak" } });
    expect(live.position).toEqual({ status: "not_held" });
    const frozen2Again = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r2.decision.id) }))!.priorRecordJson;
    expect(frozen2Again).toEqual(frozen2);
    expect((frozen2Again as PriorRecordBrief).decisions[0]).toMatchObject({ reviewCount: 0, latestReview: null, laterContexts: [] });

    // a prediction resolution and a newly recorded rationale after creation do not touch the frozen copy either
    const firstThesis = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r1.decision.id) }))!.thesisId;
    await db.update(schema.predictions).set({ status: "confirmed", resolvedAt: new Date(), resolutionNote: "resolved later" }).where(eq(schema.predictions.thesisId, firstThesis));
    const frzBuy = (await db.select().from(schema.transactions).where(and(eq(schema.transactions.ticker, "FRZX"), eq(schema.transactions.investorId, investorId))))[0]!.id;
    const [sess] = await db.insert(schema.interviewSessions).values({ investorId }).returning();
    await db.insert(schema.interviewAnswers).values({ interviewSessionId: sess!.id, transactionId: frzBuy, questionText: "q", answerText: "rationale recorded later" });
    const frozen2Final = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r2.decision.id) }))!.priorRecordJson;
    expect(JSON.stringify(frozen2Final)).toBe(JSON.stringify(frozen2));
    const liveAfter = await cases(investorId).priorRecord({ caseId: third.id });
    expect(JSON.stringify(liveAfter)).toMatch(/resolved later/);
    expect(JSON.stringify(liveAfter)).toMatch(/rationale recorded later/);

    // decisions.get exposes the frozen copy to the decision page
    const got = await decisions(investorId).get({ decisionId: r2.decision.id });
    expect(got.snapshot!.priorRecordJson).toEqual(frozen2);
  });
  it("a legacy snapshot (created without the brief) reads back NULL — nothing is backfilled", async () => {
    const legacy = await mkPriorDecision(investorId, "LEGX", { date: "2026-07-01T10:00:00Z" });
    const got = await decisions(investorId).get({ decisionId: legacy.decisionId });
    expect(got.snapshot!.priorRecordJson).toBeNull();
  });
  it("the brief loader is investor-scoped even when called directly", async () => {
    const b = await loadPriorRecordBrief(db, { investorId: foreignId, ticker: "FRZX" });
    expect(b.decisions).toEqual([]);
    expect(b.episodes).toEqual([]);
  });
});

describe("point in time through the REAL decisions.create (backdated decision)", () => {
  it("freezes only what was knowable at the decision time: later trades, splits, reviews, resolutions, context and rationale stay out", async () => {
    const T = "2026-09-08T07:10:00Z";
    const b1 = await mkTrade(investorId, "PITX", "buy", "2", "50", "2026-03-01", "2026-03-02T00:00:00Z");
    await mkTrade(investorId, "PITX", "buy", "1", "60", "2026-09-05", "2026-09-23T00:00:00Z"); // backfilled later, but its day surely ended before T
    await mkTrade(investorId, "PITX", "buy", "7", "61", "2026-09-08", "2026-09-23T00:00:00Z"); // same day, recorded later: order unprovable -> out
    await mkTrade(investorId, "PITX", "sell", "5", "80", "2026-09-10", "2026-09-11T00:00:00Z"); // after T -> out (and its realized result)
    await db.insert(schema.corporateActions).values({ investorId, ticker: "PITX", kind: "stock_split", effectiveDate: at("2026-06-01"), ratioNumerator: 2, ratioDenominator: 1, source: "user_declared", evidence: "fixture" });
    await db.insert(schema.corporateActions).values({ investorId, ticker: "PITX", kind: "stock_split", effectiveDate: at("2026-09-09"), ratioNumerator: 3, ratioDenominator: 1, source: "user_declared", evidence: "fixture" });
    const [sess] = await db.insert(schema.interviewSessions).values({ investorId }).returning();
    await db.insert(schema.interviewAnswers).values([
      { interviewSessionId: sess!.id, transactionId: b1, questionText: "q", answerText: "early rationale", createdAt: at("2026-04-01T00:00:00Z") },
      { interviewSessionId: sess!.id, transactionId: b1, questionText: "q", answerText: "hindsight rationale", createdAt: at("2026-09-20T00:00:00Z") },
    ]);
    const [pc] = await db.insert(schema.investmentCases).values({ investorId, ticker: "PITX", status: "decided" }).returning();
    const prior = await insertDecision(db, { investorId, investmentCaseId: pc!.id, ticker: "PITX", decisionType: "PASS", decisionDate: at("2026-08-01T10:00:00Z"), createdAt: at("2026-08-01T10:00:01Z") });
    const th = await insertThesis(db, { thesisText: "t" });
    await insertDecisionSnapshot(db, { decisionId: prior.id, priceAtDecision: "55", userReasoningText: "prior reasoning", portfolioStateJson: { cash: 0, positions: [] }, marketContextId: ext.marketContextId, strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
    await insertPrediction(db, { thesisId: th.id, claimText: "reconsider below 45", kind: "reentry_condition", status: "refuted", resolvedAt: at("2026-09-12T00:00:00Z"), resolutionNote: "resolved after T", createdAt: at("2026-08-01T10:00:01Z") });
    await db.insert(schema.decisionReviews).values({ decisionId: prior.id, reviewDate: at("2026-09-12T00:00:00Z"), narrativeSummaryText: "n", decisionQualityOverall: "weak", thesisAccuracy: "refuted", outcomeJson: {} });
    await db.insert(schema.laterContexts).values({ decisionId: prior.id, text: "context after T", addedBy: "user", addedAt: at("2026-09-15T00:00:00Z") });
    const [lc] = await db.insert(schema.investmentCases).values({ investorId, ticker: "PITX", status: "decided" }).returning();
    await insertDecision(db, { investorId, investmentCaseId: lc!.id, ticker: "PITX", decisionType: "BUY", decisionDate: at("2026-09-01T10:00:00Z"), createdAt: at("2026-09-20T00:00:00Z") });

    const c = await mkCase(investorId, "PITX");
    const r = await decisions(investorId).create({ caseId: c.id, decisionType: "BUY", decisionDate: T, reasoningText: "backdated", reviewHorizon: { choice: "none" } });
    const frozen = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r.decision.id) }))!.priorRecordJson as PriorRecordBrief;

    expect(frozen.asOf).toBe("2026-09-08T07:10:00.000Z");
    expect(frozen.historyThrough).toBe("2026-09-05T00:00:00.000Z");
    // 2 bought 03-01, 2:1 split 06-01 -> 4 (cost 100), +1 @60 on 09-05 -> 5 (cost 160); the 09-09 split and the 09-08 / 09-10 rows are out
    expect(frozen.position).toEqual({ status: "held", quantity: 5, costBasisPerShare: 32 });
    expect(frozen.episodes.map((e) => [e.key, e.status, e.buyCount, e.sellCount])).toEqual([["PITX#1", "open", 2, 0]]);
    expect(frozen.episodes[0]!.rationale.map((x) => x.answerText)).toEqual(["early rationale"]);
    expect(frozen.decisions.map((d) => d.decisionId)).toEqual([prior.id]);
    expect(frozen.decisions[0]).toMatchObject({ reviewCount: 0, latestReview: null, laterContexts: [] });
    expect(frozen.decisions[0]!.predictions).toEqual([expect.objectContaining({ status: "pending", resolvedAt: null, resolutionNote: null })]);
    expect(frozen.summary.pendingReentryConditions.map((x) => x.claimText)).toEqual(["reconsider below 45"]);
    expect(JSON.stringify(frozen)).not.toMatch(/hindsight rationale|resolved after T|context after T|"weak"/);

    const live = await cases(investorId).priorRecord({ caseId: (await mkCase(investorId, "PITX")).id });
    expect(live.episodes.some((e) => e.sells.length > 0)).toBe(true);
    expect(JSON.stringify(live)).toMatch(/resolved after T/);
  });

  it("episodes are the canonical journal's episodes (no second accounting), including a same-day group without a declared order", async () => {
    await mkTrade(investorId, "EQX", "buy", "2", "10", "2026-02-01");
    await mkTrade(investorId, "EQX", "sell", "1", "12", "2026-02-01");
    await mkTrade(investorId, "EQX", "sell", "1", "13", "2026-03-01");
    await mkTrade(investorId, "EQX", "buy", "3", "11", "2026-04-01");
    const brief = await cases(investorId).priorRecord({ caseId: (await mkCase(investorId, "EQX")).id });
    const canonical = (await loadEpisodeJournal(db, investorId)).episodes.filter((e) => e.ticker === "EQX");
    expect(brief.episodes.map((e) => [e.key, e.status, e.buyCount, e.sellCount]).sort()).toEqual(canonical.map((e) => [e.key, e.status, e.buyCount, e.sellCount]).sort());
    expect(brief.episodes.length).toBeGreaterThan(0);
  });
});
