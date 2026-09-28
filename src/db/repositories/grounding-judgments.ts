import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { db as Db, DbOrTx } from "@/db/client";
import { dnaHypotheses, evidence, groundingJudgments, strategyPrinciples } from "@/db/schema";
import { GroundingJudgmentConflictError, GroundingRunMismatchError, GroundingTechnicalFailureError, StaleIdentityVersionError } from "@/db/errors";
import type { GroundingJudgment, RemediationPlan } from "@/lib/dna/remediate-grounding";
import type { PrincipleRemediationPlan } from "@/lib/strategy/remediate-grounding";
import type { GroundingRun } from "@/lib/evidence/grounding-run";
import type { ArtifactProvenance } from "@/lib/evidence/provenance";
import { getLatestDnaHypothesisVersion, insertDnaHypothesisVersionWithGroundingChecks, insertGroundingChecksForVersion } from "./dna";
import { getLatestStrategyPrincipleVersion, insertGroundingChecksForPrincipleVersion, insertObservedPrincipleVersionWithGroundingChecks } from "./strategy";

// OD-R9 — the ONLY module that writes or reads the grounding judgment audit
// ledger (src/db/schema/grounding-judgments.ts). Append-only: insert and
// read, nothing else. AUDIT ONLY: nothing here, and nothing that calls it,
// feeds effective evidence, counts, tiers, visibility, generation, the
// Learning carry, Decision AI, Prior Record or a later remediation.
//
// The two apply functions are the persisted half of a grounding
// remediation. Planning (planGroundingRemediation /
// planPrincipleGroundingRemediation) is pure and writes nothing; a run plans
// every identity first, validates the whole run, and only then applies —
// ONE IDENTITY PER TRANSACTION. Inside that transaction the semantic writes
// the plan calls for (a new version with its checks, or check rows on the
// judged version, or nothing for no_op) and the judgments are written
// together or not at all. Identities are never joined into one transaction:
// a failure in one leaves the ones already applied complete and attributable
// to the same run id, and leaves the failed one untouched.
export type GroundingJudgmentRow = typeof groundingJudgments.$inferSelect;

export interface GroundingApplyResult {
  action: "no_op" | "checked_no_change" | "new_version";
  /** true: this run had already recorded exactly these judgments — nothing was written again. */
  replayed: boolean;
  judgmentsWritten: number;
  checkRowsWritten: number;
  /** The version a new_version plan created (on a replay: the one the first apply created). */
  newVersionId: string | null;
}

type Judged<P> = Exclude<P, { action: "technical_failure" }>;
type JudgedPlan = Judged<RemediationPlan | PrincipleRemediationPlan>;
interface Artifact {
  kind: "dna" | "strategy";
  identityId: string;
  judgedVersionId: string;
}

function requireJudgedPlan<P extends RemediationPlan | PrincipleRemediationPlan>(input: P, identityId: string): Judged<P> {
  const plan: RemediationPlan | PrincipleRemediationPlan = input;
  if (plan.action === "technical_failure") {
    throw new GroundingTechnicalFailureError(
      `Identity ${identityId}: the grounding plan is a technical failure (${plan.failures.map((f) => f.evidenceId).join(", ")}) — nothing was judged, nothing is persisted.`
    );
  }
  // A judgment and the check row written for the same citation must say the same thing.
  if (plan.action !== "no_op") {
    for (const j of plan.judgments) {
      const check = plan.checks.find((c) => c.evidenceId === j.evidenceId);
      if (!check || check.verdict !== j.verdict || check.reason !== j.reason) {
        throw new GroundingJudgmentConflictError(`Identity ${identityId}: the judgment for evidence ${j.evidenceId} does not match its grounding check.`);
      }
    }
  }
  if (new Set(plan.judgments.map((j) => j.evidenceId)).size !== plan.judgments.length) {
    throw new GroundingJudgmentConflictError(`Identity ${identityId}: a citation was judged more than once in one plan.`);
  }
  return input as Judged<P>;
}

const sameJudgment = (row: GroundingJudgmentRow, artifact: Artifact, run: GroundingRun, action: JudgedPlan["action"], j: GroundingJudgment) =>
  (artifact.kind === "dna" ? row.dnaHypothesisVersionId : row.strategyPrincipleVersionId) === artifact.judgedVersionId &&
  row.verdict === j.verdict &&
  row.reason === j.reason &&
  row.contextSupplied === j.contextSupplied &&
  row.contract === run.contract &&
  row.semanticRule === run.semanticRule &&
  row.model === run.model &&
  row.codeVersion === run.codeVersion &&
  row.plannerAction === action;

