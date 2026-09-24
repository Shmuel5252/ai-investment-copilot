// Prior Record Brief V1 — the investor's OWN record on one ticker, shown
// before a new decision and frozen into the new DecisionSnapshot
// (docs/architecture.md §2.5a, docs/data-model.md §5 "prior_record_json").
//
// Pure and deterministic: no DB, no clock, no AI, no market data. It only
// re-presents facts that already exist:
//   - prior Decisions on the ticker, each with its FROZEN snapshot text
//     (reasoning, risks, exit conditions), its predictions exactly as they
//     stand (claim, kind, status, resolution note), its review verdicts
//     (quality / thesis accuracy — the Review's own words, never re-judged)
//     and its Later Context;
//   - the ticker's position episodes from the Episode Journal (dates,
//     trades, realized outcome per sell from computePositions()'s sellTrace)
//     with the investor's own rationale answers;
//   - the current holding.
// Deliberately NOT here: any price move since a past decision (for a PASS
// that number is exactly the counterfactual the product only shows on
// explicit request — never pushed), any AI summary, any inferred intent
// ("you changed your mind"), any score. A realized outcome is shown only for
// a sell computePositions() backed with sufficient known holdings; the
// position is shown only when the accounting for THIS ticker is trustworthy.
// All dates are ISO strings so the live brief and the frozen jsonb copy
// have one identical shape.
//
// POINT IN TIME (found and fixed in the external review evidence pass): a
// decision may be recorded with a PAST decision_date, so "now" is not the
// information time. Every brief is built against an explicit cutoff `asOf`
// (the decision's effective time; "now" for the live research brief):
//   - a prior decision counts only if decided AND recorded before asOf;
//   - a review counts only if dated on/before asOf; a prediction resolved
//     after asOf is shown as it stood then — pending, without its note;
//   - later context and rationale answers count only if written on/before asOf;
//   - a transaction counts only if dated on/before asOf AND either it was in
//     the system by asOf, or its whole calendar day ended before asOf in every
//     time zone (isTransactionKnownAt) — a same-day trade recorded later can
//     never be proven to precede the decision, so it is left out (fail closed);
//   - positions, episodes, realized results and splits come from the same
//     canonical accounting run on exactly those rows as of asOf.
import type { JournalEpisode } from "@/lib/portfolio/episodes";

export const PRIOR_RECORD_VERSION = 1 as const;

export interface PriorRecordDecisionInput {
  id: string;
  investmentCaseId: string;
  decisionType: string;
  decisionDate: Date;
  /** When the decision was recorded in the system (decisions.created_at). */
  createdAt: Date;
  reviewByDate: Date | null;
  snapshot: {
    priceAtDecision: string;
    size: string | null;
    userReasoningText: string;
    risksConsideredText: string | null;
    exitConditionsText: string | null;
    predictions: {
      id: string;
      claimText: string;
      kind: string | null;
      status: string;
      checkableByDate: Date | null;
      resolvedAt: Date | null;
      resolutionNote: string | null;
      createdAt: Date;
    }[];
  } | null;
  reviews: { id: string; reviewDate: Date; decisionQualityOverall: string; thesisAccuracy: string }[];
  laterContexts: { id: string; addedAt: Date; text: string }[];
}

export interface DerivePriorRecordInput {
  ticker: string;
  generatedAt: Date;
  /** The information cutoff: nothing after this instant may appear (see the PIT rules above). */
  asOf: Date;
  historyLatestTransactionDate: Date | null;
  /** "ok" = the accounting ran; "unavailable" = it threw (episodes and position are then withheld). */
  accounting: "ok" | "unavailable";
  /** Accounting warnings for THIS ticker (e.g. a sell exceeding known holdings) — the position is then withheld. */
  tickerWarningCount: number;
  position: { quantity: number; costBasisPerShare: number | null } | null;
  episodes: readonly JournalEpisode[];
  decisions: readonly PriorRecordDecisionInput[];
  /** The case a new decision is being recorded for: its own decision is never "prior". */
  excludeInvestmentCaseId?: string;
}

