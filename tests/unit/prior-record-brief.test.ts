// Prior Record Brief V1 — the pure derivation (src/lib/prior-record/prior-record.ts)
// fed by the REAL position math and REAL episode journal (computePositions →
// deriveEpisodeJournal), exactly as the DB wrapper does. Expected values are
// pinned by hand.
import { describe, expect, it } from "vitest";
import { computePositions, type TransactionInput } from "@/lib/portfolio/positions";
import { deriveEpisodeJournal, type EpisodeAnswerInput } from "@/lib/portfolio/episodes";
import { derivePriorRecordBrief, isAnswerKnownAt, isTransactionKnownAt, type DerivePriorRecordInput, type PriorRecordDecisionInput } from "@/lib/prior-record/prior-record";

const at = (s: string) => new Date(s.includes("T") ? s : `${s}T00:00:00Z`);
let seq = 0;
const trade = (ticker: string, type: "buy" | "sell", qty: number, price: number, date: string, id = `t${++seq}`): TransactionInput & { id: string } => ({
  id, ticker, transactionType: type, quantity: qty, price, amount: type === "buy" ? -qty * price : qty * price, transactionDate: at(date),
});
const answer = (transactionId: string, text: string, createdAt: string): EpisodeAnswerInput => ({ id: `a-${transactionId}`, transactionId, questionText: "why?", answerText: text, createdAt: at(createdAt) });

function journalInput(trades: (TransactionInput & { id: string })[], answers: EpisodeAnswerInput[] = []) {
  const portfolio = computePositions(trades, []);
  const journal = deriveEpisodeJournal(trades.map((t) => ({ ...t, ticker: t.ticker })), portfolio, answers);
  return { portfolio, journal };
}

const decision = (o: Omit<Partial<PriorRecordDecisionInput>, "decisionDate"> & { id: string; decisionDate: string }): PriorRecordDecisionInput => ({
  id: o.id,
  investmentCaseId: o.investmentCaseId ?? `case-${o.id}`,
  decisionType: o.decisionType ?? "BUY",
  decisionDate: at(o.decisionDate),
  createdAt: o.createdAt ?? at(o.decisionDate),
  reviewByDate: o.reviewByDate ?? null,
  snapshot: o.snapshot === undefined
    ? { priceAtDecision: "100", size: "500", userReasoningText: `reasoning ${o.id}`, risksConsideredText: null, exitConditionsText: `exit ${o.id}`, predictions: [] }
    : o.snapshot,
  reviews: o.reviews ?? [],
  laterContexts: o.laterContexts ?? [],
});

function brief(over: Partial<DerivePriorRecordInput> & { trades?: (TransactionInput & { id: string })[]; answers?: EpisodeAnswerInput[] } = {}) {
  const { portfolio, journal } = journalInput(over.trades ?? [], over.answers ?? []);
  const ticker = (over.ticker ?? "MU").trim().toUpperCase();
  const p = portfolio.positions.find((x) => x.ticker === ticker);
  return derivePriorRecordBrief({
    ticker: over.ticker ?? "MU",
    generatedAt: at("2026-09-24T02:00:00Z"),
    asOf: over.asOf ?? at("2026-09-24T02:00:00Z"),
    historyLatestTransactionDate: at("2026-09-21"),
    accounting: over.accounting ?? "ok",
    tickerWarningCount: over.tickerWarningCount ?? portfolio.warnings.filter((w) => w.ticker === ticker).length,
    position: over.position !== undefined ? over.position : p ? { quantity: p.quantity, costBasisPerShare: p.costBasisPerShare } : null,
    episodes: journal.episodes,
    decisions: over.decisions ?? [],
    excludeInvestmentCaseId: over.excludeInvestmentCaseId,
  });
}

describe("empty and isolation", () => {
  it("no decisions and no trades → an honest empty brief, not_held, zero counts", () => {
    const b = brief();
    expect(b).toMatchObject({ version: 1, ticker: "MU", accounting: "ok", position: { status: "not_held" }, decisions: [], episodes: [] });
    expect(b.summary).toEqual({ decisionCount: 0, reviewedDecisionCount: 0, episodeCount: 0, openEpisodeCount: 0, rationaleAnswerCount: 0, pendingPredictionCount: 0, pendingReentryConditions: [] });
    expect(b.historyThrough).toBe("2026-09-21T00:00:00.000Z");
  });
  it("only the requested ticker's episodes; the ticker is normalized", () => {
    const trades = [trade("MU", "buy", 1, 100, "2026-01-05"), trade("MU", "sell", 1, 120, "2026-02-05"), trade("NVDA", "buy", 2, 50, "2026-01-10")];
    const b = brief({ ticker: " mu ", trades });
    expect(b.ticker).toBe("MU");
    expect(b.episodes.map((e) => e.key)).toEqual(["MU#1"]);
    expect(b.position).toEqual({ status: "not_held" });
  });
});

