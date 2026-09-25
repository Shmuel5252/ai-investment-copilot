import { calculateEvidenceStrength, type EvidenceStrength } from "@/lib/dna/evidence-strength";
import type { CountableEvidence } from "./identity-evidence-for-counting";
import type { EvidenceIndependenceResolver } from "./resolve-independence";
import { statementKeyOf } from "./statement-ref";

// Evidence Reach V1 (Unit 2) — the pure, deterministic engine behind the
// investor-facing "why does the AI not use this yet" transparency. No DB,
// no AI, no clock. Every number here is either read from the persisted
// version (S, C, tier — what the record says) or derived from the shared
// resolver over the version's EFFECTIVE evidence (sources, unresolved
// decisions). The distance to the next tier is a plain search over the
// SAME threshold table (calculateEvidenceStrength) holding C fixed — it
// says how many more INDEPENDENT supporting cases would be needed, and
// nothing about which statement would provide them: one more answer about
// an already-counted episode is not a case.
const TIER_RANK: Record<EvidenceStrength, number> = { insufficient_evidence: 0, weak: 1, moderate: 2, strong: 3 };
const MAX_SEARCH = 50;

export interface TierDistance {
  nextTier: EvidenceStrength;
  /** Additional independent supporting cases (C unchanged) at which the tier first rises. */
  additionalSupportingCases: number;
}

export function distanceToNextTier(supporting: number, contradicting: number): TierDistance | null {
  const current = TIER_RANK[calculateEvidenceStrength(supporting, contradicting)];
  if (current === TIER_RANK.strong) return null;
  for (let k = 1; k <= MAX_SEARCH; k++) {
    const tier = calculateEvidenceStrength(supporting + k, contradicting);
    if (TIER_RANK[tier] > current) return { nextTier: tier, additionalSupportingCases: k };
  }
  return null;
}

export type ClaimKind = "dna_hypothesis" | "strategy_principle";

export interface ClaimForReach {
  id: string;
  kind: ClaimKind;
  statementText: string;
  evidenceStrength: EvidenceStrength;
  supportingCount: number;
  contradictingCount: number;
  /** The current version's EFFECTIVE, countable evidence (what its counts reflect). */
  effective: readonly CountableEvidence[];
  /** When this version was produced by its domain's GENERATE run (provenance.generatedAt); null for legacy/carried/recalculated versions. */
  generatedAt: Date | null;
}

export interface ClaimReach {
  id: string;
  kind: ClaimKind;
  statementText: string;
  tier: EvidenceStrength;
  supportingCount: number;
  contradictingCount: number;
  /** false = excluded from every narrative AI context (excludeInsufficientEvidence) — not "false", just below the threshold. */
  visibleToAi: boolean;
  sources: { interviewAnswers: number; decisionStatements: number };
  /** OD-2 C: cited decisions whose executable candidates are unclassified — review-only, counted on neither side. */
  unresolvedDecisionIds: string[];
  distance: TierDistance | null;
  /** statementKeyOf() of every effective citation. */
  citedStatementKeys: string[];
  generatedAt: Date | null;
}

export function computeClaimReach(claim: ClaimForReach, independence: EvidenceIndependenceResolver): ClaimReach {
  const basis = claim.effective.length > 0 ? independence.resolve(claim.effective) : null;
  const keys = [...new Set(claim.effective.map((e) => statementKeyOf(e)))].sort();
  return {
    id: claim.id,
    kind: claim.kind,
    statementText: claim.statementText,
    tier: claim.evidenceStrength,
    supportingCount: claim.supportingCount,
    contradictingCount: claim.contradictingCount,
    visibleToAi: claim.evidenceStrength !== "insufficient_evidence",
    sources: {
      interviewAnswers: keys.filter((k) => k.startsWith("answer:")).length,
      decisionStatements: keys.filter((k) => k.startsWith("decision:")).length,
    },
    unresolvedDecisionIds: [...(basis?.unresolvedDecisionIds ?? [])],
    distance: distanceToNextTier(claim.supportingCount, claim.contradictingCount),
    citedStatementKeys: keys,
    generatedAt: claim.generatedAt,
  };
}

export interface StatementForReach {
  /** statementKeyOf() form: "answer:<id>" | "decision:<id>:<kind>". */
  key: string;
  createdAt: Date;
}

export interface DomainReachSummary {
  claims: number;
  visibleToAi: number;
  insufficient: number;
  /** Statements of the investor no current claim of this domain cites — legitimate evidence the AI has not been shown through this domain. */
  uncitedStatements: number;
  unresolvedDecisions: number;
  /** The latest generate run that produced a current claim of this domain; null = no current claim carries generate provenance. */
  lastGeneratedAt: string | null;
  newestStatementAt: string | null;
  /**
   * The deterministic DONE condition of the "regenerate" next action: uncited
   * statements exist AND at least one statement entered the system after the
   * last generate run (or no generate run is on record). Once a run has seen
   * every statement, not citing one is the model's judgment, not missing reach.
   */
  regenerationMayChangeReach: boolean;
}

export interface ReachSummary {
  statements: { total: number; interviewAnswers: number; decisionStatements: number };
  dna: DomainReachSummary;
  strategy: DomainReachSummary;
}

const maxDate = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d !== null && (m === null || d.getTime() > m.getTime()) ? d : m), null);

function summarizeDomain(claims: readonly ClaimReach[], statements: readonly StatementForReach[]): DomainReachSummary {
  const cited = new Set(claims.flatMap((c) => c.citedStatementKeys));
  const uncited = statements.filter((s) => !cited.has(s.key)).length;
  const lastGeneratedAt = maxDate(claims.map((c) => c.generatedAt));
  const newestStatementAt = maxDate(statements.map((s) => s.createdAt));
  return {
    claims: claims.length,
    visibleToAi: claims.filter((c) => c.visibleToAi).length,
    insufficient: claims.filter((c) => !c.visibleToAi).length,
    uncitedStatements: uncited,
    unresolvedDecisions: new Set(claims.flatMap((c) => c.unresolvedDecisionIds)).size,
    lastGeneratedAt: lastGeneratedAt?.toISOString() ?? null,
    newestStatementAt: newestStatementAt?.toISOString() ?? null,
    regenerationMayChangeReach: uncited > 0 && (lastGeneratedAt === null || (newestStatementAt !== null && newestStatementAt.getTime() > lastGeneratedAt.getTime())),
  };
}

export function summarizeReach(claims: readonly ClaimReach[], statements: readonly StatementForReach[]): ReachSummary {
  return {
    statements: {
      total: statements.length,
      interviewAnswers: statements.filter((s) => s.key.startsWith("answer:")).length,
      decisionStatements: statements.filter((s) => s.key.startsWith("decision:")).length,
    },
    dna: summarizeDomain(claims.filter((c) => c.kind === "dna_hypothesis"), statements),
    strategy: summarizeDomain(claims.filter((c) => c.kind === "strategy_principle"), statements),
  };
}
