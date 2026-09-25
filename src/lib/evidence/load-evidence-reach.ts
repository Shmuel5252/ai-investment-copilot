import type { db as Db } from "@/db/client";
import { getAllAnswersForInvestor } from "@/db/repositories/interview";
import { listDecisionStatementsForInvestor } from "@/db/repositories/decision-statements";
import { listActiveDnaHypothesesForInvestor } from "@/db/repositories/dna";
import { listStrategyPrinciplesForInvestor } from "@/db/repositories/strategy";
import { getCountingEvidenceForDnaVersion, getCountingEvidenceForStrategyPrincipleVersion } from "@/db/repositories/evidence";
import { loadIndependenceResolver } from "./load-independence-resolver";
import { computeClaimReach, summarizeReach, type ClaimForReach, type ClaimReach, type ReachSummary, type StatementForReach } from "./reach";

// The one DB wrapper for the reach engine (src/lib/evidence/reach.ts):
// active DNA hypotheses and OBSERVED Strategy principles (the two claim
// kinds with a tier), each read through the same counting-evidence path
// generation uses, plus every citable statement of the investor. Read-only.
export interface EvidenceReachView {
  claims: ClaimReach[];
  summary: ReachSummary;
}

/** provenance.generatedAt of a version produced by the given generate run; null for legacy, carried or recalculated versions. */
function generatedAtOf(provenanceJson: unknown, generator: "dna.generate" | "strategy.generateObserved"): Date | null {
  const p = provenanceJson as { generator?: unknown; generatedAt?: unknown } | null;
  if (!p || p.generator !== generator || typeof p.generatedAt !== "string") return null;
  const d = new Date(p.generatedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function loadEvidenceReach(db: typeof Db, investorId: string): Promise<EvidenceReachView> {
  const [answers, decisionStatements, hypotheses, principles] = await Promise.all([
    getAllAnswersForInvestor(db, investorId),
    listDecisionStatementsForInvestor(db, investorId),
    listActiveDnaHypothesesForInvestor(db, investorId),
    listStrategyPrinciplesForInvestor(db, investorId),
  ]);
  const independence = await loadIndependenceResolver(db, investorId, answers);

  const claims: ClaimForReach[] = [];
  for (const h of hypotheses) {
    const v = h.versions[0];
    if (!v) continue;
    const { effective } = await getCountingEvidenceForDnaVersion(db, h.id, v.id);
    claims.push({ id: h.id, kind: "dna_hypothesis", statementText: v.statementText, evidenceStrength: v.evidenceStrength, supportingCount: v.supportingEvidenceCount, contradictingCount: v.contradictingEvidenceCount, effective, generatedAt: generatedAtOf(v.provenanceJson, "dna.generate") });
  }
  for (const p of principles) {
    const v = p.versions[0];
    if (!v || v.principleType !== "observed" || v.evidenceStrength === null || v.supportingEvidenceCount === null || v.contradictingEvidenceCount === null) continue;
    const { effective } = await getCountingEvidenceForStrategyPrincipleVersion(db, p.id, v.id);
    claims.push({ id: p.id, kind: "strategy_principle", statementText: v.statementText, evidenceStrength: v.evidenceStrength, supportingCount: v.supportingEvidenceCount, contradictingCount: v.contradictingEvidenceCount, effective, generatedAt: generatedAtOf(v.provenanceJson, "strategy.generateObserved") });
  }

  const reaches = claims.map((c) => computeClaimReach(c, independence));
  const statements: StatementForReach[] = [
    ...answers.map((a) => ({ key: `answer:${a.id}`, createdAt: a.createdAt })),
    ...decisionStatements.map((s) => ({ key: s.statementId, createdAt: s.createdAt })),
  ];
  return { claims: reaches, summary: summarizeReach(reaches, statements) };
}