describe("episodes", () => {
  it("closed and open episodes, newest first, realized outcome per sell from the real sellTrace, rationale attached", () => {
    const b1 = trade("MU", "buy", 1, 100, "2026-01-05", "b1");
    const s1 = trade("MU", "sell", 1, 120, "2026-02-05", "s1");
    const b2 = trade("MU", "buy", 2, 90, "2026-05-01", "b2");
    const b = brief({ trades: [b1, s1, b2], answers: [answer("b1", "memory cycle bottoming", "2026-08-30T10:00:00Z")] });
    expect(b.episodes.map((e) => [e.key, e.status])).toEqual([["MU#2", "open"], ["MU#1", "closed"]]);
    const closed = b.episodes[1]!;
    expect(closed).toMatchObject({ firstDate: "2026-01-05T00:00:00.000Z", exitDate: "2026-02-05T00:00:00.000Z", holdingDays: 31, buyCount: 1, sellCount: 1, entry: { quantity: 1, price: 100 } });
    expect(closed.sells).toEqual([{ date: "2026-02-05T00:00:00.000Z", realizedPnlPercent: 20, holdingPeriodDays: 31, trusted: true }]);
    expect(closed.rationale).toEqual([{ answerId: "a-b1", questionText: "why?", answerText: "memory cycle bottoming", answeredAt: "2026-08-30T10:00:00.000Z" }]);
    expect(b.episodes[0]!.rationale).toEqual([]);
    expect(b.position).toEqual({ status: "held", quantity: 2, costBasisPerShare: 90 });
    expect(b.summary).toMatchObject({ episodeCount: 2, openEpisodeCount: 1, rationaleAnswerCount: 1 });
  });
  it("a sell not backed by known holdings shows no P&L (untrusted) and withholds the position for that ticker", () => {
    const b = brief({ trades: [trade("MU", "buy", 1, 100, "2026-01-05"), trade("MU", "sell", 3, 120, "2026-02-05")] });
    expect(b.episodes[0]!.sells[0]).toMatchObject({ realizedPnlPercent: null, holdingPeriodDays: null, trusted: false });
    expect(b.position).toEqual({ status: "unavailable" });
  });
  it("accounting unavailable → no episodes, position unavailable, but the decision record still shows", () => {
    const b = brief({ accounting: "unavailable", trades: [trade("MU", "buy", 1, 100, "2026-01-05")], decisions: [decision({ id: "d1", decisionDate: "2026-08-01T10:00:00Z" })] });
    expect(b.episodes).toEqual([]);
    expect(b.position).toEqual({ status: "unavailable" });
    expect(b.decisions.map((d) => d.decisionId)).toEqual(["d1"]);
  });
});

