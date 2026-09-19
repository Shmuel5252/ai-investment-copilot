// Confidence Recalculation Remediation — DB-level coverage: append-only
// behavior, byte-identical old rows, evidence/check preservation,
// idempotency and concurrency, for BOTH DNA and Strategy, plus the
// investor-level dry run / apply driver. Synthetic investors only.
//
// Migration rule (Autonomous Unit Contract): migration 0010
// (src/db/migrations/0010_confidence_recalculation.sql — two additive
// ALTER TYPE ... ADD VALUE statements) has been WRITTEN but is NOT
// authorized to be applied to the real project database in this unit.
// Every test below checks, at runtime, whether both enum values exist and
// calls skip() with a clear reason if not. Once the migration is applied
// they activate automatically with no code change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  insertDnaHypothesis,
  insertDnaHypothesisVersion,
  insertGroundingChecksForVersion,
  recalculateDnaHypothesisConfidence,
} from "@/db/repositories/dna";
import {
  insertStrategyPrinciple,
  insertStrategyPrincipleVersion,
  insertStrategyVersion,
  insertGroundingChecksForPrincipleVersion,
  recalculatePrincipleConfidence,
} from "@/db/repositories/strategy";
import {
  insertEvidence,
  getEvidenceForDnaHypothesis,
  getEffectiveEvidenceForDnaHypothesisVersion,
  getEvidenceForStrategyPrinciple,
  getEffectiveEvidenceForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import {
  planConfidenceRecalculationsForInvestor,
  applyConfidenceRecalculationsForInvestor,
} from "@/db/repositories/confidence-recalculation";
import { insertInterviewSession, insertInterviewAnswer } from "@/db/repositories/interview";

const client = postgres(process.env.DATABASE_URL!, { max: 12 });
const db = drizzle(client, { schema });

let investorId: string;
const answerIds: string[] = [];
let migrationApplied = false;
let counter = 0;

async function newInvestor(label: string) {
  const [investor] = await db
    .insert(schema.investors)
    .values({
      email: `confidence-recalculation-${label}-${Date.now()}-${counter++}@example.com`,
      passwordHash: "not-a-real-hash",
      displayName: "Confidence Recalculation Test",
    })
    .returning();
  return investor!.id;
}

async function seedAnswers(forInvestorId: string, n: number) {
  const session = await insertInterviewSession(db, { investorId: forInvestorId, origin: "guided_interview" });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = await insertInterviewAnswer(db, {
      interviewSessionId: session.id,
      transactionId: null,
      questionText: `Q${i}`,
      answerText: `Answer ${i}`,
    });
    ids.push(a.id);
  }
  return ids;
}

beforeAll(async () => {
  investorId = await newInvestor("main");
  answerIds.push(...(await seedAnswers(investorId, 4)));

  const labels = await client`
    select t.typname as typ, e.enumlabel as label
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    where e.enumlabel = 'system_confidence_recalculation'`;
  const types = new Set(labels.map((r) => r.typ as string));
  migrationApplied = types.has("dna_created_by") && types.has("principle_created_by");
});

afterAll(async () => {
  await client.end();
});

const SKIP_REASON =
  "migration 0010 (system_confidence_recalculation enum values) not applied to this database yet — see Migration rule in this file's header comment";

const STALE = { evidenceStrength: "moderate" as const, supportingEvidenceCount: 2, contradictingEvidenceCount: 1 };

