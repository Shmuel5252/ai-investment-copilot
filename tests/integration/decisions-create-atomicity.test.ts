// Regression coverage for the Decision creation atomicity fix
// (docs/backlog.md): src/server/routers/decisions.ts's `create` mutation
// now wraps insertThesis -> insertDecision -> insertPrediction (loop) ->
// insertDecisionSnapshot -> updateInvestmentCase in one db.transaction,
// instead of five separate autocommit statements. This exercises that
// exact same sequence, through the exact same real repository functions
// (insertThesis/insertDecision/insertPrediction/insertDecisionSnapshot/
// updateInvestmentCase, all now typed DbOrTx) against a real local
// Postgres, and proves the thing tests/integration/decisions-race.test.ts
// does NOT: that a losing concurrent write rolls back everything it had
// already written (its thesis), not just its decision.
//
// What this does NOT prove: that src/server/routers/decisions.ts's
// `create` mutation itself still calls db.transaction around these same
// five calls — exercising the real mutation would require mocking FMP
// (getMarketIntelligence/getOrCaptureMarketContext) and the real
// Anthropic call (synthesizeDecisionContext), which is out of scope here
// (no precedent anywhere in this codebase's tests, same conclusion
// already reached for validateDecisionSynthesis's call site). That
// specific wiring relies on manual code-review diff-verification, same
// as there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertThesis,
  insertDecision,
  insertPrediction,
  insertDecisionSnapshot,
  getDecisionSnapshotByDecisionId,
} from "@/db/repositories/decisions";
import { updateInvestmentCase } from "@/db/repositories/ideas-cases";
import { isUniqueViolation } from "@/db/errors";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;
let investmentCaseId: string;
let marketContextId: string;
let strategyVersionId: string;

