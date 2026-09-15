// Hypothesis Identity — integration coverage for the one genuinely new
// repository write path this task adds: insertDnaHypothesisVersionWithEvidence
// (appending a version to an EXISTING DNAHypothesis identity). Exercises
// the real function against real Postgres — not a re-implementation of
// its transaction/versioning logic — mirroring
// tests/integration/strategy-repository.test.ts's own convention for the
// analogous StrategyVersion race.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertDnaHypothesisWithEvidence,
  insertDnaHypothesisVersionWithEvidence,
  getLatestDnaHypothesisVersion,
} from "@/db/repositories/dna";
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
      email: `dna-versioning-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "DNA Versioning Test",
    })
    .returning();
  investorId = investor!.id;

  const session = await insertInterviewSession(db, { investorId, origin: "guided_interview" });
  const [a] = await Promise.all([
    insertInterviewAnswer(db, {
      interviewSessionId: session.id,
      transactionId: null,
      questionText: "Q1",
      answerText: "Answer A",
    }),
  ]);
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

describe("insertDnaHypothesisVersionWithEvidence", () => {
  it("appends version 2 to an existing identity, recomputed counts, without touching version 1 or its evidence", async () => {
    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Original statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });

    const { version: v2 } = await insertDnaHypothesisVersionWithEvidence(db, hypothesis.id, {
      statementText: "Extended statement.",
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
    expect(v2.dnaHypothesisId).toBe(hypothesis.id);
    expect(v2.supportingEvidenceCount).toBe(3);
    expect(v2.evidenceStrength).toBe("moderate");

    // Version 1 is completely untouched — re-fetch and compare against
    // what was originally returned.
    const v1Refetched = await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) });
    expect(v1Refetched).toEqual(v1);

    // getLatestDnaHypothesisVersion now returns version 2.
    const latest = await getLatestDnaHypothesisVersion(db, hypothesis.id);
    expect(latest?.id).toBe(v2.id);

    // Both old and new Evidence rows belong to the SAME identity — no
    // second identity was created.
    const allEvidence = await db.query.evidence.findMany({
      where: (e, { eq }) => eq(e.dnaHypothesisId, hypothesis.id),
    });
    expect(allEvidence).toHaveLength(3);
    expect(new Set(allEvidence.map((e) => e.interviewAnswerId))).toEqual(
      new Set([answerAId, answerBId, answerCId])
    );

    // Still exactly one identity row.
    const identities = await db.query.dnaHypotheses.findMany({ where: (h, { eq }) => eq(h.id, hypothesis.id) });
    expect(identities).toHaveLength(1);
  });

  it("a genuine concurrent race on the same identity: exactly the winners get distinct versions, every loser's real Postgres error is classified as this exact constraint", async () => {
    // A tight single-transaction read-then-insert (this function's own
    // design, deliberately narrower than the read-outside-the-transaction
    // pattern strategy.ts's approveVersion uses) closes its own race
    // window fast enough that a plain two-call Promise.all on a local
    // Postgres does not reliably land both calls' reads before either
    // commits (confirmed empirically before writing this: 2 concurrent
    // calls consistently resolved to distinct versions 2 and 3, no
    // collision at all). A real collision — and therefore real coverage
    // of the UNIQUE constraint's error shape — needs enough concurrent
    // pressure that at least two calls' reads genuinely overlap; this
    // does not assert a specific fulfilled/rejected split, only that a
    // real collision happens and every rejection is the right, classified
    // error, never a raw/unclassified one and never partial state.
    const { hypothesis } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Race base statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });

    const makeVersionCall = () =>
      insertDnaHypothesisVersionWithEvidence(db, hypothesis.id, {
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

    // A real collision must actually have occurred — otherwise this test
    // isn't exercising the race at all.
    expect(rejected.length).toBeGreaterThan(0);
    expect(fulfilled.length + rejected.length).toBe(CONCURRENT_CALLS);

    // Every rejection is this exact, classified constraint — never a raw,
    // uncaught error shape.
    for (const r of rejected) {
      expect(isUniqueViolation(r.reason, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")).toBe(true);
    }

    // No two winners share a version number, and none collide with 1
    // (the base version) — no partial/duplicate state survived.
    const versionNumbers = fulfilled.map((r) => r.value.version.versionNumber);
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
    expect(versionNumbers).not.toContain(1);

    // Persisted state matches the winners exactly — no half-written rows
    // from any of the losing calls, and version 1 (the base) is still
    // there, untouched.
    const versions = await db.query.dnaHypothesisVersions.findMany({
      where: (v, { eq }) => eq(v.dnaHypothesisId, hypothesis.id),
    });
    expect(versions.map((v) => v.versionNumber).sort((a, b) => a - b)).toEqual(
      [1, ...versionNumbers].sort((a, b) => a - b)
    );
  });
});
