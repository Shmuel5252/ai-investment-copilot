import { utcDay } from "@/lib/monitoring/decision-attention";

// Evidence Reach V1 (Unit 6) — the deterministic NEXT ACTION catalogue shown
// beside Open-Decision Monitoring on the dashboard. Pure: no DB, no AI, the
// clock is an input. It is NOT a fifth attention reason and never touches
// ATTENTION_REASONS: monitoring says what happened to a decision; this says
// what the investor can do next so the system learns more. Every action is
// FACT -> REASON -> DESTINATION, disappears once done, and the list order is
// fixed: catalogue order, then newest date first, then id.
export const NEXT_ACTION_KINDS = [
  "RESOLVE_EXECUTION_CANDIDATES",
  "REVIEW_UNREVIEWED_DECISION",
  "SET_REVIEW_HORIZON",
  "RESOLVE_OPEN_REENTRY_CONDITION",
  "CONTINUE_STALLED_CASE",
  "ADD_EPISODE_RATIONALE",
  "REGENERATE_WITH_UNUSED_EVIDENCE",
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

// V1 DASHBOARD POLICY (OD-R4, frozen 2026-09-25): adjustable product
// constants that shape suggestions only. They touch no evidence, no
// confidence, no AI input, no persisted record, and need no evidence-policy
// versioning. The values are not claimed to be empirically optimal.
/** An unreviewed decision with NO review date is nudged toward a review after this many days (UTC days of decision_date; the ±1 local-day edge is accepted V1 debt). */
export const REVIEW_WITHOUT_HORIZON_NUDGE_DAYS = 30;
/** A researching case whose updated_at is at least this many days old is "stalled". */
export const STALLED_CASE_DAYS = 14;

export interface NextActionDecisionInput {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
  reviewByDate: Date | null;
  reviewCount: number;
  /** OD-2 C: executable candidates no execution fact classifies. */
  unclassifiedCandidateCount: number;
}
export interface NextActionConditionInput {
  predictionId: string;
  decisionId: string;
  ticker: string;
  decisionType: string;
  checkableByDate: Date | null;
}
export interface NextActionCaseInput {
  id: string;
  ticker: string;
  status: string;
  updatedAt: Date;
}
export interface NextActionEpisodeInput {
  anchorable: boolean;
  hasRationale: boolean;
}
export interface NextActionReachDomainInput {
  uncitedStatements: number;
  /** src/lib/evidence/reach.ts — false once a generate run has already seen every statement. */
  regenerationMayChangeReach: boolean;
}
export interface NextActionReachInput {
  dna: NextActionReachDomainInput;
  strategy: NextActionReachDomainInput;
}

export interface NextActionsInput {
  today: Date;
  decisions: readonly NextActionDecisionInput[];
  openConditions: readonly NextActionConditionInput[];
  cases: readonly NextActionCaseInput[];
  episodes: readonly NextActionEpisodeInput[];
  reach: NextActionReachInput;
}

export interface NextAction {
  kind: NextActionKind;
  /** Stable key for React and for "disappears when done" checks. */
  key: string;
  destination: string;
  decision?: { id: string; ticker: string; decisionType: string; decisionDate: Date };
  count?: number;
  domain?: "dna" | "strategy";
  caseId?: string;
  ticker?: string;
  /** For the deterministic order only. */
  sortDate: Date;
}

const KIND_RANK = new Map(NEXT_ACTION_KINDS.map((k, i) => [k, i]));

export function deriveNextActions(input: NextActionsInput): NextAction[] {
  const today = utcDay(input.today);
  const out: NextAction[] = [];

  for (const d of input.decisions) {
    const decision = { id: d.id, ticker: d.ticker, decisionType: d.decisionType, decisionDate: d.decisionDate };
    if (d.unclassifiedCandidateCount > 0) {
      out.push({ kind: "RESOLVE_EXECUTION_CANDIDATES", key: `exec:${d.id}`, destination: `/decisions/${d.id}`, decision, count: d.unclassifiedCandidateCount, sortDate: d.decisionDate });
    }
    if (d.reviewCount === 0) {
      const horizonPassed = d.reviewByDate !== null && utcDay(d.reviewByDate) <= today;
      const oldEnough = d.reviewByDate === null && today - utcDay(d.decisionDate) >= REVIEW_WITHOUT_HORIZON_NUDGE_DAYS;
      if (horizonPassed || oldEnough) {
        out.push({ kind: "REVIEW_UNREVIEWED_DECISION", key: `review:${d.id}`, destination: `/decisions/${d.id}#review`, decision, sortDate: d.decisionDate });
      }
      if (d.reviewByDate === null) {
        out.push({ kind: "SET_REVIEW_HORIZON", key: `horizon:${d.id}`, destination: `/decisions/${d.id}`, decision, sortDate: d.decisionDate });
      }
    }
  }

  for (const c of input.openConditions) {
    if (c.checkableByDate === null || utcDay(c.checkableByDate) > today) continue;
    out.push({ kind: "RESOLVE_OPEN_REENTRY_CONDITION", key: `condition:${c.predictionId}`, destination: `/decisions/${c.decisionId}#predictions`, decision: { id: c.decisionId, ticker: c.ticker, decisionType: c.decisionType, decisionDate: c.checkableByDate }, sortDate: c.checkableByDate });
  }

  for (const k of input.cases) {
    if (k.status !== "researching" || today - utcDay(k.updatedAt) < STALLED_CASE_DAYS) continue;
    out.push({ kind: "CONTINUE_STALLED_CASE", key: `case:${k.id}`, destination: `/cases/${k.id}`, caseId: k.id, ticker: k.ticker, sortDate: k.updatedAt });
  }

  const missingRationale = input.episodes.filter((e) => e.anchorable && !e.hasRationale).length;
  if (missingRationale > 0) {
    out.push({ kind: "ADD_EPISODE_RATIONALE", key: "rationale", destination: "/journal", count: missingRationale, sortDate: input.today });
  }

  if (input.reach.dna.regenerationMayChangeReach) {
    out.push({ kind: "REGENERATE_WITH_UNUSED_EVIDENCE", key: "regen:dna", destination: "/dna", domain: "dna", count: input.reach.dna.uncitedStatements, sortDate: input.today });
  }
  if (input.reach.strategy.regenerationMayChangeReach) {
    out.push({ kind: "REGENERATE_WITH_UNUSED_EVIDENCE", key: "regen:strategy", destination: "/strategy", domain: "strategy", count: input.reach.strategy.uncitedStatements, sortDate: input.today });
  }

  return out.sort(
    (a, b) =>
      KIND_RANK.get(a.kind)! - KIND_RANK.get(b.kind)! ||
      b.sortDate.getTime() - a.sortDate.getTime() ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
