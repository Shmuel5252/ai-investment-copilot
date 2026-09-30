import { loaded, type AttentionData, type MonitoringItem, type NextActionRow } from "@/components/home/types";
import type { HomeData } from "@/components/home/home-view";

// SYNTHETIC Home data for the /styleguide preview and the Home view tests.
// Invented tickers and figures only (PRODUCT.md: the investor's real data
// never appears in design work). Shaped exactly like the procedures' outputs
// so the preview renders the production components unchanged.

// tRPC sends dates as ISO strings (no transformer), so the preview does too
const d = (s: string) => `${s}T09:00:00.000Z`;

const noExecution = { status: "available" as const, historyThrough: d("2026-09-21"), knownBefore: [], backfilledBefore: [], sameDay: [], after: [] };

const item = (over: Partial<MonitoringItem> & Pick<MonitoringItem, "decisionId" | "ticker" | "decisionType" | "decisionDate" | "state">): MonitoringItem => ({
  reasons: [],
  baseline: { kind: "decision", at: over.decisionDate },
  review: { reviewed: false, count: 0, latestReviewDate: null },
  horizon: { status: "not_set", reviewByDate: null },
  predictions: { total: 0, pending: 0, undated: 0, due: [] },
  execution: noExecution,
  newExecutionAfterDecision: [],
  backfilled: [],
  position: { status: "ok", held: false, quantity: null, costBasisPerShare: null, frozenHoldingQuantity: null, episodeKeys: [] },
  ...over,
});

const afterFacts = [
  { transactionId: "t-1", transactionType: "buy", transactionDate: d("2026-09-15"), quantity: 12, price: 184.2, persistedAt: d("2026-09-21"), episodeKey: "ABCD#1" },
  { transactionId: "t-2", transactionType: "buy", transactionDate: d("2026-09-18"), quantity: 8, price: 179.9, persistedAt: d("2026-09-21"), episodeKey: "ABCD#1" },
];

const abcd = item({
  decisionId: "demo-abcd",
  ticker: "ABCD",
  decisionType: "BUY",
  decisionDate: d("2026-09-08"),
  state: "attention",
  reasons: ["NEW_EXECUTION_AFTER_DECISION"],
  execution: { ...noExecution, after: afterFacts },
  newExecutionAfterDecision: afterFacts,
  predictions: { total: 2, pending: 2, undated: 2, due: [] },
  position: { status: "ok", held: true, quantity: 20, costBasisPerShare: 182.47, frozenHoldingQuantity: 0, episodeKeys: ["ABCD#1"] },
});

const efgh = item({
  decisionId: "demo-efgh",
  ticker: "EFGH",
  decisionType: "BUY",
  decisionDate: d("2026-08-12"),
  state: "attention",
  reasons: ["REVIEW_DUE", "PREDICTION_DUE"],
  horizon: { status: "due", reviewByDate: d("2026-09-12") },
  predictions: { total: 3, pending: 2, undated: 0, due: [{ id: "p-due", checkableByDate: d("2026-09-20") }] },
  position: { status: "ok", held: true, quantity: 40, costBasisPerShare: 61.3, frozenHoldingQuantity: 40, episodeKeys: ["EFGH#1"] },
});

const ijkl = item({
  decisionId: "demo-ijkl",
  ticker: "IJKL",
  decisionType: "PASS",
  decisionDate: d("2026-07-30"),
  state: "settled",
  review: { reviewed: true, count: 1, latestReviewDate: d("2026-09-02") },
});

const attention: AttentionData = {
  asOf: d("2026-09-30"),
  timeZone: "Asia/Jerusalem",
  historyThrough: d("2026-09-21"),
  portfolioStatus: "ok",
  items: [efgh, abcd, ijkl],
  attention: [efgh, abcd],
  monitoredWithoutHorizon: 1,
};

// catalogue order, exactly as deriveNextActions would return it
const nextActions: NextActionRow[] = [
  { kind: "REVIEW_UNREVIEWED_DECISION", key: "review:demo-efgh", destination: "/decisions/demo-efgh#review", decision: { id: "demo-efgh", ticker: "EFGH", decisionType: "BUY", decisionDate: d("2026-08-12") }, sortDate: d("2026-08-12") },
  { kind: "SET_REVIEW_HORIZON", key: "horizon:demo-abcd", destination: "/decisions/demo-abcd", decision: { id: "demo-abcd", ticker: "ABCD", decisionType: "BUY", decisionDate: d("2026-09-08") }, sortDate: d("2026-09-08") },
  { kind: "CONTINUE_STALLED_CASE", key: "case:demo-mnop", destination: "/cases/demo-mnop", caseId: "demo-mnop", ticker: "MNOP", sortDate: d("2026-08-20") },
  { kind: "ADD_EPISODE_RATIONALE", key: "rationale", destination: "/journal", count: 3, sortDate: d("2026-09-30") },
  { kind: "REGENERATE_WITH_UNUSED_EVIDENCE", key: "regen:dna", destination: "/dna", domain: "dna", count: 6, sortDate: d("2026-09-30") },
];

export const HOME_PREVIEW: HomeData = {
  attention: loaded(attention),
  nextActions: loaded(nextActions),
  conditions: loaded([
    {
      predictionId: "c-1",
      claimText: "אם המכירות ברבעון הבא יצמחו פחות מ-10%, אשקול מחדש את כל התזה ולא רק את גודל הפוזיציה.",
      checkableByDate: null,
      createdAt: d("2026-07-30"),
      decisionId: "demo-ijkl",
      ticker: "IJKL",
      decisionType: "PASS",
      decisionDate: d("2026-07-30"),
    },
    {
      predictionId: "c-2",
      claimText: "אם ההנהלה תודיע על רכישה ממונפת, אחזור לבדוק את מבנה החוב לפני כל הוספה.",
      checkableByDate: d("2026-12-31"),
      createdAt: d("2026-09-08"),
      decisionId: "demo-abcd",
      ticker: "ABCD",
      decisionType: "BUY",
      decisionDate: d("2026-09-08"),
    },
  ]),
  cases: loaded([
    { id: "demo-mnop", ticker: "MNOP", status: "researching", createdAt: d("2026-08-02") },
    { id: "demo-qrst", ticker: "QRST", status: "researching", createdAt: d("2026-09-25") },
    { id: "demo-abcd-case", ticker: "ABCD", status: "decided", createdAt: d("2026-08-28") },
  ]),
  ideas: loaded([
    { id: "i-1", ticker: "UVWX", promotedToCaseId: null, createdAt: d("2026-09-27") },
    { id: "i-2", ticker: "YZAB", promotedToCaseId: null, createdAt: d("2026-09-14") },
    { id: "i-3", ticker: "QRST", promotedToCaseId: "demo-qrst", createdAt: d("2026-09-20") },
  ]),
  reach: loaded({
    summary: {
      statements: { total: 19, interviewAnswers: 10, decisionStatements: 9 },
      dna: { claims: 11, visibleToAi: 0, insufficient: 11, uncitedStatements: 6, unresolvedDecisions: 0, lastGeneratedAt: null, newestStatementAt: null, regenerationMayChangeReach: true },
      strategy: { claims: 8, visibleToAi: 0, insufficient: 8, uncitedStatements: 4, unresolvedDecisions: 0, lastGeneratedAt: null, newestStatementAt: null, regenerationMayChangeReach: false },
    },
  }),
  history: loaded({ latestTransactionDate: d("2026-09-21"), ageDays: 9 }),
  coverage: loaded({ covered: 4, total: 7 }),
};
