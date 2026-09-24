// Decision Follow-Through V1 — adversarial evidence pass on the REAL routers
// and the real Postgres (authorized scratch DB only): the execution-fact
// chain as append-only historical truth (application rules, locking, and the
// database's own constraints), ownership with foreign and guessed ids,
// concurrency with exact row counts, atomicity, and the frozen/learned state
// that post-decision facts must never touch. Mocked: the two AI calls
// (inputs captured), the FMP fetches.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const cap = vi.hoisted(() => ({ decisionInputs: [] as unknown[], reviewInputs: [] as unknown[], marketContextId: "" }));
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
    return { narrativeSummaryText: "mock", thesisAccuracy: "insufficient_evidence", dimensions: [] };
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
import { decisionsRouter } from "@/server/routers/decisions";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis } from "@/db/repositories/decisions";
import { updateInvestmentCase } from "@/db/repositories/ideas-cases";
import * as executionRepo from "@/db/repositories/execution-facts";
import { isUniqueViolation } from "@/db/errors";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(client, { schema });
const session = (investorId: string) => ({ session: { investorId } }) as never;
const executions = (i: string) => executionsRouter.createCaller(session(i));
const predictions = (i: string) => predictionsRouter.createCaller(session(i));
const cases = (i: string) => casesRouter.createCaller(session(i));
const decisions = (i: string) => decisionsRouter.createCaller(session(i));
const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
const codeOf = (e: unknown) => (e as TRPCError).code;
const TZ = "UTC";

let investorId: string, foreignId: string, strategyVersionId: string;

async function mkTrade(owner: string, ticker: string, type: "buy" | "sell", qty: string, price: string, date: string) {
  return (await db.insert(schema.transactions).values({ investorId: owner, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? `-${Number(qty) * Number(price)}` : `${Number(qty) * Number(price)}`, transactionDate: at(date), source: "manual_entry" }).returning())[0]!.id;
}
async function mkDecision(owner: string, ticker: string, type: "BUY" | "PASS", date: string, preds: { claim: string; kind: "forecast" | "reentry_condition" }[] = []) {
  const sv = owner === investorId ? strategyVersionId : (await db.select().from(schema.strategyVersions).where(eq(schema.strategyVersions.investorId, owner)))[0]!.id;
  const [c] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker, status: "decided" }).returning();
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c!.id, ticker, decisionType: type, decisionDate: at(date) });
  const th = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", size: type === "PASS" ? null : "500", userReasoningText: `reasoning ${ticker}`, portfolioStateJson: { cash: 0, positions: [] }, marketContextId: cap.marketContextId, strategyVersionId: sv, thesisId: th.id, investmentCaseSnapshotJson: {} }, []);
  const predictionIds: string[] = [];
  for (const p of preds) predictionIds.push((await insertPrediction(db, { thesisId: th.id, claimText: p.claim, kind: p.kind })).id);
  return { decisionId: d.id, caseId: c!.id, predictionIds };
}
const factsOf = (decisionId: string) => db.select().from(schema.decisionExecutionFacts).where(eq(schema.decisionExecutionFacts.decisionId, decisionId)).orderBy(schema.decisionExecutionFacts.createdAt);
const assertFact = (owner: string, decisionId: string, transactionId: string, verdict: "executed" | "unrelated", extra: { note?: string; supersedesFactId?: string } = {}) =>
  executions(owner).assert({ decisionId, transactionId, verdict, timeZone: TZ, ...extra });
const failureOf = (p: Promise<unknown>): Promise<Error> => p.then(() => new Error("did not fail"), (e) => e as Error);

