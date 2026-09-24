// Decision Follow-Through V1 — the REAL executions / predictions / cases /
// reviews / decisions routers on the authorized test database only
// (tests/support): migration 0016, execution candidates from the monitoring's
// own groups, append-only investor-asserted execution facts (rules, replay,
// supersession, concurrency), standalone re-entry condition resolution and
// its interaction with Decision Review integrity, reconsideration cases with
// an explicit origin, the dashboard's open conditions, and what the AI paths
// receive. Mocked: the two AI calls (inputs captured), the FMP fetches.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import type { DecisionContextInput } from "@/lib/ai/decision";
import type { ReviewInput } from "@/lib/ai/review";

const cap = vi.hoisted(() => ({
  decisionInputs: [] as unknown[],
  reviewInputs: [] as unknown[],
  duringReview: async (): Promise<void> => {},
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
    await cap.duringReview();
    return {
      narrativeSummaryText: "mock narrative",
      thesisAccuracy: "insufficient_evidence",
      dimensions: ["thesis_quality", "evidence_quality", "risk_awareness", "valuation_awareness", "portfolio_fit", "strategy_consistency", "exit_conditions"].map((dimension) => ({
        dimension, verdict: "reasonable", rationaleText: "mock", citedSnapshotFields: dimension === "exit_conditions" ? ["executionFacts"] : ["userReasoningText"],
      })),
    };
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
  return { getOrCaptureMarketContext: async () => (await db.query.marketContexts.findFirst({ where: (m, { eq }) => eq(m.id, cap.marketContextId) }))! };
});

import { executionsRouter } from "@/server/routers/executions";
import { predictionsRouter } from "@/server/routers/predictions";
import { casesRouter } from "@/server/routers/cases";
import { reviewsRouter } from "@/server/routers/reviews";
import { decisionsRouter } from "@/server/routers/decisions";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis } from "@/db/repositories/decisions";
import { loadEffectiveExecutionFactsForDecision } from "@/db/repositories/execution-facts";
import { ATTENTION_REASONS } from "@/lib/monitoring/decision-attention";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });
const session = (investorId: string) => ({ session: { investorId } }) as never;
const executions = (i: string) => executionsRouter.createCaller(session(i));
const predictions = (i: string) => predictionsRouter.createCaller(session(i));
const cases = (i: string) => casesRouter.createCaller(session(i));
const reviews = (i: string) => reviewsRouter.createCaller(session(i));
const decisions = (i: string) => decisionsRouter.createCaller(session(i));
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const codeOf = (e: unknown) => (e as TRPCError).code;
const TZ = "UTC";

let investorId: string, foreignId: string, strategyVersionId: string;

