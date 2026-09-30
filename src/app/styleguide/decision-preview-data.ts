import { loaded } from "@/components/home/types";
import type { DecisionRecord, DecisionViewData, PredictionRow, ReviewRow } from "@/components/decision/types";
import type { ExecutionData } from "@/components/execution-facts";
import { PRIOR_RECORD_PREVIEW } from "./case-preview-data";

// SYNTHETIC data for the /styleguide Decision preview and the Decision render
// tests. Invented tickers, numbers and words; nothing here comes from the
// investor's records. Every enum value is one the schema allows. Dates are
// ISO strings, as tRPC sends them.

export type DecisionPreviewState = "fresh" | "reviewed" | "legacy" | "backdated" | "pass";
export const DECISION_PREVIEW_STATES: readonly DecisionPreviewState[] = ["fresh", "reviewed", "legacy", "backdated", "pass"];

const SNAPSHOT: NonNullable<DecisionRecord["snapshot"]> = {
  createdAt: "2026-09-12T09:30:00.000Z",
  priceAtDecision: "182.40",
  size: "3000",
  userReasoningText: "טקסט דוגמה: הנימוק שנכתב ברגע ההחלטה, מילה במילה.\nשורה שנייה: מה אני מצפה שיקרה, ולמה עכשיו.",
  risksConsideredText: "טקסט דוגמה: הסיכונים ששקלתי.",
  exitConditionsText: "טקסט דוגמה: אשקול מחדש אם המכפיל יירד מתחת לטווח שלו.",
  aiRealtimeAssessmentText: "טקסט דוגמה: הערכת ה-AI ברגע הרישום, על בסיס המספרים שהיו מולו.",
  portfolioStateJson: {
    cash: 6400,
    positions: [
      { ticker: "EFGH", quantity: 40, costBasisPerShare: 210.5 },
      { ticker: "IJKL", quantity: 12, costBasisPerShare: null },
    ],
  },
  strategyVersionId: "strategy-v2",
  investmentCaseSnapshotJson: {
    marketIntelligenceJson: { companyName: "Example Holdings Inc.", sector: "Technology", industry: "Semiconductors", price: 182.4 },
    bullCaseText: "טקסט דוגמה: מה תמך ברעיון לפי הנתונים שנשלפו.",
    bearCaseText: "טקסט דוגמה: מה סתר אותו.",
    personalFitText: "טקסט דוגמה: Personal Fit מהתיק.",
  },
  priorRecordJson: PRIOR_RECORD_PREVIEW,
  thesis: { aiInterpretationText: "טקסט דוגמה: פרשנות ה-AI לתזה, בניסוח ניתן לבדיקה." },
  dnaReferences: [
    { dnaHypothesisVersionId: "dv-1", dnaHypothesisVersion: { statementText: "נוטה להוסיף לפוזיציה קיימת אחרי ירידה.", evidenceStrength: "moderate" } },
    { dnaHypothesisVersionId: "dv-2", dnaHypothesisVersion: { statementText: "מעדיף מאזן נקי על פני צמיחה מהירה.", evidenceStrength: "insufficient_evidence" } },
  ],
};

const DECISION: DecisionRecord["decision"] = {
  id: "decision-preview",
  ticker: "ABCD",
  decisionType: "BUY",
  decisionDate: "2026-09-12T09:25:00.000Z",
  reviewByDate: "2026-12-12T00:00:00.000Z",
  investmentCaseId: "case-preview",
};

const MARKET = { capturedAt: "2026-09-12T09:10:00.000Z", indexLevel: "5712.40", indexChange1d: "-0.42", volatilityIndexValue: "17.3" };

const P = (o: Partial<PredictionRow> & Pick<PredictionRow, "id" | "claimText">): PredictionRow => ({
  kind: "forecast",
  status: "pending",
  checkableByDate: null,
  resolvedAt: null,
  resolutionNote: null,
  resolvedByReviewId: null,
  ...o,
});

const DIMENSIONS = (verdicts: string[]): ReviewRow["dimensions"] =>
  ["thesis_quality", "evidence_quality", "risk_awareness", "valuation_awareness", "portfolio_fit", "strategy_consistency", "exit_conditions"].map((dimension, i) => ({
    id: `dim-${dimension}-${verdicts.join("")}`,
    dimension: dimension as ReviewRow["dimensions"][number]["dimension"],
    verdict: verdicts[i] as ReviewRow["dimensions"][number]["verdict"],
    rationaleText: `Sample rationale for ${dimension.replace("_", " ")}, written in English as the review contract stores it.`,
    citedSnapshotFields: verdicts[i] === "insufficient_evidence" ? [] : ["userReasoningText", i % 2 ? "caseBullCaseText" : "portfolioStateJson"],
  }));

