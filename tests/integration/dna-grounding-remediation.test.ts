// DNA Grounding Remediation — integration coverage for the new
// dna_evidence_grounding_checks table and the two new repository write
// paths (insertGroundingChecksForVersion, insertDnaHypothesisVersionWithGroundingChecks)
// plus the version-aware read (getEffectiveEvidenceForDnaHypothesisVersion).
//
// Migration rule (Autonomous Unit Contract): migration 0008 has been
// WRITTEN (src/db/migrations/0008_numerous_lily_hollister.sql) but is NOT
// authorized to be applied to the real project database in this unit —
// this project has no isolated/test database separate from the real dev
// Postgres instance, so there is no safe way to run this file's real
// assertions until a human explicitly approves and applies that
// migration. Every test below checks, at runtime, whether the new table
// actually exists and calls `skip()` with a clear reason if it does not,
// rather than either (a) silently no-op'ing as a false pass, or (b)
// failing red for a reason every future reader would have to already
// know to discount. Once the migration is applied, these tests activate
// automatically with no code change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertDnaHypothesisWithEvidence,
  insertGroundingChecksForVersion,
  insertDnaHypothesisVersionWithGroundingChecks,
  getLatestDnaHypothesisVersion,
} from "@/db/repositories/dna";
import { getEvidenceForDnaHypothesis, getEffectiveEvidenceForDnaHypothesisVersion } from "@/db/repositories/evidence";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { isUniqueViolation } from "@/db/errors";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });

let investorId: string;
let answerAId: string;
let answerBId: string;
let migrationApplied = false;