// Has this run already recorded these citations? Identical -> replay (write
// nothing). Anything else -> refuse: a retry never masquerades as the
// recorded judgment, and an old judgment is never updated.
async function findReplay(tx: DbOrTx, artifact: Artifact, run: GroundingRun, plan: JudgedPlan): Promise<GroundingApplyResult | null> {
  // Everything this run recorded for the judged version OR for any of these
  // citations: a plan that presents only some of the recorded judgments, or
  // more than were recorded, is not the same apply.
  const judgedVersion = eq(artifact.kind === "dna" ? groundingJudgments.dnaHypothesisVersionId : groundingJudgments.strategyPrincipleVersionId, artifact.judgedVersionId);
  const judgedIds = plan.judgments.map((j) => j.evidenceId);
  const existing = await tx
    .select()
    .from(groundingJudgments)
    .where(and(eq(groundingJudgments.runId, run.runId), judgedIds.length > 0 ? or(judgedVersion, inArray(groundingJudgments.evidenceId, judgedIds)) : judgedVersion));
  if (existing.length === 0) return null;
  const identical =
    existing.length === plan.judgments.length &&
    plan.judgments.every((j) => {
      const row = existing.find((r) => r.evidenceId === j.evidenceId);
      return row !== undefined && sameJudgment(row, artifact, run, plan.action, j);
    });
  if (!identical) {
    throw new GroundingJudgmentConflictError(
      `Identity ${artifact.identityId}: run ${run.runId} already recorded a different judgment for these citations — refusing to write; a new judgment needs a new run.`
    );
  }
  const first = existing[0]!;
  return {
    action: plan.action,
    replayed: true,
    judgmentsWritten: 0,
    checkRowsWritten: 0,
    newVersionId: artifact.kind === "dna" ? first.resultingDnaHypothesisVersionId : first.resultingStrategyPrincipleVersionId,
  };
}

async function assertRunMetadata(tx: DbOrTx, run: GroundingRun): Promise<void> {
  const [other] = await tx.select().from(groundingJudgments).where(eq(groundingJudgments.runId, run.runId)).limit(1);
  if (other && (other.contract !== run.contract || other.semanticRule !== run.semanticRule || other.model !== run.model || other.codeVersion !== run.codeVersion)) {
    throw new GroundingRunMismatchError(`Run ${run.runId} already has judgments recorded under a different contract, rule, model or code version.`);
  }
}

async function insertJudgments(tx: DbOrTx, artifact: Artifact, run: GroundingRun, plan: JudgedPlan, resultingVersionId: string | null): Promise<number> {
  if (plan.judgments.length === 0) return 0;
  const rows = await tx
    .insert(groundingJudgments)
    .values(
      plan.judgments.map((j) => ({
        runId: run.runId,
        dnaHypothesisVersionId: artifact.kind === "dna" ? artifact.judgedVersionId : null,
        strategyPrincipleVersionId: artifact.kind === "strategy" ? artifact.judgedVersionId : null,
        evidenceId: j.evidenceId,
        verdict: j.verdict,
        reason: j.reason,
        contextSupplied: j.contextSupplied,
        contract: run.contract,
        semanticRule: run.semanticRule,
        model: run.model,
        codeVersion: run.codeVersion,
        plannerAction: plan.action,
        resultingDnaHypothesisVersionId: artifact.kind === "dna" ? resultingVersionId : null,
        resultingStrategyPrincipleVersionId: artifact.kind === "strategy" ? resultingVersionId : null,
      }))
    )
    .returning({ id: groundingJudgments.id });
  return rows.length;
}

export interface ApplyDnaGroundingRemediationInput {
  dnaHypothesisId: string;
  /** The version the plan was computed against — it must still be the identity's latest. */
  judgedVersionId: string;
  plan: RemediationPlan;
  run: GroundingRun;
  /** Provenance of the version a new_version plan creates; ignored otherwise. */
  provenance: ArtifactProvenance | null;
}

