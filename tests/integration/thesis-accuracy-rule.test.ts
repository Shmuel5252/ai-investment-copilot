// Unit 7/A — the production reviews.generate path stores the deterministic
// thesis_accuracy floor, not the AI label, when no resolution bears evidence.
// AI review call and market data mocked; everything else is the real code on
// the authorized test database (tests/support).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const ai = vi.hoisted(() => ({ label: "partially_confirmed" }));
vi.mock("@/lib/ai/review", () => ({
  synthesizeDecisionReview: async () => ({
    narrativeSummaryText: "mock narrative",
    thesisAccuracy: ai.label,
    dimensions: ["thesis_quality", "evidence_quality", "risk_awareness", "valuation_awareness", "portfolio_fit", "strategy_consistency", "exit_conditions"].map((dimension) => ({
      dimension, verdict: "reasonable", rationaleText: "mock rationale", citedSnapshotFields: ["userReasoningText"],
    })),
  }),
}));
vi.mock("@/lib/market/market-intelligence", () => ({ getMarketIntelligence: async () => { throw new Error("no market data in tests"); } }));

import { reviewsRouter } from "@/server/routers/reviews";
import { insertDecision, insertDecisionSnapshot, insertPrediction, insertThesis } from "@/db/repositories/decisions";
import { mkInvestor } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });
let investorId: string, strategyVersionId: string, marketContextId: string;

type Kind = "forecast" | "reentry_condition";
type Status = "confirmed" | "refuted" | "inconclusive";

async function review(aiLabel: string, preds: [Kind, Status][]) {
  ai.label = aiLabel;
  const [c] = await db.insert(schema.investmentCases).values({ investorId, ticker: "TAR" }).returning();
  const d = await insertDecision(db, { investorId, investmentCaseId: c!.id, ticker: "TAR", decisionType: "BUY", decisionDate: new Date("2026-08-01T10:00:00Z") });
  const thesis = await insertThesis(db, { thesisText: "t" });
  await insertDecisionSnapshot(db, { decisionId: d.id, priceAtDecision: "100", userReasoningText: "r", portfolioStateJson: { cash: 0, positions: [] }, marketContextId, strategyVersionId, thesisId: thesis.id, investmentCaseSnapshotJson: {} }, []);
  const resolutions = [];
  for (const [kind, status] of preds) {
    const p = await insertPrediction(db, { thesisId: thesis.id, claimText: `${kind} ${status}`, kind });
    resolutions.push({ predictionId: p.id, status, note: "n" });
  }
  const r = await reviewsRouter.createCaller({ session: { investorId } } as never).generate({ decisionId: d.id, idempotencyKey: randomUUID(), predictionResolutions: resolutions });
  return r.review.thesisAccuracy;
}

beforeAll(async () => {
  investorId = await mkInvestor(db, "thesis-accuracy-rule");
  strategyVersionId = (await db.insert(schema.strategyVersions).values({ investorId, versionNumber: 1, changeSummary: "f" }).returning())[0]!.id;
  marketContextId = (await db.insert(schema.marketContexts).values({ source: "test" }).returning())[0]!.id;
});
afterAll(async () => {
  await client.end();
});

describe("reviews.generate stores the thesis_accuracy evidence floor", () => {
  it("AVGO shape (forecast inconclusive + 3 conditions not occurred): AI said partially_confirmed, stored insufficient_evidence", async () => {
    expect(await review("partially_confirmed", [["forecast", "inconclusive"], ["reentry_condition", "refuted"], ["reentry_condition", "refuted"], ["reentry_condition", "refuted"]])).toBe("insufficient_evidence");
  });
  it("PLTR shape (3 conditions, one occurred): the AI label is stored", async () => {
    expect(await review("partially_confirmed", [["reentry_condition", "confirmed"], ["reentry_condition", "refuted"], ["reentry_condition", "refuted"]])).toBe("partially_confirmed");
  });
  it("a confirmed forecast: the AI label is stored", async () => {
    expect(await review("confirmed", [["forecast", "confirmed"]])).toBe("confirmed");
  });
  it("all forecasts inconclusive, no conditions: stored insufficient_evidence", async () => {
    expect(await review("inconclusive", [["forecast", "inconclusive"], ["forecast", "inconclusive"]])).toBe("insufficient_evidence");
  });
});