const REVIEWS: ReviewRow[] = [
  {
    id: "review-2",
    reviewDate: "2026-09-28T18:00:00.000Z",
    narrativeSummaryText:
      "Sample narrative: the process was reasonable, the thesis was partially confirmed by your own resolutions, and the price outcome is a separate fact that does not change the process verdict.",
    decisionQualityOverall: "reasonable",
    thesisAccuracy: "partially_confirmed",
    outcomeJson: { priceAtDecision: 182.4, currentPrice: 191.1, priceChangePercent: 4.77, sizeDollars: 3000, positionValueNowUsd: 3143.1, pnlUsd: 143.1, pnlPercent: 4.77, stillHeld: true, asOfDate: "2026-09-28T18:00:00.000Z" },
    dimensions: DIMENSIONS(["reasonable", "strong", "reasonable", "weak", "strong", "reasonable", "insufficient_evidence"]),
  },
  {
    id: "review-1",
    reviewDate: "2026-09-20T18:00:00.000Z",
    narrativeSummaryText: "Sample narrative of an earlier review, kept exactly as it was generated.",
    decisionQualityOverall: "insufficient_evidence",
    thesisAccuracy: "insufficient_evidence",
    outcomeJson: { priceAtDecision: 182.4, currentPrice: 176.0, priceChangePercent: -3.51, sizeDollars: 3000, positionValueNowUsd: 2894.7, pnlUsd: -105.3, pnlPercent: -3.51, stillHeld: true, asOfDate: "2026-09-20T18:00:00.000Z" },
    dimensions: DIMENSIONS(["insufficient_evidence", "insufficient_evidence", "insufficient_evidence", "insufficient_evidence", "weak", "reasonable", "insufficient_evidence"]),
  },
];

const EXECUTION: ExecutionData = {
  executedSide: "buy",
  status: "available",
  historyThrough: "2026-09-26T00:00:00.000Z",
  candidates: [
    { group: "after", transactionId: "tx-1", transactionType: "buy", transactionDate: "2026-09-13T00:00:00.000Z", quantity: 16, price: 183.1, episodeKey: "ABCD#2", canExecute: true, assertion: { factId: "fact-1", verdict: "executed", note: null } },
    { group: "sameDay", transactionId: "tx-2", transactionType: "sell", transactionDate: "2026-09-12T00:00:00.000Z", quantity: 2, price: 181.0, episodeKey: null, canExecute: false, assertion: null },
  ],
  executed: [{ id: "fact-1", note: "טקסט דוגמה: הערה על הביצוע.", transaction: { transactionType: "buy", quantity: 16, price: 183.1, transactionDate: "2026-09-13T00:00:00.000Z", amount: -2929.6 } }],
  unrelatedCount: 0,
};

const TODAY_ATTENTION = {
  item: {
    decisionId: DECISION.id,
    state: "attention" as const,
    horizon: { status: "upcoming" as const, reviewByDate: DECISION.reviewByDate! },
    predictions: { total: 3, pending: 2, undated: 1, due: [{ id: "p-1", checkableByDate: "2026-09-28T00:00:00.000Z" }] },
    position: { status: "ok" as const, held: true, quantity: 26, costBasisPerShare: 176.2, frozenHoldingQuantity: 10, episodeKeys: ["ABCD#2"] },
  },
  historyThrough: "2026-09-26T00:00:00.000Z",
};

const common = {
  laterContexts: loaded([{ id: "lc-1", addedAt: "2026-09-18T07:00:00.000Z", text: "טקסט דוגמה: הקשר שהוספתי אחרי ההחלטה.", addedBy: "user" as const }]),
  execution: loaded(EXECUTION),
  currentStrategyVersionId: loaded("strategy-v2" as string | null),
  reconsiderationCases: [] as { id: string; originPredictionId: string }[],
};