export async function applyDnaGroundingRemediation(db: typeof Db, input: ApplyDnaGroundingRemediationInput): Promise<GroundingApplyResult> {
  const plan = requireJudgedPlan(input.plan, input.dnaHypothesisId);
  const artifact: Artifact = { kind: "dna", identityId: input.dnaHypothesisId, judgedVersionId: input.judgedVersionId };

  return db.transaction(async (tx) => {
    await tx.select({ id: dnaHypotheses.id }).from(dnaHypotheses).where(eq(dnaHypotheses.id, input.dnaHypothesisId)).for("update");

    const replay = await findReplay(tx, artifact, input.run, plan);
    if (replay) return replay;
    await assertRunMetadata(tx, input.run);

    const latest = await getLatestDnaHypothesisVersion(tx, input.dnaHypothesisId);
    if (!latest || latest.id !== input.judgedVersionId) {
      throw new StaleIdentityVersionError(input.dnaHypothesisId, `the plan judged version ${input.judgedVersionId}, which is not the latest version`);
    }
    const judgedIds = plan.judgments.map((j) => j.evidenceId);
    if (judgedIds.length > 0) {
      const owned = await tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.dnaHypothesisId, input.dnaHypothesisId), inArray(evidence.id, judgedIds)));
      if (owned.length !== judgedIds.length) throw new GroundingJudgmentConflictError(`Judged evidence ids do not all belong to DNA hypothesis ${input.dnaHypothesisId}.`);
    }

    let newVersionId: string | null = null;
    let checkRowsWritten = 0;
    if (plan.action === "new_version") {
      newVersionId = (await insertDnaHypothesisVersionWithGroundingChecks(tx, input.dnaHypothesisId, plan.version, plan.checks, input.provenance)).version.id;
      checkRowsWritten = plan.checks.length;
    } else if (plan.action === "checked_no_change") {
      checkRowsWritten = (await insertGroundingChecksForVersion(tx, input.judgedVersionId, plan.checks)).length;
    }
    const judgmentsWritten = await insertJudgments(tx, artifact, input.run, plan, newVersionId);
    return { action: plan.action, replayed: false, judgmentsWritten, checkRowsWritten, newVersionId };
  });
}

export interface ApplyStrategyGroundingRemediationInput {
  strategyPrincipleId: string;
  /** The version the plan was computed against — it must still be the principle's latest. */
  judgedVersionId: string;
  plan: PrincipleRemediationPlan;
  run: GroundingRun;
  /** Provenance of the version a new_version plan creates; ignored otherwise. */
  provenance: ArtifactProvenance | null;
}

// The Strategy mirror of applyDnaGroundingRemediation. The Strategy BUNDLE
// tables are not touched: a whole-Strategy version only ever moves on
// explicit user approval.
export async function applyStrategyGroundingRemediation(db: typeof Db, input: ApplyStrategyGroundingRemediationInput): Promise<GroundingApplyResult> {
  const plan = requireJudgedPlan(input.plan, input.strategyPrincipleId);
  const artifact: Artifact = { kind: "strategy", identityId: input.strategyPrincipleId, judgedVersionId: input.judgedVersionId };

  return db.transaction(async (tx) => {
    await tx.select({ id: strategyPrinciples.id }).from(strategyPrinciples).where(eq(strategyPrinciples.id, input.strategyPrincipleId)).for("update");

    const replay = await findReplay(tx, artifact, input.run, plan);
    if (replay) return replay;
    await assertRunMetadata(tx, input.run);

    const latest = await getLatestStrategyPrincipleVersion(tx, input.strategyPrincipleId);
    if (!latest || latest.id !== input.judgedVersionId) {
      throw new StaleIdentityVersionError(input.strategyPrincipleId, `the plan judged version ${input.judgedVersionId}, which is not the latest version`);
    }
    const judgedIds = plan.judgments.map((j) => j.evidenceId);
    if (judgedIds.length > 0) {
      const owned = await tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.strategyPrincipleId, input.strategyPrincipleId), inArray(evidence.id, judgedIds)));
      if (owned.length !== judgedIds.length) throw new GroundingJudgmentConflictError(`Judged evidence ids do not all belong to Strategy principle ${input.strategyPrincipleId}.`);
    }

    let newVersionId: string | null = null;
    let checkRowsWritten = 0;
    if (plan.action === "new_version") {
      newVersionId = (await insertObservedPrincipleVersionWithGroundingChecks(tx, input.strategyPrincipleId, plan.version, plan.checks, input.provenance)).version.id;
      checkRowsWritten = plan.checks.length;
    } else if (plan.action === "checked_no_change") {
      checkRowsWritten = (await insertGroundingChecksForPrincipleVersion(tx, input.judgedVersionId, plan.checks)).length;
    }
    const judgmentsWritten = await insertJudgments(tx, artifact, input.run, plan, newVersionId);
    return { action: plan.action, replayed: false, judgmentsWritten, checkRowsWritten, newVersionId };
  });
}

// Audit / reporting read: every judgment one run recorded, in a stable order.
// Never a semantic input.
export async function listGroundingJudgmentsForRun(db: DbOrTx, runId: string): Promise<GroundingJudgmentRow[]> {
  return db.select().from(groundingJudgments).where(eq(groundingJudgments.runId, runId)).orderBy(asc(groundingJudgments.judgedAt), asc(groundingJudgments.evidenceId));
}
