// Prior Record → AI Decision Context V1 — the REAL decisions.create and
// reviews.generate paths on the authorized test database only (tests/support).
// Mocked: the two AI calls (their inputs are captured), the FMP fetches, and
// the brief loader is WRAPPED (real implementation, call counter) to prove
// where it is — and is not — called.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import type { DecisionContextInput } from "@/lib/ai/decision";
import type { ReviewInput } from "@/lib/ai/review";

const cap = vi.hoisted(() => ({
  decisionInputs: [] as unknown[],
  reviewInputs: [] as unknown[],
  loaderCalls: 0,
  marketContextId: "",
}));
vi.mock("@/lib/ai/decision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/decision")>()),
  synthesizeDecisionContext: async (input: unknown) => {
    cap.decisionInputs.push(structuredClone(input));
    return { thesisInterpretationText: "mock interpretation", realtimeAssessmentText: "mock assessment", predictions: [] };
  },
}));
vi.mock("@/lib/ai/review", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/review")>()),
  synthesizeDecisionReview: async (input: unknown) => {
    cap.reviewInputs.push(structuredClone(input));
    return {
      narrativeSummaryText: "mock narrative",
      thesisAccuracy: "insufficient_evidence",
      dimensions: ["thesis_quality", "evidence_quality", "risk_awareness", "valuation_awareness", "portfolio_fit", "strategy_consistency", "exit_conditions"].map((dimension) => ({
        dimension, verdict: "reasonable", rationaleText: "mock", citedSnapshotFields: dimension === "exit_conditions" ? ["priorRecord"] : ["userReasoningText"],
      })),
    };
  },
}));
vi.mock("@/lib/prior-record/load-prior-record", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/prior-record/load-prior-record")>();
  return { loadPriorRecordBrief: (...args: Parameters<typeof real.loadPriorRecordBrief>) => { cap.loaderCalls += 1; return real.loadPriorRecordBrief(...args); } };
});
vi.mock("@/lib/market/market-intelligence", () => ({
  getMarketIntelligence: async (_db: unknown, ticker: string) => ({
    ticker, companyName: `${ticker} Inc`, sector: "Technology", industry: "Semiconductors", price: 100, changePercentage: 0, marketCap: 1, beta: null,
    fiftyTwoWeekRange: null, description: null, peRatioTtm: null, priceToBookRatioTtm: null, priceToSalesRatioTtm: null, dividendYieldTtm: null,
    valuationRatiosAvailable: false, fetchedAt: new Date().toISOString(), source: "financial_modeling_prep",
  }),
}));
vi.mock("@/lib/market/market-context", async () => {
  const { db } = await import("@/db/client");
  return { getOrCaptureMarketContext: async () => (await db.query.marketContexts.findFirst({ where: (m, { eq }) => eq(m.id, cap.marketContextId) }))! };
});

import { decisionsRouter } from "@/server/routers/decisions";
import { reviewsRouter } from "@/server/routers/reviews";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis } from "@/db/repositories/decisions";
import { projectPriorRecordForAi } from "@/lib/prior-record/ai-context";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 6 });
const db = drizzle(client, { schema });
const decisions = (investorId: string) => decisionsRouter.createCaller({ session: { investorId } } as never);
const reviews = (investorId: string) => reviewsRouter.createCaller({ session: { investorId } } as never);
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const lastDecisionInput = () => cap.decisionInputs.at(-1) as DecisionContextInput;
const lastReviewInput = () => cap.reviewInputs.at(-1) as ReviewInput;
const frozenOf = async (decisionId: string) => (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, decisionId) }))!.priorRecordJson as PriorRecordBrief | null;

let investorId: string, foreignId: string, strategyVersionId: string;