// A latest DNA version whose stored tier (moderate at S=2,C=1) predates the
// current semantics. Evidence is identity-linked: 2 supporting + 1
// contradicting, plus (withRejected) one more supporting citation that a
// version-scoped grounding check excludes — the shape where a naive new
// version would silently re-admit it.
async function seedStaleDna(forInvestorId: string, answers: string[], withRejected = false) {
  const h = await insertDnaHypothesis(db, { investorId: forInvestorId });
  const v1 = await insertDnaHypothesisVersion(db, {
    dnaHypothesisId: h.id,
    versionNumber: 1,
    statementText: "DNA statement — must stay byte-identical.",
    ...STALE,
    createdBy: "ai_generated",
    changeReason: null,
  });
  const ev = [
    await insertEvidence(db, { dnaHypothesisId: h.id, stance: "supporting", interviewAnswerId: answers[0]!, description: "s1" }),
    await insertEvidence(db, { dnaHypothesisId: h.id, stance: "supporting", interviewAnswerId: answers[1]!, description: "s2" }),
    await insertEvidence(db, { dnaHypothesisId: h.id, stance: "contradicting", interviewAnswerId: answers[2]!, description: "c1" }),
  ];
  if (withRejected) {
    const rejected = await insertEvidence(db, { dnaHypothesisId: h.id, stance: "supporting", interviewAnswerId: answers[3]!, description: "rejected" });
    ev.push(rejected);
    await insertGroundingChecksForVersion(db, v1.id, [
      { evidenceId: ev[0]!.id, verdict: "supported", reason: "matches s1" },
      { evidenceId: ev[1]!.id, verdict: "supported", reason: "matches s2" },
      { evidenceId: ev[2]!.id, verdict: "supported", reason: "genuinely contradicts" },
      { evidenceId: rejected.id, verdict: "unsupported", reason: "describes a different scenario" },
    ]);
  }
  return { hypothesis: h, v1, evidence: ev };
}

async function seedStaleStrategy(forInvestorId: string, answers: string[], withRejected = false) {
  const p = await insertStrategyPrinciple(db, { investorId: forInvestorId, key: `recalc-${Date.now()}-${counter++}` });
  const v1 = await insertStrategyPrincipleVersion(db, {
    strategyPrincipleId: p.id,
    versionNumber: 1,
    principleType: "observed",
    statementText: "Strategy statement — must stay byte-identical.",
    rationaleText: "Rationale that must be preserved.",
    createdBy: "ai_observed",
    changeReason: null,
    ...STALE,
  });
  const ev = [
    await insertEvidence(db, { strategyPrincipleId: p.id, stance: "supporting", interviewAnswerId: answers[0]!, description: "s1" }),
    await insertEvidence(db, { strategyPrincipleId: p.id, stance: "supporting", interviewAnswerId: answers[1]!, description: "s2" }),
    await insertEvidence(db, { strategyPrincipleId: p.id, stance: "contradicting", interviewAnswerId: answers[2]!, description: "c1" }),
  ];
  if (withRejected) {
    const rejected = await insertEvidence(db, { strategyPrincipleId: p.id, stance: "supporting", interviewAnswerId: answers[3]!, description: "rejected" });
    ev.push(rejected);
    await insertGroundingChecksForPrincipleVersion(db, v1.id, [
      { evidenceId: ev[0]!.id, verdict: "supported", reason: "matches s1" },
      { evidenceId: ev[1]!.id, verdict: "supported", reason: "matches s2" },
      { evidenceId: ev[2]!.id, verdict: "supported", reason: "genuinely contradicts" },
      { evidenceId: rejected.id, verdict: "unsupported", reason: "describes a different scenario" },
    ]);
  }
  return { principle: p, v1, evidence: ev };
}

const dnaVersions = (id: string) =>
  db.select().from(schema.dnaHypothesisVersions).where(eq(schema.dnaHypothesisVersions.dnaHypothesisId, id)).orderBy(asc(schema.dnaHypothesisVersions.versionNumber));
const strategyVersions = (id: string) =>
  db.select().from(schema.strategyPrincipleVersions).where(eq(schema.strategyPrincipleVersions.strategyPrincipleId, id)).orderBy(asc(schema.strategyPrincipleVersions.versionNumber));
const dnaChecks = (versionId: string) =>
  db.select().from(schema.dnaEvidenceGroundingChecks).where(eq(schema.dnaEvidenceGroundingChecks.dnaHypothesisVersionId, versionId));
const strategyChecks = (versionId: string) =>
  db.select().from(schema.strategyEvidenceGroundingChecks).where(eq(schema.strategyEvidenceGroundingChecks.strategyPrincipleVersionId, versionId));