async function mkTrade(owner: string, ticker: string, type: "buy" | "sell", qty: string, price: string, date: string, createdAt?: string) {
  return (await db.insert(schema.transactions).values({ investorId: owner, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`, transactionDate: at(date), source: "manual_entry", ...(createdAt ? { createdAt: at(createdAt) } : {}) }).returning())[0]!.id;
}
async function mkDecision(owner: string, ticker: string, type: "BUY" | "PASS" | "SELL", date: string, preds: { claim: string; kind: "forecast" | "reentry_condition" }[] = [], svId = strategyVersionId) {
  const [c] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker, status: "decided" }).returning();
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c!.id, ticker, decisionType: type, decisionDate: at(date) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", size: type === "PASS" ? null : "500", userReasoningText: `reasoning ${ticker}`, portfolioStateJson: { cash: 0, positions: [] }, marketContextId: cap.marketContextId, strategyVersionId: svId, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  const predictionIds: string[] = [];
  for (const p of preds) predictionIds.push((await insertPrediction(db, { thesisId: th.id, claimText: p.claim, kind: p.kind })).id);
  return { decisionId: d.id, caseId: c!.id, thesisId: th.id, predictionIds };
}
const factsOf = (decisionId: string) => db.select().from(schema.decisionExecutionFacts).where(eq(schema.decisionExecutionFacts.decisionId, decisionId));

beforeAll(async () => {
  investorId = await mkInvestor(db, "follow-through");
  foreignId = await mkInvestor(db, "follow-through-foreign");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  await db.insert(schema.strategyVersions).values({ investorId: foreignId, versionNumber: 1, changeSummary: "f" });
  cap.marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
beforeEach(() => {
  cap.duringReview = async () => {};
});
afterAll(async () => {
  await client.end();
});

describe("migration 0016 on the scratch DB", () => {
  it("creates decision_execution_facts (append-only shape) and investment_cases.origin_prediction_id", async () => {
    const cols = await db.execute(`select column_name, is_nullable from information_schema.columns where table_name = 'decision_execution_facts' order by ordinal_position`);
    expect(cols.map((c) => c.column_name)).toEqual(["id", "investor_id", "decision_id", "transaction_id", "verdict", "shown_basis_json", "note", "supersedes_fact_id", "created_at"]);
    const origin = await db.execute(`select data_type, is_nullable from information_schema.columns where table_name = 'investment_cases' and column_name = 'origin_prediction_id'`);
    expect(origin).toEqual([{ data_type: "uuid", is_nullable: "YES" }]);
    const idx = await db.execute(`select indexname from pg_indexes where tablename in ('decision_execution_facts','investment_cases') and indexname in ('decision_execution_facts_supersedes_unique','investment_cases_origin_prediction_unique') order by 1`);
    expect(idx.map((i) => i.indexname)).toEqual(["decision_execution_facts_supersedes_unique", "investment_cases_origin_prediction_unique"]);
    expect(ATTENTION_REASONS).toHaveLength(4); // monitoring untouched
  });
});

describe("execution candidates and facts", () => {
  it("candidates are the monitoring's execution groups for the decision — this investor, this ticker — with canExecute from side and day", async () => {
    const d = await mkDecision(investorId, "EXC", "BUY", "2026-06-10T10:00:00Z");
    const before = await mkTrade(investorId, "EXC", "buy", "1", "10", "2026-06-08", "2026-06-08T12:00:00Z");
    const sameDay = await mkTrade(investorId, "EXC", "buy", "1", "10", "2026-06-10");
    const after = await mkTrade(investorId, "EXC", "buy", "2", "11", "2026-06-12");
    const afterSell = await mkTrade(investorId, "EXC", "sell", "1", "12", "2026-06-13");
    const backfilled = await mkTrade(investorId, "EXC", "buy", "1", "9", "2026-06-05"); // created now, dated before → backfilled
    await mkTrade(foreignId, "EXC", "buy", "5", "10", "2026-06-12");
    await mkTrade(investorId, "OTHR", "buy", "5", "10", "2026-06-12");
    await mkTrade(investorId, "EXC", "buy", "1", "10", "2026-06-20"); // freshness, so the history reaches the decision day

    const c = await executions(investorId).candidates({ decisionId: d.decisionId, timeZone: TZ });
    expect(c).toMatchObject({ decisionType: "BUY", executedSide: "buy", status: "available", executed: [], unrelatedCount: 0 });
    const byId = new Map(c.candidates.map((x) => [x.transactionId, x]));
    expect(byId.get(before)).toMatchObject({ group: "knownBefore", canExecute: false, assertion: null });
    expect(byId.get(sameDay)).toMatchObject({ group: "sameDay", canExecute: true });
    expect(byId.get(after)).toMatchObject({ group: "after", canExecute: true });
    expect(byId.get(afterSell)).toMatchObject({ group: "after", canExecute: false });
    expect(byId.get(backfilled)).toMatchObject({ group: "backfilledBefore", canExecute: false });
    expect(c.candidates.every((x) => [before, sameDay, after, afterSell, backfilled].includes(x.transactionId) || x.transactionDate.toISOString().startsWith("2026-06-20"))).toBe(true);
    await expect(executions(foreignId).candidates({ decisionId: d.decisionId, timeZone: TZ })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(executions(investorId).candidates({ decisionId: d.decisionId, timeZone: "Not/AZone" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("assert: executed → appended fact; identical retry replays; a different verdict must supersede; the chain head is effective", async () => {
    const d = await mkDecision(investorId, "ASR", "BUY", "2026-06-10T10:00:00Z");
    const after = await mkTrade(investorId, "ASR", "buy", "2", "11", "2026-06-12");
    const r1 = await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "executed", timeZone: TZ, note: "  first  " });
    expect(r1.replayed).toBe(false);
    expect(r1.fact).toMatchObject({ verdict: "executed", note: "first", supersedesFactId: null });
    const r2 = await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "executed", timeZone: TZ, note: "first" });
    expect(r2).toMatchObject({ replayed: true, fact: { id: r1.fact.id } });
    expect(await factsOf(d.decisionId)).toHaveLength(1);
    const conflict = await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "unrelated", timeZone: TZ }).catch((e) => e);
    expect(codeOf(conflict)).toBe("BAD_REQUEST");
    expect((conflict as Error).message).toMatch(/supersede it instead/);
    const r3 = await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "unrelated", timeZone: TZ, supersedesFactId: r1.fact.id });
    expect(r3.fact.supersedesFactId).toBe(r1.fact.id);
    expect(await factsOf(d.decisionId)).toHaveLength(2);
    const effective = await loadEffectiveExecutionFactsForDecision(db, d.decisionId);
    expect(effective.map((f) => [f.id, f.verdict])).toEqual([[r3.fact.id, "unrelated"]]);
    // a second successor of the same fact is refused (partial unique index + repository check)
    const fork = await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "executed", timeZone: TZ, supersedesFactId: r1.fact.id }).catch((e) => e);
    expect(codeOf(fork)).toBe("BAD_REQUEST");
    const c = await executions(investorId).candidates({ decisionId: d.decisionId, timeZone: TZ });
    expect(c.candidates.find((x) => x.transactionId === after)?.assertion).toEqual({ factId: r3.fact.id, verdict: "unrelated", note: null });
    expect(c).toMatchObject({ executed: [], unrelatedCount: 1 });
  });

  it("what cannot be asserted: a PASS executed, a sell for a BUY, a trade before the decision day, another ticker, another investor's trade or decision", async () => {
    const buy = await mkDecision(investorId, "RUL", "BUY", "2026-06-10T10:00:00Z");
    const pass = await mkDecision(investorId, "RUL", "PASS", "2026-06-10T10:00:00Z");
    const after = await mkTrade(investorId, "RUL", "buy", "2", "11", "2026-06-12");
    const afterSell = await mkTrade(investorId, "RUL", "sell", "1", "12", "2026-06-13");
    const before = await mkTrade(investorId, "RUL", "buy", "1", "10", "2026-06-08");
    const other = await mkTrade(investorId, "RULX", "buy", "1", "10", "2026-06-12");
    const foreignTrade = await mkTrade(foreignId, "RUL", "buy", "1", "10", "2026-06-12");
    const bad = async (input: Parameters<ReturnType<typeof executions>["assert"]>[0], re: RegExp, caller = investorId) => {
      const err = await executions(caller).assert(input).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as Error).message).toMatch(re);
      return codeOf(err);
    };
    expect(await bad({ decisionId: pass.decisionId, transactionId: after, verdict: "executed", timeZone: TZ }, /A PASS decision is not executed by a trade/)).toBe("BAD_REQUEST");
    expect(await bad({ decisionId: buy.decisionId, transactionId: afterSell, verdict: "executed", timeZone: TZ }, /executed by a buy, not a sell/)).toBe("BAD_REQUEST");
    expect(await bad({ decisionId: buy.decisionId, transactionId: before, verdict: "executed", timeZone: TZ }, /before the decision day/)).toBe("BAD_REQUEST");
    expect(await bad({ decisionId: buy.decisionId, transactionId: other, verdict: "executed", timeZone: TZ }, /not in the decision's ticker/)).toBe("BAD_REQUEST");
    expect(await bad({ decisionId: buy.decisionId, transactionId: foreignTrade, verdict: "executed", timeZone: TZ }, /Unknown transaction/)).toBe("BAD_REQUEST");
    expect(await bad({ decisionId: buy.decisionId, transactionId: after, verdict: "executed", timeZone: TZ }, /Decision not found/, foreignId)).toBe("NOT_FOUND");
    // allowed: "unrelated" on a PASS and on a before-dated trade
    await executions(investorId).assert({ decisionId: pass.decisionId, transactionId: after, verdict: "unrelated", timeZone: TZ });
    await executions(investorId).assert({ decisionId: buy.decisionId, transactionId: before, verdict: "unrelated", timeZone: TZ });
    expect(await factsOf(buy.decisionId)).toHaveLength(1);
    expect(await factsOf(pass.decisionId)).toHaveLength(1);
    // the decision's own trade day, in the investor's zone: 22:30Z on the 10th is the 11th in Jerusalem
    const late = await mkDecision(investorId, "RUL", "BUY", "2026-06-10T22:30:00Z");
    const tenth = await mkTrade(investorId, "RUL", "buy", "1", "10", "2026-06-10");
    expect(await bad({ decisionId: late.decisionId, transactionId: tenth, verdict: "executed", timeZone: "Asia/Jerusalem" }, /before the decision day/)).toBe("BAD_REQUEST");
    await executions(investorId).assert({ decisionId: late.decisionId, transactionId: tenth, verdict: "executed", timeZone: "UTC" });
  });

  it("concurrent assertions of one pair: identical → one row, both succeed; opposite → one row, one conflict", async () => {
    const d = await mkDecision(investorId, "CNC", "BUY", "2026-06-10T10:00:00Z");
    const t1 = await mkTrade(investorId, "CNC", "buy", "2", "11", "2026-06-12");
    const t2 = await mkTrade(investorId, "CNC", "buy", "2", "11", "2026-06-13");
    const same = await Promise.all([1, 2, 3].map(() => executions(investorId).assert({ decisionId: d.decisionId, transactionId: t1, verdict: "executed", timeZone: TZ })));
    expect(new Set(same.map((r) => r.fact.id)).size).toBe(1);
    expect(same.filter((r) => r.replayed)).toHaveLength(2);
    const mixed = await Promise.allSettled([
      executions(investorId).assert({ decisionId: d.decisionId, transactionId: t2, verdict: "executed", timeZone: TZ }),
      executions(investorId).assert({ decisionId: d.decisionId, transactionId: t2, verdict: "unrelated", timeZone: TZ }),
    ]);
    expect(mixed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mixed.filter((r) => r.status === "rejected" && codeOf((r as PromiseRejectedResult).reason) === "BAD_REQUEST")).toHaveLength(1);
    expect((await factsOf(d.decisionId)).filter((f) => f.transactionId === t2)).toHaveLength(1);
  });
});

describe("Review receives the investor-confirmed execution facts", () => {
  it("before any assertion: NOT ASSERTED and the executionFacts citation is dropped; after: facts reach the AI and the citation is kept", async () => {
    const d = await mkDecision(investorId, "RVX", "BUY", "2026-06-10T10:00:00Z");
    const after = await mkTrade(investorId, "RVX", "buy", "2", "11", "2026-06-12");
    const unrelated = await mkTrade(investorId, "RVX", "buy", "9", "11", "2026-06-15");
    const { formatInput } = await import("@/lib/ai/review");

    const first = await reviews(investorId).generate({ decisionId: d.decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    const in1 = cap.reviewInputs.at(-1) as ReviewInput;
    expect(in1.executionFacts).toEqual({ executed: [], unrelatedCount: 0 });
    expect(formatInput(in1)).toContain("=== executionFacts (POST-DECISION: investor-confirmed follow-through — not part of the frozen snapshot) ===\nNOT ASSERTED");
    expect(first.dimensions.find((x) => x.dimension === "exit_conditions")).toMatchObject({ verdict: "insufficient_evidence", citedSnapshotFields: [] });

    await executions(investorId).assert({ decisionId: d.decisionId, transactionId: after, verdict: "executed", timeZone: TZ, note: "as decided" });
    await executions(investorId).assert({ decisionId: d.decisionId, transactionId: unrelated, verdict: "unrelated", timeZone: TZ });
    const second = await reviews(investorId).generate({ decisionId: d.decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    const in2 = cap.reviewInputs.at(-1) as ReviewInput;
    expect(in2.executionFacts).toEqual({
      executed: [{ transactionType: "buy", transactionDate: "2026-06-12T00:00:00.000Z", quantity: 2, price: 11, amount: -22, note: "as decided" }],
      unrelatedCount: 1,
    });
    expect(second.dimensions.find((x) => x.dimension === "exit_conditions")).toMatchObject({ verdict: "reasonable", citedSnapshotFields: ["executionFacts"] });
    // the Decision AI path never sees execution facts (they are after the decision, not in its contract)
    expect(JSON.stringify(cap.decisionInputs)).not.toContain("executionFacts");
  });
});

describe("re-entry condition lifecycle", () => {
  it("resolves on its own (resolved_by_review_id NULL), replays identical retries, refuses a different re-resolution, a forecast, and another investor", async () => {
    const d = await mkDecision(investorId, "REC", "PASS", "2026-06-10T10:00:00Z", [
      { claim: "pullback of 15%", kind: "reentry_condition" },
      { claim: "revenue grows", kind: "forecast" },
    ]);
    const [cond, fc] = d.predictionIds as [string, string];
    await expect(predictions(foreignId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(predictions(investorId).resolveReentryCondition({ predictionId: fc, status: "confirmed", note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const r1 = await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "it dipped 16%" });
    expect(r1).toMatchObject({ replayed: false, prediction: { status: "confirmed", resolutionNote: "it dipped 16%", resolvedByReviewId: null } });
    expect(r1.prediction.resolvedAt).not.toBeNull();
    const r2 = await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "it dipped 16%" });
    expect(r2.replayed).toBe(true);
    await expect(predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "refuted", note: "changed my mind" })).rejects.toMatchObject({ code: "CONFLICT" });
    const row = (await db.select().from(schema.predictions).where(eq(schema.predictions.id, cond)))[0]!;
    expect(row).toMatchObject({ status: "confirmed", resolutionNote: "it dipped 16%", resolvedByReviewId: null });
    // the review then needs only the forecast, and sees the condition as already resolved
    expect(await reviews(investorId).pendingPredictions({ decisionId: d.decisionId })).toHaveLength(1);
    await reviews(investorId).generate({ decisionId: d.decisionId, idempotencyKey: randomUUID(), predictionResolutions: [{ predictionId: fc, status: "inconclusive", note: "too early" }] });
    const input = cap.reviewInputs.at(-1) as ReviewInput;
    expect(input.predictionsWithResolutions).toEqual(
      expect.arrayContaining([
        { claimText: "pullback of 15%", kind: "reentry_condition", status: "confirmed", resolutionNote: "it dipped 16%" },
        { claimText: "revenue grows", kind: "forecast", status: "inconclusive", resolutionNote: "too early" },
      ])
    );
  });

  it("a standalone resolution landing while a review is being generated makes that review fail closed (nothing written, no double resolution)", async () => {
    const d = await mkDecision(investorId, "RAC", "BUY", "2026-06-10T10:00:00Z", [{ claim: "reconsider if guidance drops", kind: "reentry_condition" }]);
    const cond = d.predictionIds[0]!;
    cap.duringReview = async () => {
      await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "guidance dropped" });
    };
    const err = await reviews(investorId).generate({ decisionId: d.decisionId, idempotencyKey: randomUUID(), predictionResolutions: [{ predictionId: cond, status: "refuted", note: "review says no" }] }).catch((e) => e);
    expect(codeOf(err)).toBe("CONFLICT");
    expect(await db.select().from(schema.decisionReviews).where(eq(schema.decisionReviews.decisionId, d.decisionId))).toEqual([]);
    expect((await db.select().from(schema.predictions).where(eq(schema.predictions.id, cond)))[0]).toMatchObject({ status: "confirmed", resolutionNote: "guidance dropped" });
  });

  it("open conditions: only this investor's pending re-entry conditions, most recent decision first; a resolved one disappears", async () => {
    const owner = await mkInvestor(db, "follow-through-open");
    const sv = (await db.insert(schema.strategyVersions).values({ investorId: owner, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
    const older = await mkDecision(owner, "OPN", "PASS", "2026-05-01T10:00:00Z", [{ claim: "older cond", kind: "reentry_condition" }, { claim: "older forecast", kind: "forecast" }], sv);
    const newer = await mkDecision(owner, "OPX", "BUY", "2026-06-01T10:00:00Z", [{ claim: "newer cond", kind: "reentry_condition" }], sv);
    await mkDecision(investorId, "OPZ", "PASS", "2026-07-01T10:00:00Z", [{ claim: "foreign cond", kind: "reentry_condition" }]);
    const open = await predictions(owner).openReentryConditions();
    expect(open.map((c) => [c.claimText, c.ticker, c.decisionType, c.decisionId])).toEqual([
      ["newer cond", "OPX", "BUY", newer.decisionId],
      ["older cond", "OPN", "PASS", older.decisionId],
    ]);
    await predictions(owner).resolveReentryCondition({ predictionId: newer.predictionIds[0]!, status: "refuted", note: "did not fire" });
    expect((await predictions(owner).openReentryConditions()).map((c) => c.claimText)).toEqual(["older cond"]);
  });
});

describe("reconsideration case from a confirmed condition", () => {
  it("requires a CONFIRMED re-entry condition of the investor; one case per condition (repeat and race return it); the origin is frozen into the decision snapshot and never reaches the Decision AI as a resolution", async () => {
    const d = await mkDecision(investorId, "RCN", "PASS", "2026-06-10T10:00:00Z", [
      { claim: "pullback first", kind: "reentry_condition" },
      { claim: "demand grows", kind: "forecast" },
    ]);
    const [cond, fc] = d.predictionIds as [string, string];
    await expect(cases(investorId).createFromCondition({ predictionId: cond })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // pending
    await expect(cases(investorId).createFromCondition({ predictionId: fc })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // forecast
    await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "it pulled back" });
    await expect(cases(foreignId).createFromCondition({ predictionId: cond })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [c1, c2] = await Promise.all([cases(investorId).createFromCondition({ predictionId: cond }), cases(investorId).createFromCondition({ predictionId: cond })]);
    expect(c1.id).toBe(c2.id);
    expect(c1).toMatchObject({ ticker: "RCN", status: "researching", originPredictionId: cond, investorId });
    expect((await cases(investorId).createFromCondition({ predictionId: cond })).id).toBe(c1.id);
    expect(await db.select().from(schema.investmentCases).where(and(eq(schema.investmentCases.originPredictionId, cond)))).toHaveLength(1);
    expect(await cases(investorId).originCondition({ caseId: c1.id })).toMatchObject({ predictionId: cond, claimText: "pullback first", status: "confirmed", resolutionNote: "it pulled back", decisionId: d.decisionId, decisionType: "PASS" });
    expect(await cases(investorId).originCondition({ caseId: d.caseId })).toBeNull();

    const r = await decisions(investorId).create({ caseId: c1.id, decisionType: "BUY", sizeDollars: 300, reasoningText: "now it fits", reviewHorizon: { choice: "none" } });
    const snap = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r.decision.id) }))!;
    expect((snap.investmentCaseSnapshotJson as { originPredictionId?: string }).originPredictionId).toBe(cond);
    // the prior record (frozen and given to the AI) shows the PASS with its claims counted as resolved — never how they resolved
    const ai = cap.decisionInputs.at(-1) as DecisionContextInput;
    const prior = ai.priorRecord.decisions.find((x) => x.decisionId === d.decisionId)!;
    expect(prior).toMatchObject({ decisionType: "PASS", resolvedClaimCount: 1, pendingClaims: [{ kind: "forecast", claimText: "demand grows" }] });
    expect(JSON.stringify(ai.priorRecord)).not.toMatch(/it pulled back|confirmed|originPredictionId/);
  });
});