beforeAll(async () => {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `dna-grounding-remediation-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "DNA Grounding Remediation Test",
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

  // Cheap existence probe: undefined_table (42P01) means migration 0008
  // has not been applied here yet.
  try {
    await db.select().from(schema.dnaEvidenceGroundingChecks).limit(1);
    migrationApplied = true;
  } catch (err) {
    const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
    if (code !== "42P01") throw err; // a real, unexpected error should still fail the suite
    migrationApplied = false;
  }
});

afterAll(async () => {
  await client.end();
});

const SKIP_REASON = "migration 0008 (dna_evidence_grounding_checks) not applied to this database yet — see Migration rule in this file's header comment";

describe("DNA Grounding Remediation — version-aware evidence + grounding-check persistence", () => {
  it("insertGroundingChecksForVersion appends check rows against the CURRENT version without creating a new version", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis, version } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Checked, unchanged statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const rawEvidence = await getEvidenceForDnaHypothesis(db, hypothesis.id);

    await insertGroundingChecksForVersion(db, version.id, [
      { evidenceId: rawEvidence[0]!.id, verdict: "supported", reason: "matches" },
    ]);

    const latest = await getLatestDnaHypothesisVersion(db, hypothesis.id);
    expect(latest?.id).toBe(version.id); // still version 1 -- no new version created

    const effective = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, version.id);
    expect(effective.map((e) => e.id)).toEqual([rawEvidence[0]!.id]);
  });

  it("insertGroundingChecksForVersion is safe against a genuine concurrent duplicate audit of the SAME version (identical checks raced against each other resolve without error)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis, version } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Concurrently re-checked statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const rawEvidence = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const sameChecks = [{ evidenceId: rawEvidence[0]!.id, verdict: "supported" as const, reason: "matches" }];

    // Two independent audits of the SAME already-live version, computing
    // the same verdicts, racing each other -- neither should throw.
    const results = await Promise.allSettled([
      insertGroundingChecksForVersion(db, version.id, sameChecks),
      insertGroundingChecksForVersion(db, version.id, sameChecks),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    // Exactly one row was persisted, not two -- onConflictDoNothing, not a
    // silent duplicate.
    const checksAfter = await db.query.dnaEvidenceGroundingChecks.findMany({
      where: (c, { eq }) => eq(c.dnaHypothesisVersionId, version.id),
    });
    expect(checksAfter).toHaveLength(1);
  });

  it("insertDnaHypothesisVersionWithGroundingChecks creates a new version with truthful provenance, and raw historical Evidence remains fully retrievable afterward", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis, version: v1 } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Original statement.",
      evidence: [
        { interviewAnswerId: answerAId, stance: "supporting", description: "d1" },
        { interviewAnswerId: answerBId, stance: "supporting", description: "d2" },
      ],
      supportingCount: 2,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const rawEvidence = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const survivorId = rawEvidence.find((e) => e.interviewAnswerId === answerAId)!.id;
    const rejectedId = rawEvidence.find((e) => e.interviewAnswerId === answerBId)!.id;

    const { version: v2 } = await insertDnaHypothesisVersionWithGroundingChecks(
      db,
      hypothesis.id,
      {
        statementText: v1.statementText,
        evidenceStrength: "insufficient_evidence",
        supportingEvidenceCount: 1,
        contradictingEvidenceCount: 0,
        changeReason: "test remediation",
      },
      [
        { evidenceId: survivorId, verdict: "supported", reason: "matches" },
        { evidenceId: rejectedId, verdict: "unsupported", reason: "does not match" },
      ]
    );

    expect(v2.versionNumber).toBe(2);
    expect(v2.createdBy).toBe("system_grounding_revalidation");
    expect(v2.supportingEvidenceCount).toBe(1);

    // Version 1 is completely untouched.
    const v1Refetched = await db.query.dnaHypothesisVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) });
    expect(v1Refetched).toEqual(v1);

    // Raw/historical evidence is STILL fully retrievable, including the
    // rejected citation — storage-level history is never hidden.
    const rawAfter = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    expect(rawAfter).toHaveLength(2);
    expect(rawAfter.map((e) => e.id).sort()).toEqual([survivorId, rejectedId].sort());

    // Effective evidence for the NEW version excludes the rejected citation.
    const effectiveV2 = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v2.id);
    expect(effectiveV2.map((e) => e.id)).toEqual([survivorId]);

    // Effective evidence for the OLD version (never itself checked) still
    // falls back to the full raw pool -- it was never remediated itself.
    const effectiveV1 = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v1.id);
    expect(effectiveV1.map((e) => e.id).sort()).toEqual([survivorId, rejectedId].sort());
  });

  it("preserves the existing UNIQUE(dna_hypothesis_id, version_number) concurrency invariant for this new insert path", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Race base statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });

    const makeCall = () =>
      insertDnaHypothesisVersionWithGroundingChecks(
        db,
        hypothesis.id,
        {
          statementText: "Race base statement.",
          evidenceStrength: "insufficient_evidence",
          supportingEvidenceCount: 1,
          contradictingEvidenceCount: 0,
          changeReason: "concurrent remediation race",
        },
        []
      );

    const CONCURRENT_CALLS = 15;
    const results = await Promise.allSettled(Array.from({ length: CONCURRENT_CALLS }, () => makeCall()));
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof makeCall>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(rejected.length).toBeGreaterThan(0);
    for (const r of rejected) {
      expect(isUniqueViolation(r.reason, "dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")).toBe(true);
    }
    const versionNumbers = fulfilled.map((r) => r.value.version.versionNumber);
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
  });

  // Independent pre-commit review finding: neither the UNIQUE(version_id,
  // evidence_id) constraint nor either FK proves both sides belong to the
  // SAME DNA identity -- a version FK'd to hypothesis A and an Evidence
  // row FK'd to hypothesis B are each individually valid, so nothing at
  // the schema level alone would catch a cross-identity association. Both
  // write paths now assert this explicitly (assertEvidenceBelongsToHypothesis,
  // src/db/repositories/dna.ts) -- these two tests prove it against two
  // REAL, separate DNA identities, not a mocked check.
  it("insertDnaHypothesisVersionWithGroundingChecks refuses to persist a grounding check for Evidence belonging to a DIFFERENT DNA hypothesis", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis: hypothesisA } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Hypothesis A.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const { hypothesis: hypothesisB } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Hypothesis B.",
      evidence: [{ interviewAnswerId: answerBId, stance: "supporting", description: "d2" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const evidenceOfB = (await getEvidenceForDnaHypothesis(db, hypothesisB.id))[0]!;

    await expect(
      insertDnaHypothesisVersionWithGroundingChecks(
        db,
        hypothesisA.id,
        {
          statementText: "Hypothesis A, extended.",
          evidenceStrength: "insufficient_evidence",
          supportingEvidenceCount: 1,
          contradictingEvidenceCount: 0,
          changeReason: "cross-identity attempt",
        },
        [{ evidenceId: evidenceOfB.id, verdict: "supported", reason: "mismatched" }]
      )
    ).rejects.toThrow(/do not all belong to DNA hypothesis/);

    // No new version was created for A -- the whole transaction rolled back.
    const latestA = await getLatestDnaHypothesisVersion(db, hypothesisA.id);
    expect(latestA?.versionNumber).toBe(1);
    // Nothing was logged against B's evidence either.
    const checksOnB = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesisB.id, (await getLatestDnaHypothesisVersion(db, hypothesisB.id))!.id);
    expect(checksOnB).toHaveLength(1); // still the original raw evidence, untouched
  });

  it("insertGroundingChecksForVersion refuses to persist a grounding check for Evidence belonging to a DIFFERENT DNA hypothesis than the target version's own identity", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { hypothesis: hypothesisA, version: versionA } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Hypothesis A2.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const { hypothesis: hypothesisB } = await insertDnaHypothesisWithEvidence(db, investorId, {
      statement: "Hypothesis B2.",
      evidence: [{ interviewAnswerId: answerBId, stance: "supporting", description: "d2" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
    });
    const evidenceOfB = (await getEvidenceForDnaHypothesis(db, hypothesisB.id))[0]!;

    await expect(
      insertGroundingChecksForVersion(db, versionA.id, [
        { evidenceId: evidenceOfB.id, verdict: "supported", reason: "mismatched" },
      ])
    ).rejects.toThrow(/do not all belong to DNA hypothesis/);

    const effectiveA = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesisA.id, versionA.id);
    // Legacy fallback (no check rows were persisted -- the insert was
    // refused) -- still the original raw evidence, not "grounded" against
    // hypothesis B's citation.
    expect(effectiveA).toHaveLength(1);
    expect(effectiveA[0]!.interviewAnswerId).toBe(answerAId);
  });
});
