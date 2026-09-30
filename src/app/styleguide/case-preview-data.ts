import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import type { MarketIntelligence } from "@/lib/market/fmp";
import { loaded } from "@/components/home/types";
import type { CaseData, CaseViewData, ProfileItem } from "@/components/case/types";

// SYNTHETIC data for the /styleguide Case preview and the Case render tests.
// Invented tickers, companies, numbers and words; nothing here comes from the
// investor's records or from a market data provider. Dates are ISO strings,
// as tRPC sends them.

const MARKET: MarketIntelligence = {
  ticker: "ABCD",
  companyName: "Example Holdings Inc.",
  sector: "Technology",
  industry: "Semiconductors",
  price: 182.4,
  changePercentage: -0.85,
  marketCap: 84_200_000_000,
  beta: 1.32,
  fiftyTwoWeekRange: "121.10-205.75",
  description: "Example Holdings designs sample components for a fictional market. This paragraph is placeholder text for the design preview.",
  peRatioTtm: 28.4,
  priceToBookRatioTtm: 6.1,
  priceToSalesRatioTtm: 7.9,
  dividendYieldTtm: 0.004,
  valuationRatiosAvailable: true,
  fetchedAt: "2026-09-29T11:42:00.000Z",
  source: "financial_modeling_prep",
};

const DNA: ProfileItem[] = [
  { id: "dna-1", statementText: "נוטה להוסיף לפוזיציה קיימת אחרי ירידה, כשהתזה המקורית לא השתנתה.", evidenceStrength: "moderate" },
  { id: "dna-2", statementText: "מעדיף חברות עם מאזן נקי על פני צמיחה מהירה.", evidenceStrength: "weak" },
];
const STRATEGY: ProfileItem[] = [{ id: "st-1", statementText: "פוזיציה בודדת לא עולה על 15% מהתיק.", evidenceStrength: "strong" }];

const BASE_CASE: CaseData = {
  id: "case-preview",
  ticker: "ABCD",
  ideaId: "idea-preview",
  status: "researching",
  createdAt: "2026-09-12T08:00:00.000Z",
  updatedAt: "2026-09-29T11:45:00.000Z",
  marketIntelligenceJson: null,
  personalFitText: null,
  personalFitEvidenceRefs: null,
  portfolioFitText: null,
  bullCaseText: null,
  bearCaseText: null,
  catalystsText: null,
  invalidationConditionsText: null,
  marketBlindspotText: null,
  devilsAdvocateText: null,
  synthesisText: null,
};

const RESEARCHED_CASE: CaseData = {
  ...BASE_CASE,
  marketIntelligenceJson: MARKET,
  synthesisText: "טקסט דוגמה: סיכום קצר של מה שהנתונים שנשלפו מראים על החברה, בלי המלצה.",
  bullCaseText: "טקסט דוגמה: מה בנתונים תומך ברעיון, למשל מכפיל שנמוך מהטווח שלו.",
  catalystsText: "טקסט דוגמה: אירועים אפשריים שעשויים להזיז את התזה.",
  bearCaseText: "טקסט דוגמה: מה בנתונים סותר את הרעיון, למשל בטא גבוהה.",
  devilsAdvocateText: "טקסט דוגמה: טיעון אמיתי נגד לקיחת הפוזיציה.",
  invalidationConditionsText: "טקסט דוגמה: מה יראה שהתזה שגויה.",
  marketBlindspotText: "טקסט דוגמה: הנתונים לא כוללים תזרים מזומנים, תחזיות או חדשות.",
  portfolioFitText: "טקסט דוגמה: המספרים של Portfolio Fit במילים פשוטות.",
  personalFitText: "טקסט דוגמה: הרעיון מתיישב עם הנטייה שלך להוסיף אחרי ירידה, ועומד בכלל גודל הפוזיציה.",
  personalFitEvidenceRefs: { dnaHypothesisIds: ["dna-1"], strategyPrincipleIds: ["st-1"], hasTraceableEvidence: true },
};

const FIT: PortfolioFit = {
  totalPortfolioValueUsd: 48_250,
  totalPortfolioValueApproximate: true,
  existingHoldingQuantity: 10,
  existingPositionValueUsd: 1_824,
  existingWeightPercent: 3.8,
  projectedPositionValueUsd: 4_824,
  projectedWeightPercent: 10.0,
  holdingsCount: 7,
  largestCurrentPositionTicker: "EFGH",
  largestCurrentPositionWeightPercent: 18.2,
  warnings: ["No live price available for IJKL — used cost basis instead."],
  cashValueUsd: 6_400,
  cashWeightPercent: 13.3,
  sectorExposure: [
    { sector: "Technology", valueUsd: 20_100, weightPercent: 41.7 },
    { sector: "Healthcare", valueUsd: 12_000, weightPercent: 24.9 },
    { sector: null, valueUsd: 9_750, weightPercent: 20.2 },
  ],
  industryExposure: [
    { industry: "Semiconductors", valueUsd: 9_300, weightPercent: 19.3 },
    { industry: "Software", valueUsd: 10_800, weightPercent: 22.4 },
    { industry: null, valueUsd: 21_750, weightPercent: 45.1 },
  ],
  projectedCashValueUsd: 3_400,
  projectedCashWeightPercent: 7.0,
  projectedSectorExposure: [
    { sector: "Technology", valueUsd: 23_100, weightPercent: 47.9 },
    { sector: "Healthcare", valueUsd: 12_000, weightPercent: 24.9 },
    { sector: null, valueUsd: 9_750, weightPercent: 20.2 },
  ],
  projectedIndustryExposure: [
    { industry: "Semiconductors", valueUsd: 12_300, weightPercent: 25.5 },
    { industry: "Software", valueUsd: 10_800, weightPercent: 22.4 },
    { industry: null, valueUsd: 21_750, weightPercent: 45.1 },
  ],
};

