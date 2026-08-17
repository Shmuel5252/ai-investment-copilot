// Regression test for a real bug caught live (not synthetic): two
// near-simultaneous calls to ensureDefaultRiskPrinciples — exactly what
// React StrictMode's dev-only double-invoke of a mount effect produces —
// used to both see "nothing exists yet" before either committed and both
// insert, duplicating every default principle. The fix is a DB-level
// unique (investor_id, key) constraint (src/db/schema/strategy.ts) plus
// onConflictDoNothing (src/db/repositories/strategy.ts) — this test
// exercises the actual race (concurrent calls against the real Postgres),
// not just sequential idempotency, which the old buggy code already
// handled fine and would not have caught this.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { ensureDefaultRiskPrinciples, approveStrategyVersion } from "@/db/repositories/strategy";
import { DEFAULT_RISK_PRINCIPLES } from "@/lib/strategy/default-risk-principles";
import { isUniqueViolation } from "@/db/errors";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `strategy-repo-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Strategy Repo Test",
    })
    .returning();
  investorId = investor!.id;
});

afterAll(async () => {
  await client.end();
});

describe("ensureDefaultRiskPrinciples", () => {
  it("does not duplicate default principles when called concurrently (the actual StrictMode race)", async () => {
    await Promise.all([
      ensureDefaultRiskPrinciples(db, investorId),
      ensureDefaultRiskPrinciples(db, investorId),
    ]);

    const rows = await db.query.strategyPrinciples.findMany({
      where: (p, { eq }) => eq(p.investorId, investorId),
    });
    expect(rows).toHaveLength(DEFAULT_RISK_PRINCIPLES.length);

    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
  });

  it("remains idempotent on a subsequent sequential call", async () => {
    await ensureDefaultRiskPrinciples(db, investorId);

    const rows = await db.query.strategyPrinciples.findMany({
      where: (p, { eq }) => eq(p.investorId, investorId),
    });
    expect(rows).toHaveLength(DEFAULT_RISK_PRINCIPLES.length);
  });
});

// Regression coverage for the follow-up gap the user asked about after
// the double-click incident (git history): the UNIQUE(investor_id,
// version_number) constraint on strategy_versions stops bad data from
// being written on a genuine concurrent race, but on its own it would
// have surfaced as a raw, uncaught Postgres error — this confirms the
// real error shape a genuine race produces is exactly what
// src/db/errors.ts's isUniqueViolation() (and therefore
// src/server/routers/strategy.ts's approveVersion) expects, not a
// mocked approximation of it.
describe("approveStrategyVersion — genuine concurrent race", () => {
  it("one call succeeds and the other's real Postgres error is classified as this exact constraint", async () => {
    const results = await Promise.allSettled([
      approveStrategyVersion(db, investorId, "concurrent approval A"),
      approveStrategyVersion(db, investorId, "concurrent approval B"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(isUniqueViolation(err, "strategy_versions_investor_id_version_number_unique")).toBe(true);
  });
});
