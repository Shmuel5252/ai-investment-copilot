// Verifies the transactional bundling behavior in
// src/db/repositories/decisions.ts against the real local Postgres —
// the part of the repository layer with actual multi-table atomicity to
// get right (a DecisionSnapshot without its DNA references, or a Review
// without its dimensions, would be a half-written judgment).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertThesis,
  insertDecision,
  insertDecisionSnapshot,
  getDecisionSnapshotByDecisionId,
  insertDecisionReview,
  getDecisionReviewsForDecision,
  insertPrediction,
  resolvePrediction,
} from "@/db/repositories/decisions";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

let investorId: string;
let decisionId: string;
let decisionReviewId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `decisions-repo-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Decisions Repo Test",
    })
    .returning();
  investorId = investor!.id;

  const [dnaHyp] = await db.insert(schema.dnaHypotheses).values({ investorId }).returning();
  const [dnaVersion] = await db
    .insert(schema.dnaHypothesisVersions)
    .values({
      dnaHypothesisId: dnaHyp!.id,
      versionNumber: 1,
      statementText: "test hypothesis",
      evidenceStrength: "weak",
      createdBy: "ai_generated",
    })
    .returning();
  const [strategyVersion] = await db
    .insert(schema.strategyVersions)
    .values({ investorId, versionNumber: 1, changeSummary: "initial" })
    .returning();
  const [marketContext] = await db
    .insert(schema.marketContexts)
    .values({ source: "test" })
    .returning();
  const [investmentCase] = await db
    .insert(schema.investmentCases)
    .values({ investorId, ticker: "REPO" })
    .returning();
  const decision = await insertDecision(db, {
    investorId,
    investmentCaseId: investmentCase!.id,
    ticker: "REPO",
    decisionType: "BUY",
    decisionDate: new Date(),
  });
  decisionId = decision.id;

  const thesis = await insertThesis(db, { thesisText: "because reasons" });

  await insertDecisionSnapshot(
    db,
    {
      decisionId,
      priceAtDecision: "50",
      userReasoningText: "test reasoning",
      portfolioStateJson: { positions: [], cash: 0 },
      marketContextId: marketContext!.id,
      strategyVersionId: strategyVersion!.id,
      thesisId: thesis.id,
      investmentCaseSnapshotJson: {},
    },
    [dnaVersion!.id]
  );

  const prediction = await insertPrediction(db, {
    thesisId: thesis.id,
    claimText: "revenue grows 20%",
  });

  const review = await insertDecisionReview(
    db,
    {
      decisionId,
      narrativeSummaryText: "went fine",
      decisionQualityOverall: "reasonable",
      thesisAccuracy: "confirmed",
      outcomeJson: { pnl: 100 },
    },
    [
      {
        dimension: "thesis_quality",
        verdict: "reasonable",
        rationaleText: "seemed fine",
        citedSnapshotFields: ["userReasoningText"],
      },
      {
        dimension: "risk_awareness",
        verdict: "insufficient_evidence",
        rationaleText: "no risk notes recorded",
        citedSnapshotFields: [],
      },
    ]
  );
  decisionReviewId = review.id;

  await resolvePrediction(db, prediction.id, {
    status: "confirmed",
    resolvedByReviewId: review.id,
    resolutionNote: "revenue grew 22%",
  });
});

afterAll(async () => {
  await client.end();
});

describe("insertDecisionSnapshot", () => {
  it("bundles the snapshot with its DNA hypothesis version references atomically", async () => {
    const snapshot = await getDecisionSnapshotByDecisionId(db, decisionId);
    expect(snapshot).toBeDefined();
    expect(snapshot!.dnaReferences).toHaveLength(1);
    expect(snapshot!.dnaReferences[0]?.dnaHypothesisVersion.statementText).toBe(
      "test hypothesis"
    );
    expect(snapshot!.thesis?.thesisText).toBe("because reasons");
  });
});

describe("insertDecisionReview", () => {
  it("bundles the review with all of its review dimensions atomically", async () => {
    const reviews = await getDecisionReviewsForDecision(db, decisionId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.dimensions).toHaveLength(2);
    const riskDim = reviews[0]!.dimensions.find((d) => d.dimension === "risk_awareness");
    expect(riskDim?.verdict).toBe("insufficient_evidence");
  });
});

describe("resolvePrediction", () => {
  it("refuses to resolve a prediction that was already resolved", async () => {
    const alreadyResolved = await db.query.predictions.findFirst({
      where: (p, { eq }) => eq(p.status, "confirmed"),
    });
    expect(alreadyResolved).toBeDefined();

    await expect(
      resolvePrediction(db, alreadyResolved!.id, {
        status: "refuted",
        resolvedByReviewId: decisionReviewId,
        resolutionNote: "trying to resolve twice",
      })
    ).rejects.toThrow(/already resolved/);
  });
});