const json = (v: unknown) => JSON.stringify(v);

describe("Strategy — stale latest version is corrected append-only", () => {
  it("appends exactly one version; the old row is byte-identical; statement/principleType/rationale/S/C are preserved; provenance is system_confidence_recalculation; evidence is untouched", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { principle, v1 } = await seedStaleStrategy(investorId, answerIds);
    const versionsBefore = await strategyVersions(principle.id);
    const evidenceBefore = await getEvidenceForStrategyPrinciple(db, principle.id);
    const effectiveBefore = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v1.id);

    const outcome = await recalculatePrincipleConfidence(db, principle.id);

    expect(outcome.action).toBe("appended");
    const versionsAfter = await strategyVersions(principle.id);
    expect(versionsAfter).toHaveLength(2);
    expect(json(versionsAfter[0])).toBe(json(versionsBefore[0])); // old version byte-identical

    const v2 = versionsAfter[1]!;
    expect(v2.strategyPrincipleId).toBe(principle.id);
    expect(v2.versionNumber).toBe(2);
    expect(v2.statementText).toBe(v1.statementText);
    expect(v2.principleType).toBe("observed");
    expect(v2.rationaleText).toBe(v1.rationaleText);
    expect(v2.supportingEvidenceCount).toBe(2);
    expect(v2.contradictingEvidenceCount).toBe(1);
    expect(v2.evidenceStrength).toBe("insufficient_evidence");
    expect(v2.createdBy).toBe("system_confidence_recalculation");
    expect(v2.changeReason).toContain("moderate -> insufficient_evidence");

    const evidenceAfter = await getEvidenceForStrategyPrinciple(db, principle.id);
    expect(json(evidenceAfter)).toBe(json(evidenceBefore)); // no duplicates, no edits
    expect(evidenceAfter).toHaveLength(3);
    const effectiveAfter = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v2.id);
    expect(effectiveAfter.map((e) => e.id).sort()).toEqual(effectiveBefore.map((e) => e.id).sort());
  });

  it("version-scoped grounding checks are carried forward, so the effective set does not re-admit the rejected citation", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { principle, v1, evidence } = await seedStaleStrategy(investorId, answerIds, true);
    const oldChecksBefore = await strategyChecks(v1.id);
    const effectiveBefore = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, v1.id);
    expect(effectiveBefore).toHaveLength(3); // the rejected citation is excluded

    const outcome = await recalculatePrincipleConfidence(db, principle.id);
    if (outcome.action !== "appended") throw new Error("expected appended");
    expect(outcome.carriedForwardChecks).toBe(4);

    const newChecks = await strategyChecks(outcome.version.id);
    expect(newChecks).toHaveLength(4);
    expect(newChecks.map((c) => [c.evidenceId, c.verdict]).sort()).toEqual(
      evidence.map((e) => [e.id, e.description === "rejected" ? "unsupported" : "supported"]).sort()
    );
    for (const c of newChecks) {
      expect(c.reason).toContain(`Carried forward unchanged from version ${v1.id}`);
      expect(c.reason).toContain("Original reason:");
    }
    expect(json(await strategyChecks(v1.id))).toBe(json(oldChecksBefore)); // old version's checks untouched

    const effectiveAfter = await getEffectiveEvidenceForStrategyPrincipleVersion(db, principle.id, outcome.version.id);
    expect(effectiveAfter.map((e) => e.id).sort()).toEqual(effectiveBefore.map((e) => e.id).sort());
    expect(effectiveAfter.map((e) => e.id)).not.toContain(evidence.find((e) => e.description === "rejected")!.id);
  });
});

