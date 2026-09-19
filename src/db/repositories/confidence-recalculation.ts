import { eq } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { dnaHypotheses, strategyPrinciples } from "@/db/schema";
import { getLatestDnaHypothesisVersion, recalculateDnaHypothesisConfidence } from "@/db/repositories/dna";
import { getLatestStrategyPrincipleVersion, recalculatePrincipleConfidence } from "@/db/repositories/strategy";
import {
  getEvidenceForDnaHypothesis,
  getGroundingChecksForDnaHypothesisVersion,
  getEvidenceForStrategyPrinciple,
  getGroundingChecksForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import {
  planConfidenceRecalculation,
  carryForwardGroundingChecks,
  CONFIDENCE_RECALCULATION_PROVENANCE,
  type ConfidenceRecalculationPlan,
  type TieredVersionSnapshot,
} from "@/lib/evidence/recalculate-confidence";
import type { EvidenceStrength } from "@/lib/dna/evidence-strength";

// Investor-level driver for Confidence Recalculation Remediation. Generic
// over every identity the investor owns — no identity ids, tickers or
// counts are named anywhere in production code. The real data is only
// ever a validation target of the read-only dry run below.

export interface ConfidenceRecalculationReportItem {
  domain: "dna" | "strategy";
  identityId: string;
  baseVersionId: string;
  baseVersionNumber: number;
  storedSupporting: number | null;
  storedContradicting: number | null;
  storedTier: EvidenceStrength | null;
  plan: ConfidenceRecalculationPlan;
  /** Only set when a version would be appended. */
  proposedProvenance: typeof CONFIDENCE_RECALCULATION_PROVENANCE | null;
  /** Grounding-check rows on the base version that would be carried forward. */
  baseGroundingCheckRows: number;
  effectiveEvidenceBefore: string[];
  /** What the appended version would resolve to, given the carried-forward checks. */
  effectiveEvidenceAfter: string[];
  effectiveEvidencePreserved: boolean;
}

function sameIds(a: readonly string[], b: readonly string[]) {
  const inB = new Set(b);
  return a.length === b.length && a.every((id) => inB.has(id));
}

function buildItem(
  domain: "dna" | "strategy",
  identityId: string,
  latest: TieredVersionSnapshot & { versionNumber: number },
  rawEvidence: readonly { id: string }[],
  baseChecks: readonly { evidenceId: string; verdict: "supported" | "unsupported"; reason: string }[]
): ConfidenceRecalculationReportItem {
  const plan = planConfidenceRecalculation(latest);
  const before = selectEffectiveEvidence(rawEvidence, baseChecks).map((e) => e.id);
  const after =
    plan.action === "append_recalculated_version"
      ? selectEffectiveEvidence(rawEvidence, carryForwardGroundingChecks(latest.id, baseChecks)).map((e) => e.id)
      : before;
  return {
    domain,
    identityId,
    baseVersionId: latest.id,
    baseVersionNumber: latest.versionNumber,
    storedSupporting: latest.supportingEvidenceCount,
    storedContradicting: latest.contradictingEvidenceCount,
    storedTier: latest.evidenceStrength,
    plan,
    proposedProvenance: plan.action === "append_recalculated_version" ? CONFIDENCE_RECALCULATION_PROVENANCE : null,
    baseGroundingCheckRows: baseChecks.length,
    effectiveEvidenceBefore: before,
    effectiveEvidenceAfter: after,
    effectiveEvidencePreserved: sameIds(before, after),
  };
}

// READ-ONLY. Plans every latest DNA and Strategy version the investor
// owns (all identities, all statuses) and reports what WOULD be appended.
export async function planConfidenceRecalculationsForInvestor(
  db: typeof Db,
  investorId: string
): Promise<ConfidenceRecalculationReportItem[]> {
  const items: ConfidenceRecalculationReportItem[] = [];

  const dna = await db.select({ id: dnaHypotheses.id }).from(dnaHypotheses).where(eq(dnaHypotheses.investorId, investorId));
  for (const { id } of dna) {
    const latest = await getLatestDnaHypothesisVersion(db, id);
    if (!latest) continue;
    const [raw, checks] = await Promise.all([
      getEvidenceForDnaHypothesis(db, id),
      getGroundingChecksForDnaHypothesisVersion(db, latest.id),
    ]);
    items.push(buildItem("dna", id, latest, raw, checks));
  }

  const strategy = await db
    .select({ id: strategyPrinciples.id })
    .from(strategyPrinciples)
    .where(eq(strategyPrinciples.investorId, investorId));
  for (const { id } of strategy) {
    const latest = await getLatestStrategyPrincipleVersion(db, id);
    if (!latest) continue;
    const [raw, checks] = await Promise.all([
      getEvidenceForStrategyPrinciple(db, id),
      getGroundingChecksForStrategyPrincipleVersion(db, latest.id),
    ]);
    items.push(buildItem("strategy", id, latest, raw, checks));
  }

  return items;
}

// WRITES. Runs the transactional executor for exactly the identities the
// planner flags; each executor re-plans against fresh state inside its own
// transaction, so a stale candidate list can never append a wrong version,
// and a second run finds nothing to do.
export async function applyConfidenceRecalculationsForInvestor(db: typeof Db, investorId: string) {
  const report = await planConfidenceRecalculationsForInvestor(db, investorId);
  const results: {
    domain: "dna" | "strategy";
    identityId: string;
    outcome: Awaited<ReturnType<typeof recalculateDnaHypothesisConfidence>> | Awaited<ReturnType<typeof recalculatePrincipleConfidence>>;
  }[] = [];

  for (const item of report) {
    if (item.plan.action !== "append_recalculated_version") continue;
    const outcome =
      item.domain === "dna"
        ? await recalculateDnaHypothesisConfidence(db, item.identityId)
        : await recalculatePrincipleConfidence(db, item.identityId);
    results.push({ domain: item.domain, identityId: item.identityId, outcome });
  }
  return results;
}