const MARKER_A = "atomicity-test-thesis-A";
const MARKER_B = "atomicity-test-thesis-B";

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `decisions-create-atomicity-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Decisions Create Atomicity Test",
    })
    .returning();
  investorId = investor!.id;

  const [investmentCase] = await db
    .insert(schema.investmentCases)
    .values({ investorId, ticker: "ATOM" })
    .returning();
  investmentCaseId = investmentCase!.id;

  const [marketContext] = await db.insert(schema.marketContexts).values({ source: "test" }).returning();
  marketContextId = marketContext!.id;

  const [strategyVersion] = await db
    .insert(schema.strategyVersions)
    .values({ investorId, versionNumber: 1, changeSummary: "initial" })
    .returning();
  strategyVersionId = strategyVersion!.id;
});

afterAll(async () => {
  // Explicit cleanup, unlike decisions-race.test.ts's own missing
  // convention — that gap is exactly why 30 of the 31 orphaned decisions
  // documented in docs/backlog.md existed. Delete in FK-safe order.
  const decisionRows = await db.query.decisions.findMany({
    where: (d, { eq }) => eq(d.investmentCaseId, investmentCaseId),
  });
  const decisionIds = decisionRows.map((d) => d.id);

  if (decisionIds.length > 0) {
    const snapshotRows = await db.query.decisionSnapshots.findMany({
      where: (s, { inArray }) => inArray(s.decisionId, decisionIds),
    });
    const thesisIdsFromSnapshots = snapshotRows.map((s) => s.thesisId);
    await db.delete(schema.decisionSnapshots).where(inArray(schema.decisionSnapshots.decisionId, decisionIds));
    if (thesisIdsFromSnapshots.length > 0) {
      await db.delete(schema.predictions).where(inArray(schema.predictions.thesisId, thesisIdsFromSnapshots));
      await db.delete(schema.theses).where(inArray(schema.theses.id, thesisIdsFromSnapshots));
    }
    await db.delete(schema.decisions).where(inArray(schema.decisions.id, decisionIds));
  }
  // Defensive: the losing thesis should already be rolled back by
  // Postgres itself (that's the behavior under test) — clean up by
  // marker text too, in case an assertion failure ever leaves it behind.
  await db.delete(schema.predictions).where(inArray(schema.predictions.claimText, [`${MARKER_A} prediction`, `${MARKER_B} prediction`]));
  await db.delete(schema.theses).where(inArray(schema.theses.thesisText, [MARKER_A, MARKER_B]));
  await db.delete(schema.investmentCases).where(eq(schema.investmentCases.id, investmentCaseId));
  await db.delete(schema.marketContexts).where(eq(schema.marketContexts.id, marketContextId));
  await db.delete(schema.strategyVersions).where(eq(schema.strategyVersions.id, strategyVersionId));
  await db.delete(schema.investors).where(eq(schema.investors.id, investorId));
  await client.end();
});

// Mirrors the exact sequence and exact repository functions
// src/server/routers/decisions.ts's `create` mutation now wraps in
// db.transaction — same call order, same functions, same real Postgres.
// Deliberately omits the router's try/catch that converts a unique
// violation into a friendly TRPCError: that conversion is a router/UI
// concern, orthogonal to whether the transaction itself rolls back
// correctly, which is what this test is about.
async function runCreateSequence(thesisMarker: string) {
  return db.transaction(async (tx) => {
    const thesis = await insertThesis(tx, { thesisText: thesisMarker });
    const decision = await insertDecision(tx, {
      investorId,
      investmentCaseId,
      ticker: "ATOM",
      decisionType: "BUY",
      decisionDate: new Date(),
    });
    const prediction = await insertPrediction(tx, {
      thesisId: thesis.id,
      claimText: `${thesisMarker} prediction`,
    });
    const snapshot = await insertDecisionSnapshot(
      tx,
      {
        decisionId: decision.id,
        priceAtDecision: "100",
        userReasoningText: thesisMarker,
        portfolioStateJson: { positions: [], cash: 0 },
        marketContextId,
        strategyVersionId,
        thesisId: thesis.id,
        investmentCaseSnapshotJson: {},
      },
      []
    );
    await updateInvestmentCase(tx, investmentCaseId, { status: "decided" });
    return { thesis, decision, prediction, snapshot };
  });
}

describe("create mutation's write sequence, now inside one db.transaction — genuine concurrent race on the same Case", () => {
  it("winner gets one complete set of rows; loser's thesis (written before its decision failed) is rolled back too, not just its decision", async () => {
    const results = await Promise.allSettled([runCreateSequence(MARKER_A), runCreateSequence(MARKER_B)]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runCreateSequence>>> => r.status === "fulfilled"
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Same real Postgres error shape decisions-race.test.ts locks in —
    // unchanged by the transaction wrap (the UNIQUE constraint isn't
    // deferrable, so it's still enforced at the same INSERT statement
    // regardless of what transaction it runs inside).
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(isUniqueViolation(err, "decisions_investment_case_id_unique")).toBe(true);

    const winnerMarker = fulfilled[0]!.value.thesis.thesisText;
    const loserMarker = winnerMarker === MARKER_A ? MARKER_B : MARKER_A;

    // Winner: exactly one full, complete set of rows — not partial.
    const winnerTheses = await db.query.theses.findMany({ where: (t, { eq }) => eq(t.thesisText, winnerMarker) });
    expect(winnerTheses).toHaveLength(1);

    const winnerDecisions = await db.query.decisions.findMany({
      where: (d, { eq }) => eq(d.investmentCaseId, investmentCaseId),
    });
    expect(winnerDecisions).toHaveLength(1);

    const winnerSnapshot = await getDecisionSnapshotByDecisionId(db, winnerDecisions[0]!.id);
    expect(winnerSnapshot).toBeDefined();
    expect(winnerSnapshot!.thesisId).toBe(winnerTheses[0]!.id);

    const winnerPredictions = await db.query.predictions.findMany({
      where: (p, { eq }) => eq(p.thesisId, winnerTheses[0]!.id),
    });
    expect(winnerPredictions).toHaveLength(1);

    const winnerCase = await db.query.investmentCases.findFirst({
      where: (c, { eq }) => eq(c.id, investmentCaseId),
    });
    expect(winnerCase?.status).toBe("decided");

    // Loser: full rollback — the thesis inserted before insertDecision
    // failed must be gone too. This is exactly the gap the unwrapped
    // sequence had (docs/backlog.md): a thesis with no path back to it
    // once its decision/snapshot never existed, permanently orphaned.
    const loserTheses = await db.query.theses.findMany({ where: (t, { eq }) => eq(t.thesisText, loserMarker) });
    expect(loserTheses).toHaveLength(0);

    // Trivially true (insertDecision throws before the predictions loop
    // is ever reached), listed anyway for completeness against "zero
    // rows left behind in every table".
    const loserPredictions = await db.query.predictions.findMany({
      where: (p, { eq }) => eq(p.claimText, `${loserMarker} prediction`),
    });
    expect(loserPredictions).toHaveLength(0);
  });
});