describe("DNA — stale latest version is corrected append-only", () => {
  it("appends exactly one version; the old row is byte-identical; statement/S/C are preserved; provenance is system_confidence_recalculation; evidence is untouched", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { hypothesis, v1 } = await seedStaleDna(investorId, answerIds);
    const versionsBefore = await dnaVersions(hypothesis.id);
    const evidenceBefore = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    const effectiveBefore = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v1.id);

    const outcome = await recalculateDnaHypothesisConfidence(db, hypothesis.id);

    expect(outcome.action).toBe("appended");
    const versionsAfter = await dnaVersions(hypothesis.id);
    expect(versionsAfter).toHaveLength(2);
    expect(json(versionsAfter[0])).toBe(json(versionsBefore[0]));

    const v2 = versionsAfter[1]!;
    expect(v2.dnaHypothesisId).toBe(hypothesis.id);
    expect(v2.versionNumber).toBe(2);
    expect(v2.statementText).toBe(v1.statementText);
    expect(v2.supportingEvidenceCount).toBe(2);
    expect(v2.contradictingEvidenceCount).toBe(1);
    expect(v2.evidenceStrength).toBe("insufficient_evidence");
    expect(v2.createdBy).toBe("system_confidence_recalculation");

    const evidenceAfter = await getEvidenceForDnaHypothesis(db, hypothesis.id);
    expect(json(evidenceAfter)).toBe(json(evidenceBefore));
    const effectiveAfter = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v2.id);
    expect(effectiveAfter.map((e) => e.id).sort()).toEqual(effectiveBefore.map((e) => e.id).sort());
  });

  it("version-scoped grounding checks are carried forward, so the effective set does not re-admit the rejected citation", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { hypothesis, v1, evidence } = await seedStaleDna(investorId, answerIds, true);
    const oldChecksBefore = await dnaChecks(v1.id);
    const effectiveBefore = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, v1.id);
    expect(effectiveBefore).toHaveLength(3);

    const outcome = await recalculateDnaHypothesisConfidence(db, hypothesis.id);
    if (outcome.action !== "appended") throw new Error("expected appended");
    expect(outcome.carriedForwardChecks).toBe(4);

    const newChecks = await dnaChecks(outcome.version.id);
    expect(newChecks.map((c) => [c.evidenceId, c.verdict]).sort()).toEqual(
      evidence.map((e) => [e.id, e.description === "rejected" ? "unsupported" : "supported"]).sort()
    );
    for (const c of newChecks) expect(c.reason).toContain(`Carried forward unchanged from version ${v1.id}`);
    expect(json(await dnaChecks(v1.id))).toBe(json(oldChecksBefore));

    const effectiveAfter = await getEffectiveEvidenceForDnaHypothesisVersion(db, hypothesis.id, outcome.version.id);
    expect(effectiveAfter.map((e) => e.id).sort()).toEqual(effectiveBefore.map((e) => e.id).sort());
    expect(effectiveAfter.map((e) => e.id)).not.toContain(evidence.find((e) => e.description === "rejected")!.id);
  });
});

describe("no-ops and idempotency", () => {
  it("L. a second (and third) run appends nothing — no version spam — for both domains", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const s = await seedStaleStrategy(investorId, answerIds);
    const d = await seedStaleDna(investorId, answerIds);

    expect((await recalculatePrincipleConfidence(db, s.principle.id)).action).toBe("appended");
    expect((await recalculateDnaHypothesisConfidence(db, d.hypothesis.id)).action).toBe("appended");
    for (let run = 0; run < 2; run++) {
      expect(await recalculatePrincipleConfidence(db, s.principle.id)).toEqual({ action: "no_op", reason: "already_current" });
      expect(await recalculateDnaHypothesisConfidence(db, d.hypothesis.id)).toEqual({ action: "no_op", reason: "already_current" });
    }
    expect(await strategyVersions(s.principle.id)).toHaveLength(2);
    expect(await dnaVersions(d.hypothesis.id)).toHaveLength(2);
  });

  it("K. an already-correct latest version is a no-op (nothing appended)", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const h = await insertDnaHypothesis(db, { investorId });
    await insertDnaHypothesisVersion(db, {
      dnaHypothesisId: h.id,
      versionNumber: 1,
      statementText: "Correct already.",
      evidenceStrength: "moderate",
      supportingEvidenceCount: 3,
      contradictingEvidenceCount: 0,
      createdBy: "ai_generated",
    });
    expect(await recalculateDnaHypothesisConfidence(db, h.id)).toEqual({ action: "no_op", reason: "already_current" });
    expect(await dnaVersions(h.id)).toHaveLength(1);
  });

  it("a declared principle (no tier) is a no-op, never an error", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const p = await insertStrategyPrinciple(db, { investorId, key: `declared-${Date.now()}-${counter++}` });
    await insertStrategyPrincipleVersion(db, {
      strategyPrincipleId: p.id,
      versionNumber: 1,
      principleType: "declared",
      statementText: "I keep positions small.",
      rationaleText: "stated",
      createdBy: "user_declared",
    });
    expect(await recalculatePrincipleConfidence(db, p.id)).toEqual({ action: "no_op", reason: "not_tiered" });
    expect(await strategyVersions(p.id)).toHaveLength(1);
  });
});

