// Production Readiness Unit 3A — the five procedures that used to read or
// write by id without checking the row belongs to the signed-in investor.
// Two investors each: the owner gets the data (or the write lands), the other
// investor gets the same NOT_FOUND an unknown id gets. No AI, no market data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { decisionsRouter } from "@/server/routers/decisions";
import { dnaRouter } from "@/server/routers/dna";
import { strategyRouter } from "@/server/routers/strategy";
import { learningRouter } from "@/server/routers/learning";
import { insertDecision } from "@/db/repositories/decisions";
import { setDnaHypothesisStatus } from "@/db/repositories/dna";
import { mkInvestor, uniqueKey } from "../helpers/db-fixtures";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });
const ctx = (investorId: string) => ({ session: { investorId } }) as never;
const notFound = { code: "NOT_FOUND" };

let owner: string;
let other: string;
let caseId: string;
let decisionId: string;
let hypothesisId: string;
let principleId: string;
let insightId: string;

beforeAll(async () => {
  owner = await mkInvestor(db, "ownership-owner");
  other = await mkInvestor(db, "ownership-other");

  const [investmentCase] = await db.insert(schema.investmentCases).values({ investorId: owner, ticker: "OWN" }).returning();
  caseId = investmentCase!.id;
  decisionId = (await insertDecision(db, { investorId: owner, investmentCaseId: caseId, ticker: "OWN", decisionType: "PASS", decisionDate: new Date() })).id;

  const [hypothesis] = await db.insert(schema.dnaHypotheses).values({ investorId: owner }).returning();
  hypothesisId = hypothesis!.id;
  await db.insert(schema.dnaHypothesisVersions).values({ dnaHypothesisId: hypothesisId, versionNumber: 1, statementText: "fixture", evidenceStrength: "weak", createdBy: "ai_generated" });
  await db.insert(schema.evidence).values({ dnaHypothesisId: hypothesisId, stance: "supporting", manualNoteText: "fixture", description: "fixture" });

  const [principle] = await db.insert(schema.strategyPrinciples).values({ investorId: owner, key: uniqueKey("ownership") }).returning();
  principleId = principle!.id;
  await db.insert(schema.strategyPrincipleVersions).values({ strategyPrincipleId: principleId, versionNumber: 1, principleType: "observed", statementText: "fixture", rationaleText: "fixture", createdBy: "ai_observed" });
  await db.insert(schema.evidence).values({ strategyPrincipleId: principleId, stance: "supporting", manualNoteText: "fixture", description: "fixture" });

  const [insight] = await db.insert(schema.learningInsights).values({ investorId: owner, family: "fixture" }).returning();
  insightId = insight!.id;
  await db.insert(schema.evidence).values({ learningInsightId: insightId, stance: "supporting", manualNoteText: "fixture", description: "fixture" });
});

afterAll(async () => {
  await client.end();
});

describe("decisions.getForCase", () => {
  it("returns the owner's decision", async () => {
    expect((await decisionsRouter.createCaller(ctx(owner)).getForCase({ caseId }))?.id).toBe(decisionId);
  });
  it("refuses another investor", async () => {
    await expect(decisionsRouter.createCaller(ctx(other)).getForCase({ caseId })).rejects.toMatchObject(notFound);
  });
});

describe("dna.evidence", () => {
  it("returns the owner's evidence", async () => {
    expect(await dnaRouter.createCaller(ctx(owner)).evidence({ dnaHypothesisId: hypothesisId })).toHaveLength(1);
  });
  it("refuses another investor", async () => {
    await expect(dnaRouter.createCaller(ctx(other)).evidence({ dnaHypothesisId: hypothesisId })).rejects.toMatchObject(notFound);
  });
});

describe("dna.reject", () => {
  const status = async () => (await db.query.dnaHypotheses.findFirst({ where: eq(schema.dnaHypotheses.id, hypothesisId) }))!.status;

  it("refuses another investor and leaves the row unchanged", async () => {
    await expect(dnaRouter.createCaller(ctx(other)).reject({ dnaHypothesisId: hypothesisId })).rejects.toMatchObject(notFound);
    expect(await status()).toBe("active");
  });
  it("the write itself is scoped by investor, even without the router check", async () => {
    await setDnaHypothesisStatus(db as never, other, hypothesisId, "user_rejected");
    expect(await status()).toBe("active");
  });
  it("lets the owner reject", async () => {
    await dnaRouter.createCaller(ctx(owner)).reject({ dnaHypothesisId: hypothesisId });
    expect(await status()).toBe("user_rejected");
  });
});

describe("strategy.evidence", () => {
  it("returns the owner's evidence", async () => {
    expect(await strategyRouter.createCaller(ctx(owner)).evidence({ strategyPrincipleId: principleId })).toHaveLength(1);
  });
  it("refuses another investor", async () => {
    await expect(strategyRouter.createCaller(ctx(other)).evidence({ strategyPrincipleId: principleId })).rejects.toMatchObject(notFound);
  });
});

describe("learning.evidence", () => {
  it("returns the owner's evidence", async () => {
    expect(await learningRouter.createCaller(ctx(owner)).evidence({ learningInsightId: insightId })).toHaveLength(1);
  });
  it("refuses another investor", async () => {
    await expect(learningRouter.createCaller(ctx(other)).evidence({ learningInsightId: insightId })).rejects.toMatchObject(notFound);
  });
});