export const PRIOR_RECORD_PREVIEW: PriorRecordBrief = {
  version: 1,
  ticker: "ABCD",
  generatedAt: "2026-09-30T09:00:00.000Z",
  asOf: "2026-09-30T09:00:00.000Z",
  historyThrough: "2026-09-26T00:00:00.000Z",
  accounting: "ok",
  position: { status: "held", quantity: 10, costBasisPerShare: 164.2 },
  decisions: [
    {
      decisionId: "dec-prev-1",
      decisionType: "PASS",
      decisionDate: "2026-03-04T00:00:00.000Z",
      reviewByDate: null,
      priceAtDecision: "151.20",
      sizeDollars: null,
      reasoningText: "טקסט דוגמה: הנימוק שנכתב בזמן ההחלטה הקודמת, מילה במילה.\nשורה שנייה של אותו נימוק.",
      risksConsideredText: "טקסט דוגמה: הסיכונים שנשקלו אז.",
      exitConditionsText: "טקסט דוגמה: אשקול מחדש אם המכפיל יירד.",
      predictions: [
        { id: "pr-1", claimText: "טענת דוגמה שחולצה מהנימוק.", kind: "reentry_condition", status: "pending", checkableByDate: null, resolvedAt: null, resolutionNote: null },
      ],
      reviewCount: 1,
      latestReview: { reviewId: "rv-1", reviewDate: "2026-06-01T00:00:00.000Z", decisionQualityOverall: "reasonable", thesisAccuracy: "insufficient_evidence" },
      laterContexts: [{ addedAt: "2026-04-10T00:00:00.000Z", text: "טקסט דוגמה: הקשר שנוסף בדיעבד." }],
    },
  ],
  episodes: [
    {
      key: "ABCD#1",
      status: "open",
      firstDate: "2026-07-15T00:00:00.000Z",
      exitDate: null,
      holdingDays: null,
      buyCount: 2,
      sellCount: 0,
      entry: { date: "2026-07-15T00:00:00.000Z", quantity: 6, price: 160.1 },
      sells: [],
      rationale: [{ answerId: "an-1", questionText: "למה קנית?", answerText: "טקסט דוגמה: הנימוק שתיעדת לתקופת ההחזקה.", answeredAt: "2026-07-20T00:00:00.000Z" }],
    },
  ],
  summary: {
    decisionCount: 1,
    reviewedDecisionCount: 1,
    episodeCount: 1,
    openEpisodeCount: 1,
    rationaleAnswerCount: 1,
    pendingPredictionCount: 1,
    pendingReentryConditions: [{ decisionId: "dec-prev-1", decisionType: "PASS", decisionDate: "2026-03-04T00:00:00.000Z", predictionId: "pr-1", claimText: "טענת דוגמה שחולצה מהנימוק." }],
  },
};

const EMPTY_PRIOR: PriorRecordBrief = {
  ...PRIOR_RECORD_PREVIEW,
  position: { status: "not_held" },
  decisions: [],
  episodes: [],
  summary: { decisionCount: 0, reviewedDecisionCount: 0, episodeCount: 0, openEpisodeCount: 0, rationaleAnswerCount: 0, pendingPredictionCount: 0, pendingReentryConditions: [] },
};

const IDEA = { id: "idea-preview", ticker: "ABCD", noteText: "טקסט דוגמה: המחשבה הראשונה שכתבת על הטיקר, כפי שנכתבה.", createdAt: "2026-09-11T19:30:00.000Z" };

export type CasePreviewState = "researched" | "fresh" | "decided";

export function casePreviewData(state: CasePreviewState): CaseViewData {
  const common = {
    ideas: loaded([IDEA]),
    origin: loaded(null),
    dna: loaded(DNA),
    strategy: loaded({ principles: STRATEGY, hasApprovedVersion: true }),
  };
  if (state === "fresh") {
    return {
      ...common,
      investmentCase: loaded({ ...BASE_CASE, ideaId: null }),
      priorRecord: loaded(EMPTY_PRIOR),
      strategy: loaded({ principles: [], hasApprovedVersion: false }),
      existingDecision: loaded(null),
      fit: undefined,
    };
  }
  if (state === "decided") {
    return {
      ...common,
      investmentCase: loaded({
        ...RESEARCHED_CASE,
        status: "decided",
        personalFitText: "טקסט דוגמה: אין מספיק היסטוריה אישית כדי להעריך התאמה.",
        personalFitEvidenceRefs: { dnaHypothesisIds: [], strategyPrincipleIds: [], hasTraceableEvidence: false },
      }),
      priorRecord: loaded(PRIOR_RECORD_PREVIEW),
      existingDecision: loaded({ id: "dec-preview", decisionType: "BUY", decisionDate: "2026-09-30T07:00:00.000Z" }),
      fit: undefined,
    };
  }
  return {
    ...common,
    investmentCase: loaded(RESEARCHED_CASE),
    priorRecord: loaded(PRIOR_RECORD_PREVIEW),
    existingDecision: loaded(null),
    fit: { data: FIT, sizeDollars: 3_000 },
  };
}
