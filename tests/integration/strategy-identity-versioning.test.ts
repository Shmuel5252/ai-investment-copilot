// Strategy Identity Hardening — integration coverage for the one
// genuinely new repository write path this task adds to the ORDINARY
// generateObserved flow: insertObservedPrincipleVersionWithEvidence
// (appending a version to an EXISTING strategyPrinciples identity).
// Exercises the real function against real Postgres — mirrors
// tests/integration/dna-hypothesis-versioning.test.ts's own convention
// for the analogous DNA path. Uses only pre-existing tables
// (strategy_principle_versions, evidence) — does NOT require migration
// 0009, so this file runs unguarded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertObservedPrincipleWithEvidence,
  insertObservedPrincipleVersionWithEvidence,
  getLatestStrategyPrincipleVersion,
} from "@/db/repositories/strategy";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { isUniqueViolation } from "@/db/errors";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;
let answerAId: string;
let answerBId: string;
let answerCId: string;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `strategy-identity-versioning-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Strategy Identity Versioning Test",
    })
    .returning();
  investorId = investor!.id;

  const session = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
  const a = await insertInterviewAnswer(db, {
    interviewSessionId: session.id,
    transactionId: null,
    questionText: "Q1",
    answerText: "Answer A",
  });
  answerAId = a.id;
  const b = await insertInterviewAnswer(db, {
    interviewSessionId: session.id,
    transactionId: null,
    questionText: "Q2",
    answerText: "Answer B",
  });
  answerBId = b.id;
  const c = await insertInterviewAnswer(db, {
    interviewSessionId: session.id,
    transactionId: null,
    questionText: "Q3",
    answerText: "Answer C",
  });
  answerCId = c.id;
});

afterAll(async () => {
  await client.end();
});

describe("insertObservedPrincipleVersionWithEvidence", () => {
  it("appends version 2 to an existing OBSERVED identity, recomputed counts, without touching version 1 or its evidence", async () => {
    const { principle, version: v1 } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Original observed statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });

    const { version: v2 } = await insertObservedPrincipleVersionWithEvidence(db, principle.id, {
      statementText: "Original observed statement.",
      evidenceStrength: "moderate",
      supportingEvidenceCount: 3,
      contradictingEvidenceCount: 0,
      newEvidence: [
        { interviewAnswerId: answerBId, stance: "supporting", description: "d2" },
        { interviewAnswerId: answerCId, stance: "supporting", description: "d3" },
      ],
      changeReason: "test extension",
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.strategyPrincipleId).toBe(principle.id);
    expect(v2.principleType).toBe("observed");
    expect(v2.supportingEvidenceCount).toBe(3);
    expect(v2.evidenceStrength).toBe("moderate");
    expect(v2.createdBy).toBe("ai_observed");

    const v1Refetched = await db.query.strategyPrincipleVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) });
    expect(v1Refetched).toEqual(v1);

    const latest = await getLatestStrategyPrincipleVersion(db, principle.id);
    expect(latest?.id).toBe(v2.id);

    const allEvidence = await db.query.evidence.findMany({
      where: (e, { eq }) => eq(e.strategyPrincipleId, principle.id),
    });
    expect(allEvidence).toHaveLength(3);
    expect(new Set(allEvidence.map((e) => e.interviewAnswerId))).toEqual(
      new Set([answerAId, answerBId, answerCId])
    );

    const identities = await db.query.strategyPrinciples.findMany({ where: (p, { eq }) => eq(p.id, principle.id) });
    expect(identities).toHaveLength(1);
  });

  it("a genuine concurrent race on the same identity: exactly the winners get distinct versions, every loser's real Postgres error is classified as this exact constraint", async () => {
    const { principle } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Race base statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });

    const makeVersionCall = () =>
      insertObservedPrincipleVersionWithEvidence(db, principle.id, {
        statementText: "Race extended statement.",
        evidenceStrength: "moderate",
        supportingEvidenceCount: 2,
        contradictingEvidenceCount: 0,
        newEvidence: [],
        changeReason: "concurrent race",
      });

    const CONCURRENT_CALLS = 15;
    const results = await Promise.allSettled(Array.from({ length: CONCURRENT_CALLS }, () => makeVersionCall()));

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof makeVersionCall>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(rejected.length).toBeGreaterThan(0);
    expect(fulfilled.length + rejected.length).toBe(CONCURRENT_CALLS);

    for (const r of rejected) {
      expect(
        isUniqueViolation(r.reason, "strategy_principle_versions_strategy_principle_id_version_numbe")
      ).toBe(true);
    }

    const versionNumbers = fulfilled.map((r) => r.value.version.versionNumber);
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
    expect(versionNumbers).not.toContain(1);

    const versions = await db.query.strategyPrincipleVersions.findMany({
      where: (v, { eq }) => eq(v.strategyPrincipleId, principle.id),
    });
    expect(versions.map((v) => v.versionNumber).sort((a, b) => a - b)).toEqual(
      [1, ...versionNumbers].sort((a, b) => a - b)
    );
  });
});
