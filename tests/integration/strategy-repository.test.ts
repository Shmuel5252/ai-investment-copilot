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
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { ensureDefaultRiskPrinciples, approveStrategyVersion, insertStrategyVersion } from "@/db/repositories/strategy";
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
describe("approveStrategyVersion — version-number race", () => {
  // Deterministic: the collision is forced (the same version number inserted
  // twice), so the real Postgres error shape is always exercised — it does
  // not depend on two calls happening to overlap.
  it("a duplicate version number is rejected with the real error classified as this exact constraint", async () => {
    const first = await approveStrategyVersion(db, investorId, "deterministic approval");
    const err = await insertStrategyVersion(db, { investorId, versionNumber: first.versionNumber, changeSummary: "duplicate" }, []).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeNull();
    expect(isUniqueViolation(err, "strategy_versions_investor_id_version_number_unique")).toBe(true);
  });

  // Overlap is NOT guaranteed (two calls may run back to back), so this
  // asserts the invariant that holds either way: no duplicate version
  // number is ever stored, every call that succeeds got a distinct number,
  // and every call that fails fails with exactly the unique violation.
  it("two concurrent approvals never store a duplicate version number", async () => {
    const results = await Promise.allSettled([
      approveStrategyVersion(db, investorId, "concurrent approval A"),
      approveStrategyVersion(db, investorId, "concurrent approval B"),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof approveStrategyVersion>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(isUniqueViolation(r.reason, "strategy_versions_investor_id_version_number_unique")).toBe(true);
    }
    const returned = fulfilled.map((r) => r.value.versionNumber);
    expect(new Set(returned).size).toBe(returned.length);

    const stored = await db.select({ versionNumber: schema.strategyVersions.versionNumber }).from(schema.strategyVersions).where(eq(schema.strategyVersions.investorId, investorId));
    const numbers = stored.map((s) => s.versionNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
