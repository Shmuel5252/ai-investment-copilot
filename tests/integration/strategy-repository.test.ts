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
import { ensureDefaultRiskPrinciples } from "@/db/repositories/strategy";
import { DEFAULT_RISK_PRINCIPLES } from "@/lib/strategy/default-risk-principles";

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