beforeAll(async () => {
  investorId = await mkInvestor(db, "dft-adversarial");
  foreignId = await mkInvestor(db, "dft-adversarial-foreign");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  await db.insert(schema.strategyVersions).values({ investorId: foreignId, versionNumber: 1, changeSummary: "f" });
  cap.marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("1. execution-fact chain is append-only historical truth", () => {
  it("F1 unrelated → F2 executed supersedes F1: F1 persisted unchanged, F2 effective, history reconstructible; replays and refusals afterwards", async () => {
    const d = await mkDecision(investorId, "CHN", "BUY", "2026-06-10T10:00:00Z");
    const t = await mkTrade(investorId, "CHN", "buy", "1", "10", "2026-06-12");
    const f1 = (await assertFact(investorId, d.decisionId, t, "unrelated", { note: "not this one" })).fact;
    const f1Row = (await factsOf(d.decisionId))[0]!;
    const f2 = (await assertFact(investorId, d.decisionId, t, "executed", { note: "actually yes", supersedesFactId: f1.id })).fact;

    const rows = await factsOf(d.decisionId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === f1.id)).toEqual(f1Row); // F1: same row, byte for byte
    expect(rows.find((r) => r.id === f2.id)).toMatchObject({ verdict: "executed", note: "actually yes", supersedesFactId: f1.id });
    const effective = await executionRepo.loadEffectiveExecutionFactsForDecision(db, d.decisionId);
    expect(effective.map((f) => [f.id, f.verdict])).toEqual([[f2.id, "executed"]]);
    // history reconstructs F1 as the superseded state (chain walk)
    const chain = rows.map((r) => ({ id: r.id, verdict: r.verdict, supersedes: r.supersedesFactId }));
    expect(chain).toEqual(expect.arrayContaining([{ id: f1.id, verdict: "unrelated", supersedes: null }, { id: f2.id, verdict: "executed", supersedes: f1.id }]));

    // replaying F1's assertion after a successor exists is a conflict (effective is F2); replaying F2 replays
    expect(codeOf(await assertFact(investorId, d.decisionId, t, "unrelated", { note: "not this one" }).catch((e) => e))).toBe("BAD_REQUEST");
    expect(await assertFact(investorId, d.decisionId, t, "executed", { note: "actually yes" })).toMatchObject({ replayed: true, fact: { id: f2.id } });
    // superseding a non-head (F1 again) → refused; superseding the head with the same verdict → replay (no row)
    expect((await failureOf(assertFact(investorId, d.decisionId, t, "unrelated", { supersedesFactId: f1.id }))).message).toMatch(/already has a successor/);
    // an identical RETRY of the F1→F2 supersession (lost response) replays F2 — no error, no fork
    expect(await assertFact(investorId, d.decisionId, t, "executed", { note: "actually yes", supersedesFactId: f1.id })).toMatchObject({ replayed: true, fact: { id: f2.id } });
    expect((await assertFact(investorId, d.decisionId, t, "executed", { note: "actually yes", supersedesFactId: f2.id })).replayed).toBe(true);
    expect(await factsOf(d.decisionId)).toHaveLength(2);
    expect(await db.select().from(schema.decisionExecutionFacts).where(eq(schema.decisionExecutionFacts.id, f1.id))).toEqual([f1Row]);
  });

  it("the database itself refuses a second root for a pair, a second successor (fork), and self-supersession (cycle)", async () => {
    const d = await mkDecision(investorId, "DBC", "BUY", "2026-06-10T10:00:00Z");
    const t = await mkTrade(investorId, "DBC", "buy", "1", "10", "2026-06-12");
    const f1 = (await assertFact(investorId, d.decisionId, t, "executed")).fact;
    const f2 = (await assertFact(investorId, d.decisionId, t, "unrelated", { supersedesFactId: f1.id })).fact;
    const raw = (values: Partial<typeof schema.decisionExecutionFacts.$inferInsert>) =>
      db.insert(schema.decisionExecutionFacts).values({ investorId, decisionId: d.decisionId, transactionId: t, verdict: "executed", ...values }).then(() => null, (e: unknown) => e);
    expect(isUniqueViolation(await raw({}), "decision_execution_facts_root_pair_unique")).toBe(true); // second root
    expect(isUniqueViolation(await raw({ supersedesFactId: f1.id }), "decision_execution_facts_supersedes_unique")).toBe(true); // fork
    const selfId = randomUUID();
    const cycle = (await raw({ id: selfId, supersedesFactId: selfId })) as { cause?: { code?: string; constraint_name?: string } };
    expect(cycle.cause?.code).toBe("23514"); // check_violation
    expect(cycle.cause?.constraint_name).toBe("decision_execution_facts_no_self_supersession");
    expect((await factsOf(d.decisionId)).map((r) => r.id).sort()).toEqual([f1.id, f2.id].sort());
    // and the repository module exposes no update/delete
    expect(Object.keys(executionRepo).sort()).toEqual(["ExecutionFactValidationError", "insertDecisionExecutionFact", "loadEffectiveExecutionFactsForDecision"]);
  });

  it("superseding across decisions, across transactions, or another investor's fact is refused with a neutral message", async () => {
    const d1 = await mkDecision(investorId, "XSU", "BUY", "2026-06-10T10:00:00Z");
    const d2 = await mkDecision(investorId, "XSU", "BUY", "2026-06-11T10:00:00Z");
    const t1 = await mkTrade(investorId, "XSU", "buy", "1", "10", "2026-06-12");
    const t2 = await mkTrade(investorId, "XSU", "buy", "1", "10", "2026-06-13");
    const own = (await assertFact(investorId, d1.decisionId, t1, "executed")).fact;
    expect((await failureOf(assertFact(investorId, d2.decisionId, t1, "executed", { supersedesFactId: own.id }))).message).toMatch(/not a fact of this decision/);
    expect((await failureOf(assertFact(investorId, d1.decisionId, t2, "executed", { supersedesFactId: own.id }))).message).toMatch(/only be superseded by one about the same trade/);
    const fd = await mkDecision(foreignId, "XSU", "BUY", "2026-06-10T10:00:00Z");
    const ft = await mkTrade(foreignId, "XSU", "buy", "1", "10", "2026-06-12");
    const theirs = (await assertFact(foreignId, fd.decisionId, ft, "executed")).fact;
    const err = await failureOf(assertFact(investorId, d1.decisionId, t1, "unrelated", { supersedesFactId: theirs.id }));
    expect(err.message).toMatch(/not a fact of this decision/);
    expect(err.message).not.toMatch(new RegExp(foreignId));
    expect(await factsOf(d1.decisionId)).toHaveLength(1);
    expect(await factsOf(fd.decisionId)).toHaveLength(1);
  });
});

describe("2. concurrency with exact row counts", () => {
  it("C: two supersessions of the same head — identical ones converge (one successor row), a differing one is refused", async () => {
    const d = await mkDecision(investorId, "CC2", "BUY", "2026-06-10T10:00:00Z");
    const t = await mkTrade(investorId, "CC2", "buy", "1", "10", "2026-06-12");
    const head = (await assertFact(investorId, d.decisionId, t, "executed")).fact;
    const identical = await Promise.all([1, 2, 3].map(() => assertFact(investorId, d.decisionId, t, "unrelated", { supersedesFactId: head.id })));
    expect(new Set(identical.map((r) => r.fact.id)).size).toBe(1);
    expect(identical.filter((r) => r.replayed)).toHaveLength(2);
    expect(await factsOf(d.decisionId)).toHaveLength(2);
    const d2 = await mkDecision(investorId, "CC3", "BUY", "2026-06-10T10:00:00Z");
    const t2 = await mkTrade(investorId, "CC3", "buy", "1", "10", "2026-06-12");
    const head2 = (await assertFact(investorId, d2.decisionId, t2, "executed")).fact;
    const differing = await Promise.allSettled([
      assertFact(investorId, d2.decisionId, t2, "unrelated", { note: "a", supersedesFactId: head2.id }),
      assertFact(investorId, d2.decisionId, t2, "unrelated", { note: "b", supersedesFactId: head2.id }),
    ]);
    expect(differing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(differing.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await factsOf(d2.decisionId)).toHaveLength(2);
    expect((await executionRepo.loadEffectiveExecutionFactsForDecision(db, d2.decisionId)).map((f) => f.verdict)).toEqual(["unrelated"]);
  });

  it("D: standalone resolution × 5 — one resolution, four replays, review id NULL", async () => {
    const d = await mkDecision(investorId, "CRS", "PASS", "2026-06-10T10:00:00Z", [{ claim: "pullback", kind: "reentry_condition" }]);
    const cond = d.predictionIds[0]!;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "it fell 12%" })));
    expect(results.filter((r) => r.replayed)).toHaveLength(4);
    const row = (await db.select().from(schema.predictions).where(eq(schema.predictions.id, cond)))[0]!;
    expect(row).toMatchObject({ status: "confirmed", resolutionNote: "it fell 12%", resolvedByReviewId: null });
    expect(row.resolvedAt).not.toBeNull();
  });

  it("F: createFromCondition × 5 — one case row", async () => {
    const d = await mkDecision(investorId, "CRC", "PASS", "2026-06-10T10:00:00Z", [{ claim: "pullback", kind: "reentry_condition" }]);
    const cond = d.predictionIds[0]!;
    await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "yes" });
    const created = await Promise.all([1, 2, 3, 4, 5].map(() => cases(investorId).createFromCondition({ predictionId: cond })));
    expect(new Set(created.map((c) => c.id)).size).toBe(1);
    expect(await db.select().from(schema.investmentCases).where(eq(schema.investmentCases.originPredictionId, cond))).toHaveLength(1);
  });
});