describe("M. concurrency — attempts can never create duplicate corrected versions", () => {
  it("8 concurrent Strategy recalculations of one stale principle append exactly ONE version", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { principle } = await seedStaleStrategy(investorId, answerIds, true);

    const outcomes = await Promise.all(Array.from({ length: 8 }, () => recalculatePrincipleConfidence(db, principle.id)));

    expect(outcomes.filter((o) => o.action === "appended")).toHaveLength(1);
    for (const o of outcomes.filter((o) => o.action === "no_op")) {
      expect(["already_current", "superseded_concurrently"]).toContain(o.reason);
    }
    const versions = await strategyVersions(principle.id);
    expect(versions).toHaveLength(2);
    expect(versions.filter((v) => v.createdBy === "system_confidence_recalculation")).toHaveLength(1);
    expect(await strategyChecks(versions[1]!.id)).toHaveLength(4); // carried exactly once, not per attempt
  });

  it("8 concurrent DNA recalculations of one stale hypothesis append exactly ONE version", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const { hypothesis } = await seedStaleDna(investorId, answerIds, true);

    const outcomes = await Promise.all(Array.from({ length: 8 }, () => recalculateDnaHypothesisConfidence(db, hypothesis.id)));

    expect(outcomes.filter((o) => o.action === "appended")).toHaveLength(1);
    const versions = await dnaVersions(hypothesis.id);
    expect(versions).toHaveLength(2);
    expect(versions.filter((v) => v.createdBy === "system_confidence_recalculation")).toHaveLength(1);
    expect(await dnaChecks(versions[1]!.id)).toHaveLength(4);
  });
});

