// Open-Decision Monitoring V1 — the one deterministic derivation of "which
// decisions need the investor's attention, and why" (docs/architecture.md
// §2.9, docs/data-model.md §5 "Decision Monitoring (נגזר)"). Pure: no DB,
// no clock (`today` is an input), no AI, no market data. Attention is
// DERIVED ON READ and never persisted; the frozen DecisionSnapshot,
// reviews and predictions are inputs only and are never interpreted as
// intent ("Facts != Interpretation"). loadDecisionAttention()
// (load-decision-attention.ts) is the one DB wrapper real callers use.
//
// Exactly four reasons (frozen 2026-09-23):
//   REVIEW_DUE                    review_by_date <= today and no review dated
//                                 at/after it. NULL never fires.
//   PREDICTION_DUE                a pending prediction whose checkable_by_date
//                                 <= today. NULL never fires; nothing is
//                                 resolved automatically.
//   NEW_EXECUTION_AFTER_DECISION  a same-ticker BUY/SELL dated AFTER the
//                                 decision day that entered the system after
//                                 the baseline. A fact about the history,
//                                 never "this executed the decision".
//   HISTORY_BACKFILLED            a same-ticker BUY/SELL dated BEFORE the
//                                 decision day that entered the system after
//                                 the snapshot was frozen and after the
//                                 baseline — "historical transaction
//                                 information was added after this
//                                 decision/review", nothing more.
//
// Baseline = the latest DecisionReview date if one exists, else the decision
// date: a review absorbs every fact already known when it was written, so
// the same fact can never nag twice. Same-day transactions are LISTED but
// never counted as "after" (intraday order between a decision and a trade
// is unknowable here; created_at is not used to guess it).
//
// Calendar days: date-only values (transaction_date, review_by_date) are
// calendar dates encoded at 00:00Z by construction (import, manual entry,
// corporate actions) and are read by their UTC date components; instants
// (decision_date, review_date, checkable_by_date, created_at, today) are
// placed on the investor's own calendar through the IANA `timeZone` the
// client resolves — the same zone every date in the UI is rendered in — so a
// decision recorded at 00:30 in Jerusalem belongs to that Jerusalem day, not
// to the previous UTC day (found in the unit's final review: on the UTC day a
// same-local-day trade became a false "after"). No fixed zone is assumed and
// none is defaulted. Fail-closed: if the persisted history does not reach the
// decision day, no execution-based reason is produced at all.

export const ATTENTION_REASONS = [
  "REVIEW_DUE",
  "PREDICTION_DUE",
  "NEW_EXECUTION_AFTER_DECISION",
  "HISTORY_BACKFILLED",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export type MonitoringState = "attention" | "monitoring" | "settled";

export interface AttentionDecisionInput {
  id: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
  reviewByDate: Date | null;
  /** null when the decision has no snapshot (impossible via decisions.create, tolerated fail-closed). */
  snapshot: { createdAt: Date; frozenHoldingQuantity: number | null } | null;
  predictions: { id: string; status: string; checkableByDate: Date | null }[];
  reviews: { id: string; reviewDate: Date }[];
}

export interface AttentionTransactionInput {
  id: string;
  ticker: string | null;
  transactionType: string;
  quantity: number | null;
  price: number | null;
  transactionDate: Date;
  /** When the row entered the system — the novelty clock, never the economic date. */
  createdAt: Date;
}

export interface AttentionPortfolioInput {
  /** "ok" = computePositions ran with zero warnings; "warnings" = ran but untrusted; "unavailable" = it threw. */
  status: "ok" | "warnings" | "unavailable";
  warningCount: number;
  positions: { ticker: string; quantity: number; costBasisPerShare: number | null }[];
  episodeKeyByTransactionId: ReadonlyMap<string, string>;
}

export interface DeriveDecisionAttentionInput {
  today: Date;
  /** IANA zone the investor's UI renders dates in (e.g. "Asia/Jerusalem"); validated, never defaulted. */
  timeZone: string;
  /** getHistoryFreshness().latestTransactionDate — null when no history at all. */
  historyLatestTransactionDate: Date | null;
  decisions: AttentionDecisionInput[];
  transactions: AttentionTransactionInput[];
  portfolio: AttentionPortfolioInput;
}

export interface ExecutionFact {
  transactionId: string;
  transactionType: string;
  transactionDate: Date;
  quantity: number | null;
  price: number | null;
  persistedAt: Date;
  /** Episode key from computePositions(), null when the portfolio is not trustworthy. */
  episodeKey: string | null;
}

export interface ExecutionFacts {
  /** "history_before_decision" = the persisted history does not reach the decision day: groups are empty, nothing is claimed. */
  status: "available" | "history_before_decision";
  historyThrough: Date | null;
  knownBefore: ExecutionFact[];
  backfilledBefore: ExecutionFact[];
  sameDay: ExecutionFact[];
  after: ExecutionFact[];
}

export interface DecisionMonitoringItem {
  decisionId: string;
  ticker: string;
  decisionType: string;
  decisionDate: Date;
  state: MonitoringState;
  reasons: AttentionReason[];
  baseline: { kind: "latest_review" | "decision"; at: Date };
  review: { reviewed: boolean; count: number; latestReviewDate: Date | null };
  horizon: { status: "not_set" | "upcoming" | "due" | "satisfied"; reviewByDate: Date | null };
  predictions: { total: number; pending: number; undated: number; due: { id: string; checkableByDate: Date }[] };
  execution: ExecutionFacts;
  /** The `after` facts that entered the system after the baseline (the NEW_EXECUTION_AFTER_DECISION facts). */
  newExecutionAfterDecision: ExecutionFact[];
  /** The `backfilledBefore` facts that entered the system after the baseline (the HISTORY_BACKFILLED facts). */
  backfilled: ExecutionFact[];
  position: {
    status: "ok" | "warnings" | "unavailable";
    /** null when the portfolio is not trustworthy — uncertainty is never turned into "flat" or "held". */
    held: boolean | null;
    quantity: number | null;
    costBasisPerShare: number | null;
    frozenHoldingQuantity: number | null;
    episodeKeys: string[];
  };
}

export interface DecisionAttentionResult {
  asOf: Date;
  timeZone: string;
  historyThrough: Date | null;
  portfolioStatus: AttentionPortfolioInput["status"];
  /** Every decision, in the deterministic order below. */
  items: DecisionMonitoringItem[];
  /** The subset with state === "attention", same order. */
  attention: DecisionMonitoringItem[];
  /** Decisions still monitored (not settled) that have no review date set. */
  monitoredWithoutHorizon: number;
}

const DAY_MS = 86_400_000;
const QUANTITY_EPSILON = 1e-9;

/** The calendar date encoded in a date-only value (stored at 00:00Z), as days since epoch. */
export function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}