export interface PriorRecordPrediction {
  id: string;
  claimText: string;
  kind: string | null;
  status: string;
  checkableByDate: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface PriorRecordDecision {
  decisionId: string;
  decisionType: string;
  decisionDate: string;
  reviewByDate: string | null;
  priceAtDecision: string | null;
  sizeDollars: string | null;
  reasoningText: string | null;
  risksConsideredText: string | null;
  exitConditionsText: string | null;
  predictions: PriorRecordPrediction[];
  reviewCount: number;
  latestReview: { reviewId: string; reviewDate: string; decisionQualityOverall: string; thesisAccuracy: string } | null;
  laterContexts: { addedAt: string; text: string }[];
}

export interface PriorRecordEpisode {
  key: string;
  status: "open" | "closed";
  firstDate: string;
  exitDate: string | null;
  holdingDays: number | null;
  buyCount: number;
  sellCount: number;
  entry: { date: string; quantity: number | null; price: number | null } | null;
  /** One per sell; realizedPnlPercent is null when the sell was not backed by known holdings (untrusted). */
  sells: { date: string; realizedPnlPercent: number | null; holdingPeriodDays: number | null; trusted: boolean }[];
  rationale: { answerId: string; questionText: string; answerText: string; answeredAt: string }[];
}

export interface PriorRecordBrief {
  version: typeof PRIOR_RECORD_VERSION;
  ticker: string;
  generatedAt: string;
  /** The information cutoff the brief was built against. */
  asOf: string;
  historyThrough: string | null;
  accounting: "ok" | "unavailable";
  position:
    | { status: "held"; quantity: number; costBasisPerShare: number | null }
    | { status: "not_held" }
    | { status: "unavailable" };
  decisions: PriorRecordDecision[];
  episodes: PriorRecordEpisode[];
  summary: {
    decisionCount: number;
    reviewedDecisionCount: number;
    episodeCount: number;
    openEpisodeCount: number;
    rationaleAnswerCount: number;
    pendingPredictionCount: number;
    /** Pending "I'd reconsider if…" conditions the investor set on earlier decisions — the most decision-relevant open facts. */
    pendingReentryConditions: { decisionId: string; decisionType: string; decisionDate: string; predictionId: string; claimText: string }[];
  };
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const QUANTITY_EPSILON = 1e-9;

// A trade dated D (00:00Z, date-only) happened within the investor's local day
// D, which ends by D+1 12:00Z in every time zone (UTC-12 is the latest).
export const TRADE_DAY_SAFETY_MS = 36 * 3_600_000;

/** Was this transaction row provably knowable, and prior, at `asOf`? */
export function isTransactionKnownAt(row: { transactionDate: Date; createdAt: Date }, asOf: Date): boolean {
  const t = asOf.getTime();
  if (row.transactionDate.getTime() > t) return false;
  if (row.createdAt.getTime() <= t) return true;
  return row.transactionDate.getTime() + TRADE_DAY_SAFETY_MS <= t;
}

/** Was this answer written by `asOf`? */
export function isAnswerKnownAt(answer: { createdAt: Date }, asOf: Date): boolean {
  return answer.createdAt.getTime() <= asOf.getTime();
}

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function derivePriorRecordBrief(input: DerivePriorRecordInput): PriorRecordBrief {
  const ticker = normalizeTicker(input.ticker);
  const cutoff = input.asOf.getTime();
  const known = (d: Date) => d.getTime() <= cutoff;

  const decisions: PriorRecordDecision[] = input.decisions
    .filter((d) => d.investmentCaseId !== input.excludeInvestmentCaseId)
    .filter((d) => d.decisionDate.getTime() < cutoff && known(d.createdAt))
    .map((d) => {
      const reviews = d.reviews.filter((r) => known(r.reviewDate)).sort((a, b) => a.reviewDate.getTime() - b.reviewDate.getTime() || a.id.localeCompare(b.id));
      const latest = reviews.at(-1) ?? null;
      const predictions = (d.snapshot?.predictions ?? [])
        .filter((p) => known(p.createdAt))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((p) => {
          // As it stood at asOf: a resolution recorded later did not exist yet.
          const resolvedBy = p.resolvedAt !== null && known(p.resolvedAt);
          return {
            id: p.id,
            claimText: p.claimText,
            kind: p.kind,
            status: p.resolvedAt === null || resolvedBy ? p.status : "pending",
            checkableByDate: iso(p.checkableByDate),
            resolvedAt: resolvedBy ? iso(p.resolvedAt) : null,
            resolutionNote: resolvedBy ? p.resolutionNote : null,
          };
        });
      return {
        decisionId: d.id,
        decisionType: d.decisionType,
        decisionDate: d.decisionDate.toISOString(),
        reviewByDate: iso(d.reviewByDate),
        priceAtDecision: d.snapshot?.priceAtDecision ?? null,
        sizeDollars: d.snapshot?.size ?? null,
        reasoningText: d.snapshot?.userReasoningText ?? null,
        risksConsideredText: d.snapshot?.risksConsideredText ?? null,
        exitConditionsText: d.snapshot?.exitConditionsText ?? null,
        predictions,
        reviewCount: reviews.length,
        latestReview: latest
          ? { reviewId: latest.id, reviewDate: latest.reviewDate.toISOString(), decisionQualityOverall: latest.decisionQualityOverall, thesisAccuracy: latest.thesisAccuracy }
          : null,
        laterContexts: d.laterContexts
          .filter((lc) => known(lc.addedAt))
          .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime() || a.id.localeCompare(b.id))
          .map((lc) => ({ addedAt: lc.addedAt.toISOString(), text: lc.text })),
      };
    })
    .sort((a, b) => (a.decisionDate < b.decisionDate ? 1 : a.decisionDate > b.decisionDate ? -1 : a.decisionId.localeCompare(b.decisionId)));

