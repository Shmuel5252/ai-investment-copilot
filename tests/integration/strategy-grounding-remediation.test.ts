// Strategy Grounding Remediation — integration coverage for the new
// strategy_evidence_grounding_checks table and the two new repository
// write paths (insertGroundingChecksForPrincipleVersion,
// insertObservedPrincipleVersionWithGroundingChecks) plus the
// version-aware read (getEffectiveEvidenceForStrategyPrincipleVersion).
// Mirrors tests/integration/dna-grounding-remediation.test.ts exactly.
//
// Migration rule (Autonomous Unit Contract): migration 0009 has been
// WRITTEN (src/db/migrations/0009_large_jackpot.sql) but is NOT
// authorized to be applied to the real project database in this unit.
// Every test below checks, at runtime, whether the new table actually
// exists and calls skip() with a clear reason if it does not. Once the
// migration is applied, these tests activate automatically with no code
// change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertObservedPrincipleWithEvidence,
  insertGroundingChecksForPrincipleVersion,
  insertObservedPrincipleVersionWithGroundingChecks,
  getLatestStrategyPrincipleVersion,
} from "@/db/repositories/strategy";
import {
  getEvidenceForStrategyPrinciple,
  getEffectiveEvidenceForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";
import { isUniqueViolation } from "@/db/errors";
import { fixtureBasis } from "../helpers/independence";

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
      email: `strategy-grounding-remediation-test-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Strategy Grounding Remediation Test",
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

  try {
    await db.select().from(schema.strategyEvidenceGroundingChecks).limit(1);
    migrationApplied = true;
  } catch (err) {
    const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
    if (code !== "42P01") throw err;
    migrationApplied = false;
  }
});

afterAll(async () => {
  await client.end();
});

const SKIP_REASON =
  "migration 0009 (strategy_evidence_grounding_checks) not applied to this database yet — see Migration rule in this file's header comment";

describe("Strategy Grounding Remediation — version-aware evidence + grounding-check persistence", () => {
  it("insertGroundingChecksForPrincipleVersion appends check rows against the CURRENT version without creating a new version", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle, version } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Checked, unchanged statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const rawEvidence = await getEvidenceForStrategyPrinciple(db, principle.id);

    await insertGroundingChecksForPrincipleVersion(db, version.id, [
      { evidenceId: rawEvidence[0]!.id, verdict: "supported", reason: "matches" },
    ]);

    const latest = await getLatestStrategyPrincipleVersion(db, principle.id);
    expect(latest?.id).toBe(version.id); // still version 1

    const effective = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, version.id);
    expect(effective.map((e) => e.id)).toEqual([rawEvidence[0]!.id]);
  });

  it("insertGroundingChecksForPrincipleVersion is safe against a genuine concurrent duplicate audit of the SAME version", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle, version } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Concurrently re-checked statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const rawEvidence = await getEvidenceForStrategyPrinciple(db, principle.id);
    const sameChecks = [{ evidenceId: rawEvidence[0]!.id, verdict: "supported" as const, reason: "matches" }];

    const results = await Promise.allSettled([
      insertGroundingChecksForPrincipleVersion(db, version.id, sameChecks),
      insertGroundingChecksForPrincipleVersion(db, version.id, sameChecks),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const checksAfter = await db.query.strategyEvidenceGroundingChecks.findMany({
      where: (c, { eq }) => eq(c.strategyPrincipleVersionId, version.id),
    });
    expect(checksAfter).toHaveLength(1);
  });

  it("insertObservedPrincipleVersionWithGroundingChecks creates a new version with truthful provenance, principleType preserved, raw historical Evidence remains fully retrievable", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle, version: v1 } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Original statement.",
      evidence: [
        { interviewAnswerId: answerAId, stance: "supporting", description: "d1" },
        { interviewAnswerId: answerBId, stance: "supporting", description: "d2" },
      ],
      supportingCount: 2,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const rawEvidence = await getEvidenceForStrategyPrinciple(db, principle.id);
    const survivorId = rawEvidence.find((e) => e.interviewAnswerId === answerAId)!.id;
    const rejectedId = rawEvidence.find((e) => e.interviewAnswerId === answerBId)!.id;

    const { version: v2 } = await insertObservedPrincipleVersionWithGroundingChecks(
      db,
      principle.id,
      {
        statementText: v1.statementText,
        principleType: "observed",
        evidenceStrength: "insufficient_evidence",
        independenceBasis: fixtureBasis(),
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
    expect(v2.principleType).toBe("observed");
    expect(v2.statementText).toBe(v1.statementText); // byte-identical
    expect(v2.supportingEvidenceCount).toBe(1);

    const v1Refetched = await db.query.strategyPrincipleVersions.findFirst({ where: (v, { eq }) => eq(v.id, v1.id) });
    expect(v1Refetched).toEqual(v1);

    const rawAfter = await getEvidenceForStrategyPrinciple(db, principle.id);
    expect(rawAfter).toHaveLength(2);
    expect(rawAfter.map((e) => e.id).sort()).toEqual([survivorId, rejectedId].sort());

    const effectiveV2 = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v2.id);
    expect(effectiveV2.map((e) => e.id)).toEqual([survivorId]);

    // Old version (never itself checked) still falls back to the full raw pool.
    const effectiveV1 = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v1.id);
    expect(effectiveV1.map((e) => e.id).sort()).toEqual([survivorId, rejectedId].sort());
  });

  it("preserves the existing UNIQUE(strategy_principle_id, version_number) concurrency invariant for this new insert path", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Race base statement.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });

    const makeCall = () =>
      insertObservedPrincipleVersionWithGroundingChecks(
        db,
        principle.id,
        {
          statementText: "Race base statement.",
          principleType: "observed",
          evidenceStrength: "insufficient_evidence",
          independenceBasis: fixtureBasis(),
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
      expect(
        isUniqueViolation(r.reason, "strategy_principle_versions_strategy_principle_id_version_numbe")
      ).toBe(true);
    }
    const versionNumbers = fulfilled.map((r) => r.value.version.versionNumber);
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
  });

  // Independent-hardening cross-identity guards, applied proactively this
  // time (learned from the DNA equivalent's own independent review):
  // neither UNIQUE(version_id, evidence_id) nor either FK proves both
  // sides belong to the SAME Strategy identity.
  it("insertObservedPrincipleVersionWithGroundingChecks refuses to persist a grounding check for Evidence belonging to a DIFFERENT Strategy principle", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle: principleA } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Principle A.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const { principle: principleB } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Principle B.",
      evidence: [{ interviewAnswerId: answerBId, stance: "supporting", description: "d2" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const evidenceOfB = (await getEvidenceForStrategyPrinciple(db, principleB.id))[0]!;

    await expect(
      insertObservedPrincipleVersionWithGroundingChecks(
        db,
        principleA.id,
        {
          statementText: "Principle A, extended.",
          principleType: "observed",
          evidenceStrength: "insufficient_evidence",
          independenceBasis: fixtureBasis(),
          supportingEvidenceCount: 1,
          contradictingEvidenceCount: 0,
          changeReason: "cross-identity attempt",
        },
        [{ evidenceId: evidenceOfB.id, verdict: "supported", reason: "mismatched" }]
      )
    ).rejects.toThrow(/do not all belong to Strategy principle/);

    const latestA = await getLatestStrategyPrincipleVersion(db, principleA.id);
    expect(latestA?.versionNumber).toBe(1);
  });

  it("insertGroundingChecksForPrincipleVersion refuses to persist a grounding check for Evidence belonging to a DIFFERENT Strategy principle than the target version's own identity", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);

    const { principle: principleA, version: versionA } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Principle A2.",
      evidence: [{ interviewAnswerId: answerAId, stance: "supporting", description: "d1" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const { principle: principleB } = await insertObservedPrincipleWithEvidence(db, investorId, {
      statement: "Principle B2.",
      evidence: [{ interviewAnswerId: answerBId, stance: "supporting", description: "d2" }],
      supportingCount: 1,
      contradictingCount: 0,
      evidenceStrength: "insufficient_evidence",
      independenceBasis: fixtureBasis(),
    });
    const evidenceOfB = (await getEvidenceForStrategyPrinciple(db, principleB.id))[0]!;

    await expect(
      insertGroundingChecksForPrincipleVersion(db, versionA.id, [
        { evidenceId: evidenceOfB.id, verdict: "supported", reason: "mismatched" },
      ])
    ).rejects.toThrow(/do not all belong to Strategy principle/);

    const effectiveA = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principleA.id, versionA.id);
    expect(effectiveA).toHaveLength(1);
    expect(effectiveA[0]!.interviewAnswerId).toBe(answerAId);
  });
});
