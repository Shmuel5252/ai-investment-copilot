import { eq } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { dnaHypotheses, strategyPrinciples } from "@/db/schema";
import { getLatestDnaHypothesisVersion, recalculateDnaHypothesisIndependence } from "@/db/repositories/dna";
import { getLatestStrategyPrincipleVersion, recalculatePrincipleIndependence } from "@/db/repositories/strategy";
import {
  getEvidenceForDnaHypothesis,
  getGroundingChecksForDnaHypothesisVersion,
  getEvidenceForStrategyPrinciple,
  getGroundingChecksForStrategyPrincipleVersion,
} from "@/db/repositories/evidence";
import { selectEffectiveEvidence } from "@/lib/dna/effective-evidence";
import {
  planIndependenceRecalculation,
  citationsFromEvidence,
  INDEPENDENCE_RECALCULATION_PROVENANCE,
  type IndependenceRecalculationPlan,
} from "@/lib/evidence/recalculate-independence";
import { loadIndependenceResolver } from "@/lib/evidence/load-independence-resolver";
import type { EvidenceIndependenceResolver } from "@/lib/evidence/resolve-independence";
import type { EvidenceStrength } from "@/lib/dna/evidence-strength";

// Investor-level driver for the independence recalculation. Generic over
// every identity the investor owns — no identity ids, tickers or counts are
// named in production code; the real data is only ever a validation target
// of the read-only dry run below.

export interface IndependenceRecalculationReportItem {
  domain: "dna" | "strategy";
  identityId: string;
  baseVersionId: string;
  baseVersionNumber: number;
  storedSupporting: number | null;
  storedContradicting: number | null;
  storedTier: EvidenceStrength | null;
  plan: IndependenceRecalculationPlan;
  /** Only set when a version would be appended. */
  proposedProvenance: typeof INDEPENDENCE_RECALCULATION_PROVENANCE | null;
  /** The effective evidence the resolver counted (unchanged by an append: grounding checks are carried forward). */
  effectiveEvidenceIds: string[];
}

function buildItem(
  domain: "dna" | "strategy",
  identityId: string,
  latest: {
    id: string;
    versionNumber: number;
    evidenceStrength: EvidenceStrength | null;
    supportingEvidenceCount: number | null;
    contradictingEvidenceCount: number | null;
  },
  rawEvidence: readonly { id: string; interviewAnswerId: string | null; stance: "supporting" | "contradicting" }[],
  baseChecks: readonly { evidenceId: string; verdict: "supported" | "unsupported" }[],
  independence: EvidenceIndependenceResolver
): IndependenceRecalculationReportItem {
  const effective = selectEffectiveEvidence(rawEvidence, baseChecks);
  const plan = planIndependenceRecalculation(latest, citationsFromEvidence(effective), independence);
  return {
    domain,
    identityId,
    baseVersionId: latest.id,
    baseVersionNumber: latest.versionNumber,
    storedSupporting: latest.supportingEvidenceCount,
    storedContradicting: latest.contradictingEvidenceCount,
    storedTier: latest.evidenceStrength,
    plan,
    proposedProvenance: plan.action === "append_independence_version" ? INDEPENDENCE_RECALCULATION_PROVENANCE : null,
    effectiveEvidenceIds: effective.map((e) => e.id).sort(),
  };
}

// READ-ONLY. Plans every latest DNA and Strategy version the investor owns
// (all identities, all statuses) and reports what WOULD be appended, what
// is a no-op, and what needs human review because confidence would rise.
export async function planIndependenceRecalculationsForInvestor(
  db: typeof Db,
  investorId: string,
  independence?: EvidenceIndependenceResolver
): Promise<IndependenceRecalculationReportItem[]> {
  const resolver = independence ?? (await loadIndependenceResolver(db, investorId));
  const items: IndependenceRecalculationReportItem[] = [];

  const dna = await db.select({ id: dnaHypotheses.id }).from(dnaHypotheses).where(eq(dnaHypotheses.investorId, investorId));
  for (const { id } of dna) {
    const latest = await getLatestDnaHypothesisVersion(db, id);
    if (!latest) continue;
    const [raw, checks] = await Promise.all([
      getEvidenceForDnaHypothesis(db, id),
      getGroundingChecksForDnaHypothesisVersion(db, latest.id),
    ]);
    items.push(buildItem("dna", id, latest, raw, checks, resolver));
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
    items.push(buildItem("strategy", id, latest, raw, checks, resolver));
  }

  return items;
}

// WRITES. Runs the transactional executor for exactly the identities the
// planner flags for APPEND; each executor re-plans against fresh version and
// evidence state inside its own transaction, so a stale candidate list can
// never append a wrong version, and a second run finds nothing to do.
// Identities flagged requires_review are never touched.
export async function applyIndependenceRecalculationsForInvestor(
  db: typeof Db,
  investorId: string,
  independence?: EvidenceIndependenceResolver
) {
  const resolver = independence ?? (await loadIndependenceResolver(db, investorId));
  const report = await planIndependenceRecalculationsForInvestor(db, investorId, resolver);
  const results: {
    domain: "dna" | "strategy";
    identityId: string;
    outcome:
      | Awaited<ReturnType<typeof recalculateDnaHypothesisIndependence>>
      | Awaited<ReturnType<typeof recalculatePrincipleIndependence>>;
  }[] = [];

  for (const item of report) {
    if (item.plan.action !== "append_independence_version") continue;
    const outcome =
      item.domain === "dna"
        ? await recalculateDnaHypothesisIndependence(db, item.identityId, resolver)
        : await recalculatePrincipleIndependence(db, item.identityId, resolver);
    results.push({ domain: item.domain, identityId: item.identityId, outcome });
  }
  return results;
}