describe("investor-level dry run and apply", () => {
  it("the dry run plans exactly the stale latest versions with ZERO writes; apply appends them once; a re-plan finds nothing; bundles are untouched", async (ctx) => {
    ctx.skip(!migrationApplied, SKIP_REASON);
    const owner = await newInvestor("driver");
    const answers = await seedAnswers(owner, 4);

    const staleDna = await seedStaleDna(owner, answers, true);
    const staleStrategy = await seedStaleStrategy(owner, answers, true);
    // Correct ones that must be left alone:
    const okDna = await insertDnaHypothesis(db, { investorId: owner });
    await insertDnaHypothesisVersion(db, { dnaHypothesisId: okDna.id, versionNumber: 1, statementText: "ok", evidenceStrength: "insufficient_evidence", supportingEvidenceCount: 1, contradictingEvidenceCount: 0, createdBy: "ai_generated" });
    const declared = await insertStrategyPrinciple(db, { investorId: owner, key: `declared-driver-${Date.now()}` });
    await insertStrategyPrincipleVersion(db, { strategyPrincipleId: declared.id, versionNumber: 1, principleType: "declared", statementText: "declared", rationaleText: "r", createdBy: "user_declared" });
    // A whole-Strategy bundle pinned to the stale principle version.
    const bundle = await insertStrategyVersion(db, { investorId: owner, versionNumber: 1, changeSummary: "bundle" }, [staleStrategy.v1.id]);

    // Scoped to THIS investor's rows: other test files run in parallel and
    // write their own synthetic fixtures to the same tables.
    const snapshot = async () => {
      const dnaIds = (await db.select({ id: schema.dnaHypotheses.id }).from(schema.dnaHypotheses).where(eq(schema.dnaHypotheses.investorId, owner))).map((r) => r.id);
      const principleIds = (await db.select({ id: schema.strategyPrinciples.id }).from(schema.strategyPrinciples).where(eq(schema.strategyPrinciples.investorId, owner))).map((r) => r.id);
      const dnaVersionRows = await db.select().from(schema.dnaHypothesisVersions).where(inArray(schema.dnaHypothesisVersions.dnaHypothesisId, dnaIds)).orderBy(asc(schema.dnaHypothesisVersions.id));
      const strategyVersionRows = await db.select().from(schema.strategyPrincipleVersions).where(inArray(schema.strategyPrincipleVersions.strategyPrincipleId, principleIds)).orderBy(asc(schema.strategyPrincipleVersions.id));
      const bundles = await db.select().from(schema.strategyVersions).where(eq(schema.strategyVersions.investorId, owner)).orderBy(asc(schema.strategyVersions.id));
      return json({
        dna: dnaVersionRows,
        strategy: strategyVersionRows,
        dnaEvidence: await db.select().from(schema.evidence).where(inArray(schema.evidence.dnaHypothesisId, dnaIds)).orderBy(asc(schema.evidence.id)),
        strategyEvidence: await db.select().from(schema.evidence).where(inArray(schema.evidence.strategyPrincipleId, principleIds)).orderBy(asc(schema.evidence.id)),
        dnaChecks: await db.select().from(schema.dnaEvidenceGroundingChecks).where(inArray(schema.dnaEvidenceGroundingChecks.dnaHypothesisVersionId, dnaVersionRows.map((v) => v.id))).orderBy(asc(schema.dnaEvidenceGroundingChecks.id)),
        strategyChecks: await db.select().from(schema.strategyEvidenceGroundingChecks).where(inArray(schema.strategyEvidenceGroundingChecks.strategyPrincipleVersionId, strategyVersionRows.map((v) => v.id))).orderBy(asc(schema.strategyEvidenceGroundingChecks.id)),
        bundles,
        bundleRows: await db.select().from(schema.strategyVersionPrinciples).where(inArray(schema.strategyVersionPrinciples.strategyVersionId, bundles.map((b) => b.id))),
      });
    };

    const before = await snapshot();
    const report = await planConfidenceRecalculationsForInvestor(db, owner);
    expect(await snapshot()).toBe(before); // dry run: zero writes anywhere

    const planned = report.filter((r) => r.plan.action === "append_recalculated_version");
    expect(planned.map((r) => r.identityId).sort()).toEqual([staleDna.hypothesis.id, staleStrategy.principle.id].sort());
    for (const item of planned) {
      expect(item.storedTier).toBe("moderate");
      expect(item.proposedProvenance).toBe("system_confidence_recalculation");
      expect(item.effectiveEvidencePreserved).toBe(true);
      expect(item.baseGroundingCheckRows).toBe(4);
    }
    expect(report.filter((r) => r.plan.action === "no_op")).toHaveLength(report.length - 2);

    const applied = await applyConfidenceRecalculationsForInvestor(db, owner);
    expect(applied.map((a) => a.outcome.action)).toEqual(["appended", "appended"]);

    expect((await planConfidenceRecalculationsForInvestor(db, owner)).filter((r) => r.plan.action !== "no_op")).toHaveLength(0);
    expect(await applyConfidenceRecalculationsForInvestor(db, owner)).toEqual([]); // second apply: nothing to do

    // Bundle and its principle-version pointer are exactly as before.
    const bundleRows = await db.select().from(schema.strategyVersionPrinciples).where(eq(schema.strategyVersionPrinciples.strategyVersionId, bundle.id));
    expect(bundleRows.map((r) => r.strategyPrincipleVersionId)).toEqual([staleStrategy.v1.id]);
    expect(await db.select().from(schema.strategyVersions).where(eq(schema.strategyVersions.investorId, owner))).toHaveLength(1);
  });
});
