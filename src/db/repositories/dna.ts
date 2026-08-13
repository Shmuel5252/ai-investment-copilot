import { eq, desc } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { dnaHypotheses, dnaHypothesisVersions, evidence } from "@/db/schema";
import type { InferInsertModel } from "drizzle-orm";
import type { ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";

export type NewDnaHypothesis = InferInsertModel<typeof dnaHypotheses>;
export type NewDnaHypothesisVersion = InferInsertModel<typeof dnaHypothesisVersions>;

export async function insertDnaHypothesis(db: typeof Db, values: NewDnaHypothesis) {
  const [row] = await db.insert(dnaHypotheses).values(values).returning();
  return row!;
}

// Append-only — never call db.update(dnaHypothesisVersions) anywhere else.
export async function insertDnaHypothesisVersion(db: typeof Db, values: NewDnaHypothesisVersion) {
  const [row] = await db.insert(dnaHypothesisVersions).values(values).returning();
  return row!;
}

export async function getLatestDnaHypothesisVersion(db: typeof Db, dnaHypothesisId: string) {
  const [row] = await db
    .select()
    .from(dnaHypothesisVersions)
    .where(eq(dnaHypothesisVersions.dnaHypothesisId, dnaHypothesisId))
    .orderBy(desc(dnaHypothesisVersions.versionNumber))
    .limit(1);
  return row;
}

export async function listActiveDnaHypothesesForInvestor(db: typeof Db, investorId: string) {
  return db.query.dnaHypotheses.findMany({
    where: (h, { and, eq }) => and(eq(h.investorId, investorId), eq(h.status, "active")),
    with: {
      versions: { orderBy: (v, { desc }) => desc(v.versionNumber), limit: 1 },
    },
  });
}

// Writes a brand-new hypothesis (identity + first version) together
// with its already-validated Evidence rows, atomically. Called only
// with output from validateProposedHypotheses() — evidenceStrength and
// the supporting/contradicting counts are read from that validation
// result, never recomputed or trusted from raw AI output here.
export async function insertDnaHypothesisWithEvidence(
  db: typeof Db,
  investorId: string,
  hypothesis: ValidatedHypothesis
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx.insert(dnaHypotheses).values({ investorId }).returning();
    const [version] = await tx
      .insert(dnaHypothesisVersions)
      .values({
        dnaHypothesisId: identity!.id,
        versionNumber: 1,
        statementText: hypothesis.statement,
        evidenceStrength: hypothesis.evidenceStrength,
        supportingEvidenceCount: hypothesis.supportingCount,
        contradictingEvidenceCount: hypothesis.contradictingCount,
        createdBy: "ai_generated",
      })
      .returning();

    await tx.insert(evidence).values(
      hypothesis.evidence.map((e) => ({
        dnaHypothesisId: identity!.id,
        stance: e.stance,
        interviewAnswerId: e.interviewAnswerId,
        description: e.description,
      }))
    );

    return { hypothesis: identity!, version: version! };
  });
}

// The identity row's status (active|user_rejected) is a simple lifecycle
// flag, not a versioned judgment — mutable by design (docs/data-model.md
// §2: the DNAHypothesis identity row itself isn't in the immutable list,
// only DNAHypothesisVersion is).
export async function setDnaHypothesisStatus(
  db: typeof Db,
  dnaHypothesisId: string,
  status: "active" | "user_rejected"
) {
  await db.update(dnaHypotheses).set({ status }).where(eq(dnaHypotheses.id, dnaHypothesisId));
}
