// Decision Review Integrity V1 — the PRODUCTION reviews.generate path and
// persistDecisionReviewAtomic() on the authorized test database only
// (tests/support). The AI review call and the market-data fetch are mocked;
// everything else (ownership, fingerprints, locks, revalidation, inserts,
// resolutions, the unique index) is the real code and the real Postgres.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ai = vi.hoisted(() => ({ calls: 0, fail: false, during: async (): Promise<void> => {} }));
vi.mock("@/lib/ai/review", () => ({
  synthesizeDecisionReview: async () => {
    ai.calls += 1;
    if (ai.fail) throw new Error("injected AI failure");
    await ai.during();
    return {
      narrativeSummaryText: `mock narrative ${ai.calls}`,
      thesisAccuracy: "inconclusive",
      dimensions: ["thesis_quality", "evidence_quality", "risk_awareness", "valuation_awareness", "portfolio_fit", "strategy_consistency", "exit_conditions"].map((dimension) => ({
        dimension, verdict: "reasonable", rationaleText: "mock rationale", citedSnapshotFields: ["userReasoningText"],
      })),
    };
  },
}));
vi.mock("@/lib/market/market-intelligence", () => ({ getMarketIntelligence: async () => { throw new Error("no market data in tests"); } }));

import { reviewsRouter } from "@/server/routers/reviews";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis, persistDecisionReviewAtomic } from "@/db/repositories/decisions";
import { computeReviewInputStateFingerprint, computeReviewRequestFingerprint } from "@/lib/review/review-fingerprint";
import { loadDecisionAttention } from "@/lib/monitoring/load-decision-attention";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 12 });
const db = drizzle(client, { schema });
const caller = (investorId: string) => reviewsRouter.createCaller({ session: { investorId } } as never);
let investorId: string, strategyVersionId: string, marketContextId: string;

async function mkDecision(nPredictions: number, owner = investorId) {
  const [c] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker: "RVI" }).returning();
  const d = await insertDecision(db, { investorId: owner, investmentCaseId: c!.id, ticker: "RVI", decisionType: "BUY", decisionDate: new Date("2026-08-01T10:00:00Z") });
  const thesis = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", userReasoningText: "r", portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: thesis.id, investmentCaseSnapshotJson: {} }, []);
  const predictionIds: string[] = [];
  for (let i = 0; i < nPredictions; i++) predictionIds.push((await insertPrediction(db, { thesisId: thesis.id, claimText: `claim ${i}` })).id);
  return { decisionId: d.id, thesisId: thesis.id, predictionIds };
}
const resolveAll = (ids: string[], status: "confirmed" | "refuted" | "inconclusive" = "confirmed", note = "note") => ids.map((predictionId) => ({ predictionId, status, note }));
const reviewsOf = (decisionId: string) => db.select().from(schema.decisionReviews).where(eq(schema.decisionReviews.decisionId, decisionId));
const dimsOf = async (decisionId: string) => {
  const ids = (await reviewsOf(decisionId)).map((r) => r.id);
  return ids.length ? db.select().from(schema.reviewDimensions).where(inArray(schema.reviewDimensions.decisionReviewId, ids)) : [];
};
const predsOf = (ids: string[]) => db.select().from(schema.predictions).where(inArray(schema.predictions.id, ids));
const codeOf = (e: unknown) => (e as TRPCError).code;