describe("prior decisions", () => {
  const preds = [
    { id: "p1", claimText: "memory prices keep rising", kind: "forecast", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null, createdAt: at("2026-08-01T10:00:00Z") },
    { id: "p2", claimText: "reconsider if HBM demand slows", kind: "reentry_condition", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null, createdAt: at("2026-08-01T10:00:01Z") },
    { id: "p3", claimText: "reconsider below $80", kind: "reentry_condition", status: "confirmed", checkableByDate: null, resolvedAt: at("2026-09-06T16:00:00Z"), resolutionNote: "happened", createdAt: at("2026-08-01T10:00:02Z") },
  ];
  const withPreds = decision({ id: "d1", decisionType: "PASS", decisionDate: "2026-08-01T10:00:00Z", snapshot: { priceAtDecision: "95.5", size: null, userReasoningText: "too expensive", risksConsideredText: "cycle", exitConditionsText: "a pullback", predictions: preds } });
  it("frozen text, predictions as they stand, only PENDING re-entry conditions highlighted", () => {
    const b = brief({ decisions: [withPreds] });
    const d = b.decisions[0]!;
    expect(d).toMatchObject({ decisionType: "PASS", priceAtDecision: "95.5", sizeDollars: null, reasoningText: "too expensive", risksConsideredText: "cycle", exitConditionsText: "a pullback", reviewCount: 0, latestReview: null });
    expect(d.predictions.map((p) => [p.id, p.status])).toEqual([["p1", "pending"], ["p2", "pending"], ["p3", "confirmed"]]);
    expect(b.summary.pendingPredictionCount).toBe(2);
    expect(b.summary.pendingReentryConditions).toEqual([{ decisionId: "d1", decisionType: "PASS", decisionDate: "2026-08-01T10:00:00.000Z", predictionId: "p2", claimText: "reconsider if HBM demand slows" }]);
  });
  it("newest decision first; the latest review's own labels (never re-judged); later context in order; own case excluded", () => {
    const older = decision({ id: "d-old", decisionDate: "2026-05-01T10:00:00Z", reviews: [
      { id: "r2", reviewDate: at("2026-09-07T04:00:00Z"), decisionQualityOverall: "weak", thesisAccuracy: "insufficient_evidence" },
      { id: "r1", reviewDate: at("2026-09-06T16:00:00Z"), decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive" },
    ], laterContexts: [{ id: "lc2", addedAt: at("2026-06-02"), text: "second" }, { id: "lc1", addedAt: at("2026-06-01"), text: "first" }] });
    const newer = decision({ id: "d-new", decisionDate: "2026-08-01T10:00:00Z" });
    const own = decision({ id: "d-own", investmentCaseId: "THIS-CASE", decisionDate: "2026-09-01T10:00:00Z" });
    const b = brief({ decisions: [older, own, newer], excludeInvestmentCaseId: "THIS-CASE" });
    expect(b.decisions.map((d) => d.decisionId)).toEqual(["d-new", "d-old"]);
    expect(b.decisions[1]).toMatchObject({ reviewCount: 2, latestReview: { reviewId: "r2", decisionQualityOverall: "weak", thesisAccuracy: "insufficient_evidence" } });
    expect(b.decisions[1]!.laterContexts.map((l) => l.text)).toEqual(["first", "second"]);
    expect(b.summary).toMatchObject({ decisionCount: 2, reviewedDecisionCount: 1 });
  });
  it("a decision without a snapshot is listed with null text (fail closed, nothing invented)", () => {
    const b = brief({ decisions: [decision({ id: "d1", decisionDate: "2026-08-01T10:00:00Z", snapshot: null })] });
    expect(b.decisions[0]).toMatchObject({ priceAtDecision: null, reasoningText: null, predictions: [] });
  });
});

describe("anti-hindsight and determinism", () => {
  it("carries no price-move, current-price, counterfactual or score field anywhere", () => {
    const b = brief({ trades: [trade("MU", "buy", 1, 100, "2026-01-05")], decisions: [decision({ id: "d1", decisionType: "PASS", decisionDate: "2026-08-01T10:00:00Z" })] });
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(b);
    for (const k of keys) expect(k).not.toMatch(/currentPrice|priceChange|counterfactual|score|pnlUsd|outcome/i);
  });
  it("is independent of input order and survives a JSON round-trip unchanged (the frozen copy has the live shape)", () => {
    const trades = [trade("MU", "buy", 1, 100, "2026-01-05", "x1"), trade("MU", "sell", 1, 110, "2026-02-05", "x2"), trade("MU", "buy", 1, 90, "2026-03-05", "x3")];
    const ds = [decision({ id: "d1", decisionDate: "2026-05-01T10:00:00Z" }), decision({ id: "d2", decisionDate: "2026-06-01T10:00:00Z" }), decision({ id: "d3", decisionDate: "2026-06-01T10:00:00Z" })];
    const a = brief({ trades, decisions: ds });
    const b = brief({ trades: [...trades].reverse(), decisions: [...ds].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.decisions.map((d) => d.decisionId)).toEqual(["d2", "d3", "d1"]);
  });
});

describe("point in time — nothing after asOf (external review evidence pass)", () => {
  const ASOF = at("2026-09-08T07:10:00Z");
  const base = { priceAtDecision: "100", size: null, userReasoningText: "r", risksConsideredText: null, exitConditionsText: null };
  it("prior decisions: decided AND recorded before asOf; equality is excluded", () => {
    const b = brief({ asOf: ASOF, decisions: [
      decision({ id: "before", decisionDate: "2026-09-01T10:00:00Z" }),
      decision({ id: "same-instant", decisionDate: "2026-09-08T07:10:00Z" }),
      decision({ id: "after", decisionDate: "2026-09-10T10:00:00Z" }),
      decision({ id: "backdated-recorded-later", decisionDate: "2026-09-01T10:00:00Z", createdAt: at("2026-09-20T10:00:00Z") }),
    ] });
    expect(b.decisions.map((d) => d.decisionId)).toEqual(["before"]);
    expect(b.asOf).toBe("2026-09-08T07:10:00.000Z");
  });
  it("reviews, later context and prediction resolutions after asOf are invisible; a later-resolved prediction shows as pending without its note", () => {
    const d = decision({ id: "d", decisionDate: "2026-09-01T10:00:00Z",
      reviews: [{ id: "r-before", reviewDate: at("2026-09-05T10:00:00Z"), decisionQualityOverall: "reasonable", thesisAccuracy: "inconclusive" }, { id: "r-after", reviewDate: at("2026-09-09T10:00:00Z"), decisionQualityOverall: "weak", thesisAccuracy: "refuted" }],
      laterContexts: [{ id: "l1", addedAt: at("2026-09-08T07:10:00Z"), text: "at cutoff" }, { id: "l2", addedAt: at("2026-09-08T07:10:00.001Z"), text: "after cutoff" }],
      snapshot: { ...base, predictions: [
        { id: "p-early", claimText: "a", kind: "forecast", status: "confirmed", checkableByDate: null, resolvedAt: at("2026-09-05T10:00:00Z"), resolutionNote: "early note", createdAt: at("2026-09-01T10:00:00Z") },
        { id: "p-late", claimText: "b", kind: "reentry_condition", status: "refuted", checkableByDate: null, resolvedAt: at("2026-09-09T10:00:00Z"), resolutionNote: "late note", createdAt: at("2026-09-01T10:00:00Z") },
      ] } });
    const out = brief({ asOf: ASOF, decisions: [d] }).decisions[0]!;
    expect(out).toMatchObject({ reviewCount: 1, latestReview: { reviewId: "r-before" } });
    expect(out.laterContexts.map((l) => l.text)).toEqual(["at cutoff"]);
    expect(out.predictions).toEqual([
      { id: "p-early", claimText: "a", kind: "forecast", status: "confirmed", checkableByDate: null, resolvedAt: "2026-09-05T10:00:00.000Z", resolutionNote: "early note" },
      { id: "p-late", claimText: "b", kind: "reentry_condition", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null },
    ]);
    expect(brief({ asOf: ASOF, decisions: [d] }).summary.pendingReentryConditions.map((c) => c.predictionId)).toEqual(["p-late"]);
    expect(JSON.stringify(brief({ asOf: ASOF, decisions: [d] }))).not.toMatch(/late note|after cutoff|r-after/);
  });
  it("rationale answers written after asOf are dropped even if an episode carries them", () => {
    const b1 = trade("MU", "buy", 1, 100, "2026-01-05", "pit-b1");
    const b = brief({ asOf: ASOF, trades: [b1], answers: [answer("pit-b1", "written later", "2026-09-10T10:00:00Z")] });
    expect(b.episodes[0]!.rationale).toEqual([]);
  });
  it("isTransactionKnownAt: future-dated never; recorded by asOf yes; recorded later only when its whole day ended before asOf in every zone", () => {
    const row = (date: string, createdAt: string) => ({ transactionDate: at(date), createdAt: at(createdAt) });
    expect(isTransactionKnownAt(row("2026-09-09", "2026-09-01T00:00:00Z"), ASOF)).toBe(false); // dated after asOf
    expect(isTransactionKnownAt(row("2026-09-08", "2026-09-08T07:10:00Z"), ASOF)).toBe(true); // same day, already in the system at asOf
    expect(isTransactionKnownAt(row("2026-09-08", "2026-09-08T07:10:00.001Z"), ASOF)).toBe(false); // same day, recorded after: order unprovable
    expect(isTransactionKnownAt(row("2026-09-07", "2026-09-23T00:00:00Z"), ASOF)).toBe(false); // 09-07 ends 09-08 12:00Z in UTC-12 > asOf
    expect(isTransactionKnownAt(row("2026-09-06", "2026-09-23T00:00:00Z"), ASOF)).toBe(true); // backfilled, but its day surely ended
    expect(isTransactionKnownAt(row("2026-09-06", "2026-09-23T00:00:00Z"), at("2026-09-07T11:59:59.999Z"))).toBe(false);
    expect(isTransactionKnownAt(row("2026-09-06", "2026-09-23T00:00:00Z"), at("2026-09-07T12:00:00Z"))).toBe(true);
    expect(isAnswerKnownAt({ createdAt: ASOF }, ASOF)).toBe(true);
    expect(isAnswerKnownAt({ createdAt: new Date(ASOF.getTime() + 1) }, ASOF)).toBe(false);
  });
});