describe("3. ownership: foreign and guessed ids never disclose anything", () => {
  it("every new procedure answers NOT_FOUND / neutral BAD_REQUEST", async () => {
    const own = await mkDecision(investorId, "OWN", "BUY", "2026-06-10T10:00:00Z", [{ claim: "c", kind: "reentry_condition" }]);
    const theirs = await mkDecision(foreignId, "OWN", "BUY", "2026-06-10T10:00:00Z", [{ claim: "c", kind: "reentry_condition" }]);
    const theirTrade = await mkTrade(foreignId, "OWN", "buy", "1", "10", "2026-06-12");
    const ownTrade = await mkTrade(investorId, "OWN", "buy", "1", "10", "2026-06-12");
    const [theirCase] = await db.insert(schema.investmentCases).values({ investorId: foreignId, ticker: "OWN" }).returning();
    const guess = randomUUID();
    const expectCode = async (p: Promise<unknown>, code: string, re?: RegExp) => {
      const err = await p.then(() => null, (e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(codeOf(err)).toBe(code);
      if (re) expect((err as Error).message).toMatch(re);
      expect((err as Error).message).not.toMatch(new RegExp(foreignId));
    };
    for (const decisionId of [theirs.decisionId, guess]) {
      await expectCode(executions(investorId).candidates({ decisionId, timeZone: TZ }), "NOT_FOUND");
      await expectCode(executions(investorId).forDecision({ decisionId }), "NOT_FOUND");
      await expectCode(assertFact(investorId, decisionId, ownTrade, "executed"), "NOT_FOUND");
    }
    for (const transactionId of [theirTrade, guess]) await expectCode(assertFact(investorId, own.decisionId, transactionId, "executed"), "BAD_REQUEST", /Unknown transaction/);
    for (const predictionId of [theirs.predictionIds[0]!, guess]) {
      await expectCode(predictions(investorId).resolveReentryCondition({ predictionId, status: "confirmed", note: "x" }), "NOT_FOUND");
      await expectCode(cases(investorId).createFromCondition({ predictionId }), "NOT_FOUND");
    }
    for (const caseId of [theirCase!.id, guess]) await expectCode(cases(investorId).originCondition({ caseId }), "NOT_FOUND");
    // the foreign investor's own view is untouched by any of the above
    expect(await factsOf(theirs.decisionId)).toHaveLength(0);
    expect((await db.select().from(schema.predictions).where(eq(schema.predictions.id, theirs.predictionIds[0]!)))[0]!.status).toBe("pending");
  });
});

describe("4. post-decision facts touch nothing frozen or learned", () => {
  it("snapshot, frozen prior record, DNA/Strategy/Learning tables and the Decision AI input are byte-identical across assertions and resolutions", async () => {
    const prior = await mkDecision(investorId, "FRZ", "PASS", "2026-06-01T10:00:00Z", [{ claim: "reconsider on a dip", kind: "reentry_condition" }]);
    await mkTrade(investorId, "FRZ", "buy", "1", "10", "2026-06-20");
    const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "FRZ" }).returning();
    const r = await decisions(investorId).create({ caseId: c!.id, decisionType: "BUY", decisionDate: "2026-06-22T10:00:00Z", sizeDollars: 300, reasoningText: "buy", reviewHorizon: { choice: "none" } });
    const trade = await mkTrade(investorId, "FRZ", "buy", "3", "10", "2026-06-25");
    const snapshotBefore = JSON.stringify(await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r.decision.id) }));
    const decisionBefore = JSON.stringify(await db.query.decisions.findFirst({ where: (d, { eq }) => eq(d.id, r.decision.id) }));
    const counts = async () =>
      Promise.all(
        [schema.evidence, schema.dnaHypothesisVersions, schema.strategyPrincipleVersions, schema.learningInsights, schema.decisionReviews, schema.laterContexts].map(async (t) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n)
      );
    const countsBefore = await counts();
    const aiCallsBefore = cap.decisionInputs.length + cap.reviewInputs.length;

    await assertFact(investorId, r.decision.id, trade, "executed", { note: "done" });
    await predictions(investorId).resolveReentryCondition({ predictionId: prior.predictionIds[0]!, status: "confirmed", note: "dipped" });
    await cases(investorId).createFromCondition({ predictionId: prior.predictionIds[0]! });

    expect(JSON.stringify(await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r.decision.id) }))).toBe(snapshotBefore);
    expect(JSON.stringify(await db.query.decisions.findFirst({ where: (d, { eq }) => eq(d.id, r.decision.id) }))).toBe(decisionBefore);
    expect(await counts()).toEqual(countsBefore);
    expect(cap.decisionInputs.length + cap.reviewInputs.length).toBe(aiCallsBefore);
    // the live prior record for a new case reflects the resolution as a resolved claim but carries no execution facts
    const [next] = await db.insert(schema.investmentCases).values({ investorId, ticker: "FRZ" }).returning();
    const live = await cases(investorId).priorRecord({ caseId: next!.id });
    expect(JSON.stringify(live)).not.toMatch(/executed|unrelated|executionFacts|done/);
    expect(live.decisions.find((d) => d.decisionId === prior.decisionId)!.predictions[0]).toMatchObject({ status: "confirmed", resolutionNote: "dipped" });
    // Decision AI input never contained execution facts
    expect(JSON.stringify(cap.decisionInputs)).not.toMatch(/executionFacts|"executed"/);
  });
});