export class InvalidTimeZoneError extends Error {}

/** Throws InvalidTimeZoneError unless `timeZone` is an IANA zone this runtime knows. */
export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
  } catch {
    throw new InvalidTimeZoneError(`Unknown time zone: ${timeZone}`);
  }
}

/** The calendar day an instant falls on in `timeZone`, as days since epoch (comparable with utcDay of a date-only value). */
export function calendarDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS);
}

export function deriveDecisionAttention(input: DeriveDecisionAttentionInput): DecisionAttentionResult {
  assertTimeZone(input.timeZone);
  const dayOf = (instant: Date) => calendarDay(instant, input.timeZone);
  const todayDay = dayOf(input.today);
  const historyDay = input.historyLatestTransactionDate === null ? null : utcDay(input.historyLatestTransactionDate);
  const trustworthy = input.portfolio.status === "ok";

  const items = input.decisions.map((decision): DecisionMonitoringItem => {
    const decisionDay = dayOf(decision.decisionDate);

    // --- review state + baseline ---------------------------------------
    const latestReview = decision.reviews.reduce<Date | null>(
      (latest, r) => (latest === null || r.reviewDate.getTime() > latest.getTime() ? r.reviewDate : latest),
      null
    );
    const baseline =
      latestReview !== null ? { kind: "latest_review" as const, at: latestReview } : { kind: "decision" as const, at: decision.decisionDate };

    // --- review horizon -------------------------------------------------
    let horizonStatus: DecisionMonitoringItem["horizon"]["status"] = "not_set";
    if (decision.reviewByDate !== null) {
      // A review on the horizon day (in the investor's calendar) satisfies it, whatever its time of day.
      const horizonDay = utcDay(decision.reviewByDate);
      const satisfied = decision.reviews.some((r) => dayOf(r.reviewDate) >= horizonDay);
      horizonStatus = satisfied ? "satisfied" : horizonDay <= todayDay ? "due" : "upcoming";
    }

    // --- predictions ----------------------------------------------------
    const pending = decision.predictions.filter((p) => p.status === "pending");
    const due = pending
      .filter((p): p is { id: string; status: string; checkableByDate: Date } => p.checkableByDate !== null && dayOf(p.checkableByDate) <= todayDay)
      .map((p) => ({ id: p.id, checkableByDate: p.checkableByDate }))
      .sort((a, b) => a.checkableByDate.getTime() - b.checkableByDate.getTime() || a.id.localeCompare(b.id));

    // --- execution facts (same ticker, BUY/SELL only) --------------------
    const toFact = (t: AttentionTransactionInput): ExecutionFact => ({
      transactionId: t.id,
      transactionType: t.transactionType,
      transactionDate: t.transactionDate,
      quantity: t.quantity,
      price: t.price,
      persistedAt: t.createdAt,
      episodeKey: trustworthy ? (input.portfolio.episodeKeyByTransactionId.get(t.id) ?? null) : null,
    });
    const byTime = (a: ExecutionFact, b: ExecutionFact) =>
      a.transactionDate.getTime() - b.transactionDate.getTime() || a.transactionId.localeCompare(b.transactionId);
    const trades = input.transactions
      .filter((t) => t.ticker === decision.ticker && (t.transactionType === "buy" || t.transactionType === "sell"))
      .map(toFact)
      .sort(byTime);
    const historyReachesDecision = historyDay !== null && historyDay >= decisionDay;
    const execution: ExecutionFacts = {
      status: historyReachesDecision ? "available" : "history_before_decision",
      historyThrough: input.historyLatestTransactionDate,
      knownBefore: [],
      backfilledBefore: [],
      sameDay: [],
      after: [],
    };
    if (historyReachesDecision) {
      for (const fact of trades) {
        const day = utcDay(fact.transactionDate);
        if (day > decisionDay) execution.after.push(fact);
        else if (day === decisionDay) execution.sameDay.push(fact);
        else if (decision.snapshot !== null && fact.persistedAt.getTime() > decision.snapshot.createdAt.getTime()) execution.backfilledBefore.push(fact);
        else execution.knownBefore.push(fact); // no snapshot => cannot prove "backfilled": fail closed into "known before"
      }
    }
    const novel = (f: ExecutionFact) => f.persistedAt.getTime() > baseline.at.getTime();
    const newExecutionAfterDecision = execution.after.filter(novel);
    const backfilled = execution.backfilledBefore.filter(novel);

    // --- reasons (fixed order) ------------------------------------------
    const reasons: AttentionReason[] = [];
    if (horizonStatus === "due") reasons.push("REVIEW_DUE");
    if (due.length > 0) reasons.push("PREDICTION_DUE");
    if (newExecutionAfterDecision.length > 0) reasons.push("NEW_EXECUTION_AFTER_DECISION");
    if (backfilled.length > 0) reasons.push("HISTORY_BACKFILLED");

    // --- derived state --------------------------------------------------
    const reviewed = decision.reviews.length > 0;
    const state: MonitoringState =
      reasons.length > 0
        ? "attention"
        : reviewed && pending.length === 0 && (horizonStatus === "not_set" || horizonStatus === "satisfied")
          ? "settled"
          : "monitoring";

    // --- position context (deterministic accounting only) ---------------
    const current = trustworthy ? input.portfolio.positions.find((p) => p.ticker === decision.ticker) : undefined;
    const episodeKeys = trustworthy
      ? [...new Set(trades.map((f) => f.episodeKey).filter((k): k is string => k !== null))].sort()
      : [];

    return {
      decisionId: decision.id,
      ticker: decision.ticker,
      decisionType: decision.decisionType,
      decisionDate: decision.decisionDate,
      state,
      reasons,
      baseline,
      review: { reviewed, count: decision.reviews.length, latestReviewDate: latestReview },
      horizon: { status: horizonStatus, reviewByDate: decision.reviewByDate },
      predictions: { total: decision.predictions.length, pending: pending.length, undated: pending.filter((p) => p.checkableByDate === null).length, due },
      execution,
      newExecutionAfterDecision,
      backfilled,
      position: {
        status: input.portfolio.status,
        held: trustworthy ? !!current && current.quantity > QUANTITY_EPSILON : null,
        quantity: current ? current.quantity : null,
        costBasisPerShare: current ? current.costBasisPerShare : null,
        frozenHoldingQuantity: decision.snapshot?.frozenHoldingQuantity ?? null,
        episodeKeys,
      },
    };
  });

  // Deterministic ordering: due reasons first by earliest due date, then the
  // newest novel fact, then decision date, then id. No scores.
  const earliestDue = (item: DecisionMonitoringItem): number | null => {
    const candidates: number[] = [];
    if (item.reasons.includes("REVIEW_DUE") && item.horizon.reviewByDate) candidates.push(item.horizon.reviewByDate.getTime());
    for (const p of item.predictions.due) candidates.push(p.checkableByDate.getTime());
    return candidates.length ? Math.min(...candidates) : null;
  };
  const newestFact = (item: DecisionMonitoringItem): number =>
    Math.max(0, ...[...item.newExecutionAfterDecision, ...item.backfilled].map((f) => f.persistedAt.getTime()));
  items.sort((a, b) => {
    const da = earliestDue(a), db = earliestDue(b);
    if (da !== null && db !== null && da !== db) return da - db;
    if ((da === null) !== (db === null)) return da === null ? 1 : -1;
    const fa = newestFact(a), fb = newestFact(b);
    if (fa !== fb) return fb - fa;
    return a.decisionDate.getTime() - b.decisionDate.getTime() || a.decisionId.localeCompare(b.decisionId);
  });

  return {
    asOf: input.today,
    timeZone: input.timeZone,
    historyThrough: input.historyLatestTransactionDate,
    portfolioStatus: input.portfolio.status,
    items,
    attention: items.filter((i) => i.state === "attention"),
    monitoredWithoutHorizon: items.filter((i) => i.state !== "settled" && i.horizon.status === "not_set").length,
  };
}