  const episodes: PriorRecordEpisode[] =
    input.accounting === "ok"
      ? input.episodes
          .filter((e) => e.ticker === ticker)
          .map((e) => ({
            key: e.key,
            status: e.status,
            firstDate: e.firstDate.toISOString(),
            exitDate: iso(e.later.exitDate),
            holdingDays: e.later.holdingDays,
            buyCount: e.buyCount,
            sellCount: e.sellCount,
            entry: e.entry ? { date: e.entry.date.toISOString(), quantity: e.entry.quantity, price: e.entry.price } : null,
            sells: e.later.sells.map((s) => ({
              date: s.date.toISOString(),
              realizedPnlPercent: s.sufficientHoldings ? s.realizedPnlPercent : null,
              holdingPeriodDays: s.sufficientHoldings ? s.holdingPeriodDays : null,
              trusted: s.sufficientHoldings,
            })),
            rationale: e.rationale.answers.filter((a) => known(a.createdAt)).map((a) => ({ answerId: a.id, questionText: a.questionText, answerText: a.answerText, answeredAt: a.createdAt.toISOString() })),
          }))
          .sort((a, b) => (a.firstDate < b.firstDate ? 1 : a.firstDate > b.firstDate ? -1 : b.key.localeCompare(a.key)))
      : [];

  const position: PriorRecordBrief["position"] =
    input.accounting !== "ok" || input.tickerWarningCount > 0
      ? { status: "unavailable" }
      : input.position && input.position.quantity > QUANTITY_EPSILON
        ? { status: "held", quantity: input.position.quantity, costBasisPerShare: input.position.costBasisPerShare }
        : { status: "not_held" };

  const pendingReentryConditions = decisions.flatMap((d) =>
    d.predictions
      .filter((p) => p.status === "pending" && p.kind === "reentry_condition")
      .map((p) => ({ decisionId: d.decisionId, decisionType: d.decisionType, decisionDate: d.decisionDate, predictionId: p.id, claimText: p.claimText }))
  );

  return {
    version: PRIOR_RECORD_VERSION,
    ticker,
    generatedAt: input.generatedAt.toISOString(),
    asOf: input.asOf.toISOString(),
    historyThrough: iso(input.historyLatestTransactionDate),
    accounting: input.accounting,
    position,
    decisions,
    episodes,
    summary: {
      decisionCount: decisions.length,
      reviewedDecisionCount: decisions.filter((d) => d.reviewCount > 0).length,
      episodeCount: episodes.length,
      openEpisodeCount: episodes.filter((e) => e.status === "open").length,
      rationaleAnswerCount: episodes.reduce((n, e) => n + e.rationale.length, 0),
      pendingPredictionCount: decisions.reduce((n, d) => n + d.predictions.filter((p) => p.status === "pending").length, 0),
      pendingReentryConditions,
    },
  };
}
