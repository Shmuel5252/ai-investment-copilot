// These tests hit the real local Postgres (docker compose) — they verify
// the DB-level guarantees the data model depends on (docs/data-model.md
// §0 "typed-nullable-FK + CHECK", §10 immutability/RESTRICT), not just
// that Drizzle's TS types compile. Requires `docker compose up -d` +
// `npm run db:migrate` first (see README).
//
// Cleanup note: fixture rows (investor + whatever they reference) are
// intentionally left in place rather than cascade-deleted — several
// tests create chains several tables deep (decision -> snapshot ->
// thesis/market-context/strategy-version), and unwinding that in the
// right order for test cleanup would be more machinery than this check
// is worth. Each run uses a unique email, and the local dev DB can
// always be reset with `docker compose down -v && rm -rf pgdata`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

let investorId: string;

// Postgres wraps constraint violations inside a `cause` on the error
// drizzle/postgres.js throws; the constraint name we care about lives at
// error.cause.constraint_name, not in the top-level message.
async function causedByConstraint(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name;
  }
}

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `schema-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Schema Test",
    })
    .returning();
  investorId = investor!.id;
});

afterAll(async () => {
  await client.end();
});

describe("evidence CHECK constraints", () => {
  it("rejects evidence with zero subjects", async () => {
    const constraint = await causedByConstraint(() =>
      db.insert(schema.evidence).values({
        stance: "supporting",
        description: "no subject at all",
      })
    );
    expect(constraint).toBe("evidence_exactly_one_subject");
  });

  it("rejects evidence with two subjects at once", async () => {
    const [hyp] = await db
      .insert(schema.dnaHypotheses)
      .values({ investorId })
      .returning();
    const [principle] = await db
      .insert(schema.strategyPrinciples)
      .values({ investorId, key: "test-principle" })
      .returning();

    const constraint = await causedByConstraint(() =>
      db.insert(schema.evidence).values({
        dnaHypothesisId: hyp!.id,
        strategyPrincipleId: principle!.id,
        stance: "supporting",
        description: "two subjects",
      })
    );
    expect(constraint).toBe("evidence_exactly_one_subject");
  });

  it("accepts evidence with exactly one subject and no source", async () => {
    const [hyp] = await db
      .insert(schema.dnaHypotheses)
      .values({ investorId })
      .returning();

    const [row] = await db
      .insert(schema.evidence)
      .values({
        dnaHypothesisId: hyp!.id,
        stance: "supporting",
        description: "valid single-subject evidence",
      })
      .returning();

    expect(row?.id).toBeDefined();
  });
});

describe("corrections CHECK constraint", () => {
  it("rejects a correction with no target", async () => {
    const constraint = await causedByConstraint(() =>
      db.insert(schema.corrections).values({
        userArgumentText: "I disagree with... nothing in particular",
      })
    );
    expect(constraint).toBe("correction_exactly_one_target");
  });
});

describe("decision_snapshots RESTRICT constraints", () => {
  it("refuses to delete a StrategyVersion referenced by a DecisionSnapshot", async () => {
    const [strategyVersion] = await db
      .insert(schema.strategyVersions)
      .values({ investorId, versionNumber: 1, changeSummary: "initial" })
      .returning();
    const [marketContext] = await db
      .insert(schema.marketContexts)
      .values({ source: "test" })
      .returning();
    const [thesis] = await db
      .insert(schema.theses)
      .values({ thesisText: "test thesis" })
      .returning();
    const [idea] = await db
      .insert(schema.investmentCases)
      .values({ investorId, ticker: "TEST" })
      .returning();
    const [decision] = await db
      .insert(schema.decisions)
      .values({
        investorId,
        investmentCaseId: idea!.id,
        ticker: "TEST",
        decisionType: "BUY",
        decisionDate: new Date(),
      })
      .returning();

    await db.insert(schema.decisionSnapshots).values({
      decisionId: decision!.id,
      priceAtDecision: "100",
      userReasoningText: "because",
      portfolioStateJson: {},
      marketContextId: marketContext!.id,
      strategyVersionId: strategyVersion!.id,
      thesisId: thesis!.id,
      investmentCaseSnapshotJson: {},
    });

    await expect(
      db.delete(schema.strategyVersions).where(eq(schema.strategyVersions.id, strategyVersion!.id))
    ).rejects.toThrow();
  });
});