beforeAll(async () => {
  investorId = await mkInvestor(db, "review-integrity");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
beforeEach(() => {
  ai.fail = false;
  ai.during = async () => {};
});
afterAll(async () => {
  await client.end();
});

describe("migration 0014 on the scratch DB", () => {
  it("adds three nullable text columns and the partial unique index; legacy NULL-key reviews stay valid and repeatable", async () => {
    const cols = await db.execute(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'decision_reviews' and column_name in ('idempotency_key','request_fingerprint','input_state_fingerprint') order by column_name`);
    expect(cols.map((c) => [c.column_name, c.data_type, c.is_nullable, c.column_default])).toEqual([
      ["idempotency_key", "text", "YES", null], ["input_state_fingerprint", "text", "YES", null], ["request_fingerprint", "text", "YES", null],
    ]);
    const [idx] = await db.execute(`select indexdef from pg_indexes where indexname = 'decision_reviews_decision_idempotency_key_unique'`);
    expect(String(idx!.indexdef)).toMatch(/UNIQUE INDEX .* \(decision_id, idempotency_key\) WHERE \(idempotency_key IS NOT NULL\)/);
    // (14) legacy: NULL-key rows never collide, and a decision with legacy reviews still takes a new one
    const { decisionId } = await mkDecision(0);
    for (let i = 0; i < 2; i++) await db.insert(schema.decisionReviews).values({ decisionId, narrativeSummaryText: "legacy", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {} });
    const r = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    expect(r.replayed).toBe(false);
    const rows = await reviewsOf(decisionId);
    expect(rows).toHaveLength(3);
    expect(rows.filter((x) => x.idempotencyKey === null)).toHaveLength(2);
  });
});

describe("successful reviews commit review + dimensions + resolutions together", () => {
  it("(1) zero pending predictions succeeds and stores the key and both fingerprints", async () => {
    const { decisionId } = await mkDecision(0);
    const key = randomUUID();
    const r = await caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: [] });
    expect(r).toMatchObject({ replayed: false, review: { decisionId, idempotencyKey: key } });
    expect(r.review.requestFingerprint).toBe(computeReviewRequestFingerprint({ decisionId, resolutions: [] }));
    expect(r.review.inputStateFingerprint).toBe(computeReviewInputStateFingerprint([]));
    expect(r.dimensions).toHaveLength(7);
    expect(await dimsOf(decisionId)).toHaveLength(7);
  });
  it("(2)(3) one and several predictions: every resolution points at the new review, with its note and a time", async () => {
    for (const n of [1, 3]) {
      const { decisionId, predictionIds } = await mkDecision(n);
      const r = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds, "refuted", "did not happen") });
      const preds = await predsOf(predictionIds);
      expect(preds.every((p) => p.status === "refuted" && p.resolvedByReviewId === r.review.id && p.resolutionNote === "did not happen" && p.resolvedAt !== null)).toBe(true);
      expect(await dimsOf(decisionId)).toHaveLength(7);
    }
  });
  it("(9) two deliberate reviews with different keys and zero pending predictions: two rows", async () => {
    const { decisionId } = await mkDecision(0);
    await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    expect(await reviewsOf(decisionId)).toHaveLength(2);
  });
});

describe("atomicity — nothing half-written", () => {
  const prepared = async (n: number) => {
    const d = await mkDecision(n);
    const preds = await predsOf(d.predictionIds);
    return { ...d, inputStateFingerprint: computeReviewInputStateFingerprint(preds) };
  };
  const reviewValues = { narrativeSummaryText: "x", decisionQualityOverall: "reasonable" as const, thesisAccuracy: "inconclusive" as const, outcomeJson: {} };
  const dims = ["thesis_quality", "evidence_quality"].map((dimension) => ({ dimension: dimension as "thesis_quality", verdict: "reasonable" as const, rationaleText: "r", citedSnapshotFields: [] }));
  it("(4) a failure while persisting the resolutions rolls back the review, its dimensions and every earlier resolution", async () => {
    const d = await prepared(2);
    const resolutions = [{ predictionId: d.predictionIds[0]!, status: "confirmed" as const, note: "ok" }, { predictionId: d.predictionIds[1]!, status: "not-a-status" as never, note: "boom" }];
    const err = await persistDecisionReviewAtomic(db, { investorId, decisionId: d.decisionId, idempotencyKey: randomUUID(), requestFingerprint: "v1:x", inputStateFingerprint: d.inputStateFingerprint, review: reviewValues, dimensions: dims, resolutions }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await reviewsOf(d.decisionId)).toEqual([]);
    expect(await dimsOf(d.decisionId)).toEqual([]);
    expect((await predsOf(d.predictionIds)).map((p) => [p.status, p.resolvedByReviewId])).toEqual([["pending", null], ["pending", null]]);
  });
  it("(13) a failure while inserting the dimensions rolls back everything", async () => {
    const d = await prepared(1);
    const badDims = [...dims, { ...dims[0]!, dimension: "not-a-dimension" as never }];
    const err = await persistDecisionReviewAtomic(db, { investorId, decisionId: d.decisionId, idempotencyKey: randomUUID(), requestFingerprint: "v1:x", inputStateFingerprint: d.inputStateFingerprint, review: reviewValues, dimensions: badDims, resolutions: resolveAll(d.predictionIds) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await reviewsOf(d.decisionId)).toEqual([]);
    expect((await predsOf(d.predictionIds))[0]!.status).toBe("pending");
  });
});

describe("stale state fails closed", () => {
  it("(5) a prediction resolved while the AI call is in flight → CONFLICT, zero reviews from the stale request, no automatic AI re-run", async () => {
    const { decisionId, predictionIds } = await mkDecision(2);
    ai.during = async () => {
      await db.update(schema.predictions).set({ status: "refuted", resolvedAt: new Date(), resolutionNote: "out of band" }).where(eq(schema.predictions.id, predictionIds[1]!));
    };
    const before = ai.calls;
    const err = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds) }).catch((e) => e);
    expect(codeOf(err)).toBe("CONFLICT");
    expect((err as Error).message).toMatch(/Prediction state changed/);
    expect(ai.calls).toBe(before + 1);
    expect(await reviewsOf(decisionId)).toEqual([]);
    expect((await predsOf([predictionIds[0]!]))[0]!.status).toBe("pending");
  });
  it("(11) a prediction already resolved before the request → BAD_REQUEST, no AI, no write", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    await db.update(schema.predictions).set({ status: "confirmed", resolvedAt: new Date(), resolutionNote: "earlier" }).where(eq(schema.predictions.id, predictionIds[0]!));
    const before = ai.calls;
    const err = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds) }).catch((e) => e);
    expect(codeOf(err)).toBe("BAD_REQUEST");
    expect(ai.calls).toBe(before);
    expect(await reviewsOf(decisionId)).toEqual([]);
  });
  it("(12) AI failure → no review, no prediction mutation", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    ai.fail = true;
    const err = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds) }).catch((e) => e);
    expect((err as Error).message).toMatch(/injected AI failure/);
    expect(await reviewsOf(decisionId)).toEqual([]);
    expect((await predsOf(predictionIds))[0]!.status).toBe("pending");
  });
  it("(10) a foreign investor → NOT_FOUND, no AI, no write", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    const foreign = await mkInvestor(db, "review-integrity-foreign");
    const before = ai.calls;
    const err = await caller(foreign).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds) }).catch((e) => e);
    expect(codeOf(err)).toBe("NOT_FOUND");
    expect(ai.calls).toBe(before);
    expect(await reviewsOf(decisionId)).toEqual([]);
    const direct = await persistDecisionReviewAtomic(db, { investorId: foreign, decisionId, idempotencyKey: randomUUID(), requestFingerprint: "v1:x", inputStateFingerprint: "v1:y", review: { narrativeSummaryText: "x", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {} }, dimensions: [], resolutions: [] }).catch((e) => e);
    expect((direct as Error).constructor.name).toBe("ReviewDecisionNotFoundError");
  });
  it("a duplicated prediction in one submission is refused before AI", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    const before = ai.calls;
    const err = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [...resolveAll(predictionIds), ...resolveAll(predictionIds, "refuted")] }).catch((e) => e);
    expect(codeOf(err)).toBe("BAD_REQUEST");
    expect(ai.calls).toBe(before);
  });
});

describe("idempotency", () => {
  it("(7) the same key + same payload after a committed (lost) response returns the existing review: no AI, no write", async () => {
    const { decisionId, predictionIds } = await mkDecision(2);
    const key = randomUUID();
    const first = await caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: resolveAll(predictionIds) });
    const calls = ai.calls;
    const again = await caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: resolveAll(predictionIds).reverse() });
    expect(again.replayed).toBe(true);
    expect(again.review.id).toBe(first.review.id);
    expect(again.dimensions).toHaveLength(7);
    expect(ai.calls).toBe(calls);
    expect(await reviewsOf(decisionId)).toHaveLength(1);
  });
  it("(8) the same key + a different payload → CONFLICT before AI, no second review", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    const key = randomUUID();
    await caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: resolveAll(predictionIds, "confirmed", "a") });
    const calls = ai.calls;
    for (const changed of [resolveAll(predictionIds, "confirmed", "b"), resolveAll(predictionIds, "refuted", "a"), []]) {
      const err = await caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: changed }).catch((e) => e);
      expect(codeOf(err)).toBe("CONFLICT");
    }
    expect(ai.calls).toBe(calls);
    expect(await reviewsOf(decisionId)).toHaveLength(1);
  });
  it("(6) N concurrent requests with the same key + payload → exactly one review, one resolution set, every response is that review, no 500", async () => {
    const { decisionId, predictionIds } = await mkDecision(2);
    const key = randomUUID();
    ai.during = async () => { await new Promise((r) => setTimeout(r, 250)); };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: resolveAll(predictionIds) })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ review: { id: string } }>).value.review.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !(r as PromiseFulfilledResult<{ replayed: boolean }>).value.replayed)).toHaveLength(1);
    const rows = await reviewsOf(decisionId);
    expect(rows).toHaveLength(1);
    expect((await predsOf(predictionIds)).every((p) => p.resolvedByReviewId === rows[0]!.id)).toBe(true);
    expect(await dimsOf(decisionId)).toHaveLength(7);
  });
  it("concurrent requests with the same key but different payloads → one review, the others CONFLICT", async () => {
    const { decisionId, predictionIds } = await mkDecision(1);
    const key = randomUUID();
    ai.during = async () => { await new Promise((r) => setTimeout(r, 250)); };
    const results = await Promise.allSettled(["a", "b", "c"].map((note) => caller(investorId).generate({ decisionId, idempotencyKey: key, predictionResolutions: resolveAll(predictionIds, "confirmed", note) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => codeOf((r as PromiseRejectedResult).reason) === "CONFLICT")).toBe(true);
    expect(await reviewsOf(decisionId)).toHaveLength(1);
  });
  it("(18) concurrent requests with DIFFERENT keys against the same pending state → first wins, the others fail closed, one resolution set, no partial review", async () => {
    const { decisionId, predictionIds } = await mkDecision(2);
    ai.during = async () => { await new Promise((r) => setTimeout(r, 250)); };
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: resolveAll(predictionIds) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => codeOf((r as PromiseRejectedResult).reason) === "CONFLICT")).toBe(true);
    const rows = await reviewsOf(decisionId);
    expect(rows).toHaveLength(1);
    expect(new Set((await predsOf(predictionIds)).map((p) => p.resolvedByReviewId))).toEqual(new Set([rows[0]!.id]));
    expect(await dimsOf(decisionId)).toHaveLength(7);
  });
  it("the DB unique index is the final authority even when the application checks are bypassed", async () => {
    const { decisionId } = await mkDecision(0);
    const key = randomUUID();
    await db.insert(schema.decisionReviews).values({ decisionId, narrativeSummaryText: "a", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {}, idempotencyKey: key, requestFingerprint: "v1:a" });
    const dup = await db.insert(schema.decisionReviews).values({ decisionId, narrativeSummaryText: "b", decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive", outcomeJson: {}, idempotencyKey: key, requestFingerprint: "v1:a" }).catch((e) => e);
    expect((dup as { cause?: { code?: string; constraint_name?: string } }).cause).toMatchObject({ code: "23505", constraint_name: "decision_reviews_decision_idempotency_key_unique" });
  });
});

describe("(15) Open-Decision Monitoring baseline", () => {
  it("a later deliberate review still advances the latest-review baseline", async () => {
    const { decisionId } = await mkDecision(0);
    const first = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    await new Promise((r) => setTimeout(r, 20));
    const second = await caller(investorId).generate({ decisionId, idempotencyKey: randomUUID(), predictionResolutions: [] });
    const item = (await loadDecisionAttention(db, investorId, "Asia/Jerusalem")).items.find((i) => i.decisionId === decisionId)!;
    expect(item.review.count).toBe(2);
    expect(item.baseline).toEqual({ kind: "latest_review", at: second.review.reviewDate });
    expect(second.review.reviewDate.getTime()).toBeGreaterThan(first.review.reviewDate.getTime());
  });
});