async function mkCase(owner: string, ticker: string) {
  return (await db.insert(schema.investmentCases).values({ investorId: owner, ticker }).returning())[0]!;
}
async function mkTrade(owner: string, ticker: string, type: "buy" | "sell", qty: string, price: string, date: string, createdAt?: string) {
  return (await db.insert(schema.transactions).values({ investorId: owner, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`, transactionDate: at(date), source: "manual_entry", ...(createdAt ? { createdAt: at(createdAt) } : {}) }).returning())[0]!.id;
}
async function mkPriorDecision(owner: string, ticker: string, o: { date: string; createdAt?: string; reasoning: string; reentry?: string; svId?: string }) {
  const c = await mkCase(owner, ticker);
  await db.update(schema.investmentCases).set({ status: "decided" }).where(eq(schema.investmentCases.id, c.id));
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c.id, ticker, decisionType: "PASS", decisionDate: at(o.date), ...(o.createdAt ? { createdAt: at(o.createdAt) } : {}) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "777.77", userReasoningText: o.reasoning, portfolioStateJson: { cash: 0, positions: [] }, marketContextId: cap.marketContextId, strategyVersionId: o.svId ?? strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  const p = o.reentry ? await insertPrediction(db, { thesisId: th.id, claimText: o.reentry, kind: "reentry_condition", createdAt: at(o.createdAt ?? o.date) }) : null;
  return { decisionId: d.id, predictionId: p?.id ?? null };
}

beforeAll(async () => {
  investorId = await mkInvestor(db, "prior-record-ai");
  foreignId = await mkInvestor(db, "prior-record-ai-foreign");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  await db.insert(schema.strategyVersions).values({ investorId: foreignId, versionNumber: 1, changeSummary: "f" });
  cap.marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
beforeEach(() => {
  cap.loaderCalls = 0;
});
afterAll(async () => {
  await client.end();
});

describe("decisions.create — the AI gets the projection of exactly the brief that is frozen", () => {
  it("backdated decision: later trade, split, review, resolution, context and rationale reach neither the AI nor the snapshot", async () => {
    const T = "2026-09-08T07:10:00Z";
    const b1 = await mkTrade(investorId, "AIPX", "buy", "2", "50", "2026-03-01", "2026-03-02T00:00:00Z");
    await mkTrade(investorId, "AIPX", "sell", "2", "80", "2026-04-01", "2026-04-02T00:00:00Z"); // closed episode with a +60% result (never to the AI)
    await mkTrade(investorId, "AIPX", "buy", "1", "90", "2026-09-10", "2026-09-11T00:00:00Z"); // after T
    await db.insert(schema.corporateActions).values({ investorId, ticker: "AIPX", kind: "stock_split", effectiveDate: at("2026-09-09"), ratioNumerator: 3, ratioDenominator: 1, source: "user_declared", evidence: "fixture" });
    const [sess] = await db.insert(schema.interviewSessions).values({ investorId }).returning();
    await db.insert(schema.interviewAnswers).values([
      { interviewSessionId: sess!.id, transactionId: b1, questionText: "q", answerText: "early rationale", createdAt: at("2026-04-05T00:00:00Z") },
      { interviewSessionId: sess!.id, transactionId: b1, questionText: "q", answerText: "hindsight rationale", createdAt: at("2026-09-20T00:00:00Z") },
    ]);
    const prior = await mkPriorDecision(investorId, "AIPX", { date: "2026-08-01T10:00:00Z", createdAt: "2026-08-01T10:00:01Z", reasoning: "prior reasoning", reentry: "reconsider below 45" });
    await db.update(schema.predictions).set({ status: "refuted", resolvedAt: at("2026-09-12T00:00:00Z"), resolutionNote: "resolved after T" }).where(eq(schema.predictions.id, prior.predictionId!));
    await db.insert(schema.decisionReviews).values({ decisionId: prior.decisionId, reviewDate: at("2026-09-12T00:00:00Z"), narrativeSummaryText: "n", decisionQualityOverall: "weak", thesisAccuracy: "refuted", outcomeJson: {} });
    await db.insert(schema.laterContexts).values({ decisionId: prior.decisionId, text: "context after T", addedBy: "user", addedAt: at("2026-09-15T00:00:00Z") });

    const c = await mkCase(investorId, "AIPX");
    const r = await decisions(investorId).create({ caseId: c.id, decisionType: "BUY", sizeDollars: 300, decisionDate: T, reasoningText: "backdated", reviewHorizon: { choice: "none" } });
    const frozen = (await frozenOf(r.decision.id))!;
    const sent = lastDecisionInput().priorRecord;

    expect(cap.loaderCalls).toBe(1); // one load: no second brief between the AI call and the snapshot
    expect(sent).toEqual(projectPriorRecordForAi(frozen)); // AI input source == frozen source
    expect(sent.asOf).toBe("2026-09-08T07:10:00.000Z");
    expect(sent.decisions.map((d) => [d.decisionId, d.reviewCount, d.resolvedClaimCount, d.pendingClaims.map((p) => p.claimText), d.laterContexts])).toEqual([[prior.decisionId, 0, 0, ["reconsider below 45"], []]]);
    expect(sent.episodes.map((e) => [e.key, e.status, e.buyCount, e.sellCount, e.rationale.map((x) => x.answerText)])).toEqual([["AIPX#1", "closed", 1, 1, ["early rationale"]]]);
    const text = JSON.stringify(sent) + "\n" + (await import("@/lib/ai/decision")).formatContext(lastDecisionInput());
    expect(text).not.toMatch(/hindsight rationale|resolved after T|context after T|"weak"|refuted|777\.77|60(\.0)?%|AIPX#2/);
    expect(text).toContain("[Prior decision 1] PAST ACTION (not a recommendation): PASS on 2026-08-01");
  });

  it("the case being decided is never in its own record; another investor's same-ticker history never appears", async () => {
    await mkPriorDecision(foreignId, "OWNX", { date: "2026-07-01T10:00:00Z", reasoning: "FOREIGN reasoning", reentry: "FOREIGN trigger" });
    await mkTrade(foreignId, "OWNX", "buy", "5", "10", "2026-06-01");
    const mine = await mkPriorDecision(investorId, "OWNX", { date: "2026-07-02T10:00:00Z", reasoning: "my earlier reasoning" });

    const c = await mkCase(investorId, "OWNX");
    const r = await decisions(investorId).create({ caseId: c.id, decisionType: "PASS", reasoningText: "now", reviewHorizon: { choice: "none" } });
    const sent = lastDecisionInput().priorRecord;
    expect(sent.decisions.map((d) => d.decisionId)).toEqual([mine.decisionId]);
    expect(sent.decisions.map((d) => d.decisionId)).not.toContain(r.decision.id);
    expect(sent.episodes).toEqual([]);
    expect(JSON.stringify(sent)).not.toMatch(/FOREIGN/);
    expect(sent).toEqual(projectPriorRecordForAi(await frozenOf(r.decision.id)));
  });
});

describe("reviews.generate — only the frozen copy, never a recomputed brief", () => {
  it("later trades, reviews, context and rationale do not change what Review sees; the loader is never called; the citation is kept", async () => {
    const prior = await mkPriorDecision(investorId, "RVWX", { date: "2026-06-01T10:00:00Z", reasoning: "prior on RVWX", reentry: "RVWX trigger" });
    const c = await mkCase(investorId, "RVWX");
    const r = await decisions(investorId).create({ caseId: c.id, decisionType: "BUY", sizeDollars: 200, reasoningText: "buy RVWX", reviewHorizon: { choice: "none" } });
    const frozenBefore = await frozenOf(r.decision.id);

    // everything that would change a LIVE brief
    const t = await mkTrade(investorId, "RVWX", "buy", "3", "100", "2026-09-22");
    await db.insert(schema.laterContexts).values({ decisionId: prior.decisionId, text: "LATE context", addedBy: "user" });
    await db.insert(schema.decisionReviews).values({ decisionId: prior.decisionId, narrativeSummaryText: "n", decisionQualityOverall: "strong", thesisAccuracy: "confirmed", outcomeJson: {} });
    await db.update(schema.predictions).set({ status: "confirmed", resolvedAt: new Date(), resolutionNote: "LATE resolution" }).where(eq(schema.predictions.id, prior.predictionId!));
    const [sess] = await db.insert(schema.interviewSessions).values({ investorId }).returning();
    await db.insert(schema.interviewAnswers).values({ interviewSessionId: sess!.id, transactionId: t, questionText: "q", answerText: "LATE rationale" });

    cap.loaderCalls = 0;
    const out = await reviews(investorId).generate({ decisionId: r.decision.id, idempotencyKey: randomUUID(), predictionResolutions: [] });
    expect(cap.loaderCalls).toBe(0);
    expect(await frozenOf(r.decision.id)).toEqual(frozenBefore);
    const seen = lastReviewInput().priorRecordAtDecision!;
    expect(seen).toEqual(projectPriorRecordForAi(frozenBefore));
    expect(seen.pendingReentryConditions.map((x) => x.claimText)).toEqual(["RVWX trigger"]);
    expect(JSON.stringify(seen)).not.toMatch(/LATE/);
    expect(out.dimensions.find((d) => d.dimension === "exit_conditions")).toMatchObject({ verdict: "reasonable", citedSnapshotFields: ["priorRecord"] });
  });

  it("a legacy decision (NULL) reaches Review as NOT CAPTURED, never today's history, and cannot cite priorRecord", async () => {
    await mkPriorDecision(investorId, "LEGX", { date: "2026-05-01T10:00:00Z", reasoning: "older LEGX decision" });
    await mkTrade(investorId, "LEGX", "buy", "1", "10", "2026-05-02");
    const legacy = await mkPriorDecision(investorId, "LEGX", { date: "2026-06-01T10:00:00Z", reasoning: "legacy decision" });
    expect(await frozenOf(legacy.decisionId)).toBeNull();

    const out = await reviews(investorId).generate({ decisionId: legacy.decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    expect(cap.loaderCalls).toBe(0);
    expect(lastReviewInput().priorRecordAtDecision).toBeNull();
    const { formatInput } = await import("@/lib/ai/review");
    expect(formatInput(lastReviewInput())).toContain("NOT CAPTURED");
    expect(formatInput(lastReviewInput())).not.toMatch(/older LEGX decision/);
    expect(out.dimensions.find((d) => d.dimension === "exit_conditions")).toMatchObject({ verdict: "insufficient_evidence", citedSnapshotFields: [] });
    expect(await frozenOf(legacy.decisionId)).toBeNull(); // nothing backfilled
  });

  it("an unsupported frozen version fails closed before the AI call, writing nothing", async () => {
    const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "BADX", status: "decided" }).returning();
    const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker: "BADX", decisionType: "BUY", decisionDate: at("2026-08-01T10:00:00Z") });
    const th = await insertThesis(db, { thesisText: "t" });
    await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "1", userReasoningText: "r", portfolioStateJson: { cash: 0, positions: [] }, marketContextId: cap.marketContextId, strategyVersionId, thesisId: th.id, investmentCaseSnapshotJson: {}, priorRecordJson: { version: 99 } }, []);
    const before = cap.reviewInputs.length;
    const err = await reviews(investorId).generate({ decisionId: d.id, idempotencyKey: randomUUID(), predictionResolutions: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("INTERNAL_SERVER_ERROR");
    expect(cap.reviewInputs.length).toBe(before);
    expect(await db.select().from(schema.decisionReviews).where(eq(schema.decisionReviews.decisionId, d.id))).toEqual([]);
  });
});
