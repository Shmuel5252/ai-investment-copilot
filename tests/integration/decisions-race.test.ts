// Regression coverage for the follow-up gap the user asked about after
// the Strategy double-submit incident (git history): does a genuine
// concurrent write conflict on the new UNIQUE(investment_case_id)
// constraint actually surface as a clear error, or a raw 500? Confirmed
// live before writing this fix that it was the latter — this locks in
// the real Postgres error shape a genuine race produces so
// src/db/errors.ts's isUniqueViolation() (and therefore
// src/server/routers/decisions.ts's create) is verified against the
// real thing, not a guessed shape. This is the single most consequential
// instance of the bug class in the app: without this constraint (and
// this classification), the same race could silently produce two
// separate, fully immutable DecisionSnapshots for one Case.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { insertDecision } from "@/db/repositories/decisions";
import { isUniqueViolation } from "@/db/errors";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;
let investmentCaseId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `decisions-race-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Decisions Race Test",
    })
    .returning();
  investorId = investor!.id;

  const [investmentCase] = await db
    .insert(schema.investmentCases)
    .values({ investorId, ticker: "RACE" })
    .returning();
  investmentCaseId = investmentCase!.id;
});

afterAll(async () => {
  await client.end();
});

describe("insertDecision — genuine concurrent race on the same Case", () => {
  it("one call succeeds and the other's real Postgres error is classified as this exact constraint", async () => {
    const payload = {
      investorId,
      investmentCaseId,
      ticker: "RACE",
      decisionType: "BUY" as const,
      decisionDate: new Date(),
    };

    const results = await Promise.allSettled([insertDecision(db, payload), insertDecision(db, payload)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(isUniqueViolation(err, "decisions_investment_case_id_unique")).toBe(true);
  });
});