describe("5. origin provenance is stable; legacy cases never infer one", () => {
  it("later research activity never changes the origin; the snapshot freezes it; a legacy case stays origin-less", async () => {
    const d = await mkDecision(investorId, "ORG", "PASS", "2026-06-01T10:00:00Z", [{ claim: "cheaper entry", kind: "reentry_condition" }]);
    const cond = d.predictionIds[0]!;
    await predictions(investorId).resolveReentryCondition({ predictionId: cond, status: "confirmed", note: "it got cheaper" });
    const c = await cases(investorId).createFromCondition({ predictionId: cond });
    expect(c).toMatchObject({ originPredictionId: cond, ticker: "ORG", status: "researching", marketIntelligenceJson: null, personalFitText: null, bullCaseText: null, synthesisText: null });
    // research activity through the mutable-case write path
    await updateInvestmentCase(db, c.id, { bullCaseText: "bull", bearCaseText: "bear", marketIntelligenceJson: { price: 1 }, personalFitText: "fit" });
    const after = (await db.select().from(schema.investmentCases).where(eq(schema.investmentCases.id, c.id)))[0]!;
    expect(after.originPredictionId).toBe(cond);
    expect(await cases(investorId).originCondition({ caseId: c.id })).toMatchObject({ predictionId: cond, claimText: "cheaper entry", decisionId: d.decisionId, ticker: "ORG" });
    const r = await decisions(investorId).create({ caseId: c.id, decisionType: "BUY", sizeDollars: 100, reasoningText: "now", reviewHorizon: { choice: "none" } });
    const frozen = (await db.query.decisionSnapshots.findFirst({ where: (s, { eq }) => eq(s.decisionId, r.decision.id) }))!.investmentCaseSnapshotJson as { originPredictionId?: string; bullCaseText?: string };
    expect(frozen).toMatchObject({ originPredictionId: cond, bullCaseText: "bull" });
    // legacy: ordinary case, no origin, nothing inferred from the same ticker's confirmed condition
    const [legacy] = await db.insert(schema.investmentCases).values({ investorId, ticker: "ORG" }).returning();
    expect(legacy!.originPredictionId).toBeNull();
    expect(await cases(investorId).originCondition({ caseId: legacy!.id })).toBeNull();
  });
});