export function decisionPreviewData(state: DecisionPreviewState): DecisionViewData {
  if (state === "fresh") {
    const predictions = [
      P({ id: "p-1", claimText: "טענת דוגמה: ההכנסות יצמחו מעל 20% ברבעון הבא.", checkableByDate: "2026-12-10T00:00:00.000Z" }),
      P({ id: "p-2", kind: "reentry_condition", claimText: "טענת דוגמה: אשקול מחדש אם המכפיל יירד מתחת ל-20." }),
    ];
    return {
      ...common,
      record: loaded({ decision: { ...DECISION, decisionDate: "2026-09-29T09:25:00.000Z" }, snapshot: { ...SNAPSHOT, createdAt: "2026-09-29T09:30:00.000Z" }, predictions, marketContext: MARKET }),
      reviews: loaded([]),
      pendingPredictions: loaded(predictions.map(({ id, claimText, kind }) => ({ id, claimText, kind }))),
      laterContexts: loaded([]),
      execution: loaded({ ...EXECUTION, candidates: [], executed: [] }),
      today: loaded({ ...TODAY_ATTENTION, item: { ...TODAY_ATTENTION.item, predictions: { total: 2, pending: 2, undated: 1, due: [] } } }),
    };
  }
  if (state === "legacy") {
    const predictions = [
      P({ id: "p-l1", kind: null, status: "inconclusive", claimText: "טענת דוגמה ישנה, בלי סוג.", resolvedAt: "2026-06-01T00:00:00.000Z", resolutionNote: "טקסט דוגמה: מה קבעתי אז.", resolvedByReviewId: "review-l" }),
    ];
    return {
      ...common,
      record: loaded({ decision: { ...DECISION, decisionType: "SELL", reviewByDate: null }, snapshot: { ...SNAPSHOT, priorRecordJson: null, size: null }, predictions, marketContext: MARKET }),
      reviews: loaded([{ ...REVIEWS[1]!, id: "review-l", decisionQualityOverall: "weak", thesisAccuracy: "insufficient_evidence" }]),
      pendingPredictions: loaded([]),
      currentStrategyVersionId: loaded("strategy-v3"),
      today: loaded({ item: { ...TODAY_ATTENTION.item, state: "settled" as const }, historyThrough: TODAY_ATTENTION.historyThrough }),
    };
  }
  if (state === "backdated") {
    return {
      ...common,
      record: loaded({
        decision: { ...DECISION, decisionDate: "2026-08-30T00:00:00.000Z" },
        snapshot: SNAPSHOT,
        predictions: [P({ id: "p-b1", claimText: "טענת דוגמה.", status: "confirmed", resolvedAt: "2026-09-28T18:00:00.000Z", resolutionNote: "טקסט דוגמה.", resolvedByReviewId: "review-2" })],
        marketContext: MARKET,
      }),
      reviews: loaded([REVIEWS[0]!]),
      pendingPredictions: loaded([]),
      today: loaded(TODAY_ATTENTION),
    };
  }
  if (state === "pass") {
    const predictions = [
      P({ id: "p-c1", kind: "reentry_condition", claimText: "טענת דוגמה: אשקול מחדש אם יפורסם דוח חזק.", status: "confirmed", resolvedAt: "2026-09-25T00:00:00.000Z", resolutionNote: "טקסט דוגמה: התנאי התקיים." }),
    ];
    return {
      ...common,
      record: loaded({ decision: { ...DECISION, decisionType: "PASS", reviewByDate: null }, snapshot: { ...SNAPSHOT, size: null }, predictions, marketContext: MARKET }),
      reviews: loaded([{ ...REVIEWS[0]!, id: "review-p", thesisAccuracy: "confirmed", outcomeJson: { ...(REVIEWS[0]!.outcomeJson as object), sizeDollars: null, pnlUsd: null, pnlPercent: null, positionValueNowUsd: null, stillHeld: false } }]),
      pendingPredictions: loaded([]),
      execution: loaded({ ...EXECUTION, executedSide: null, candidates: [], executed: [] }),
      today: loaded({ item: { ...TODAY_ATTENTION.item, state: "settled" as const }, historyThrough: TODAY_ATTENTION.historyThrough }),
      reconsiderationCases: [{ id: "case-reconsider", originPredictionId: "p-c1" }],
    };
  }
  // reviewed
  const predictions = [
    P({ id: "p-r1", claimText: "טענת דוגמה: המרווח הגולמי יישאר מעל 50%.", status: "confirmed", resolvedAt: "2026-09-28T18:00:00.000Z", resolutionNote: "טקסט דוגמה: מה שקרה בפועל.", resolvedByReviewId: "review-2" }),
    P({ id: "p-r2", claimText: "טענת דוגמה: ההנהלה תעלה תחזית.", status: "refuted", checkableByDate: "2026-09-25T00:00:00.000Z", resolvedAt: "2026-09-28T18:00:00.000Z", resolutionNote: "טקסט דוגמה.", resolvedByReviewId: "review-2" }),
    P({ id: "p-r3", kind: "reentry_condition", claimText: "טענת דוגמה: אשקול מחדש אם המכפיל יירד מתחת ל-20." }),
  ];
  return {
    ...common,
    record: loaded({ decision: DECISION, snapshot: SNAPSHOT, predictions, marketContext: MARKET }),
    reviews: loaded(REVIEWS),
    pendingPredictions: loaded([{ id: "p-r3", claimText: predictions[2]!.claimText, kind: "reentry_condition" as const }]),
    today: loaded(TODAY_ATTENTION),
  };
}
