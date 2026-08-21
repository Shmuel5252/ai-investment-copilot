// Centralized Hebrew UI strings (CLAUDE.md UI/RTL redesign task).
// Written directly in this file — never copy Hebrew text out of a chat
// transcript into a project file; encoding has broken doing that before.
//
// Grows page-by-page as the redesign rolls out (see docs/backlog.md /
// the redesign task notes for scope and order) — only what Decision
// Snapshot + Later Context actually use is populated so far. Every other
// page keeps its own local English strings until it's this module's turn.
//
// DNA, Evidence Strength, Personal Fit, Portfolio Fit stay in English
// everywhere, by explicit product decision — never add Hebrew entries
// for those four terms specifically. Tickers and $ amounts also stay as
// written elsewhere in the app; this module only covers surrounding
// UI copy and value labels for enums the app already defines
// (src/db/schema/enums.ts is the source of truth for the raw values).

export const decisionTypeLabel: Record<string, string> = {
  BUY: "קנייה",
  PASS: "דילוג",
  HOLD: "החזקה",
  ADD: "הוספה",
  REDUCE: "הפחתה",
  SELL: "מכירה",
};

// evidenceStrengthEnum (src/db/schema/enums.ts) — shared by DNA,
// Strategy (observed) and Learning Insight, so this map is reusable
// well beyond Decision Snapshot once those pages are translated too.
export const evidenceStrengthLabel: Record<string, string> = {
  insufficient_evidence: "ראיות בלתי מספיקות",
  weak: "חלשה",
  moderate: "בינונית",
  strong: "חזקה",
};

// predictionStatusEnum
export const predictionStatusLabel: Record<string, string> = {
  pending: "ממתינה",
  confirmed: "אושרה",
  refuted: "הופרכה",
  inconclusive: "לא חד-משמעית",
};

// addedByEnum (LaterContext.added_by)
export const addedByLabel: Record<string, string> = {
  user: "המשתמש",
  ai: "AI",
};

export const nav = {
  allDecisions: "כל ההחלטות",
};

// Deliberately label-only, not value-embedding functions — the actual
// numeric/currency/date value always renders through <Num>
// (src/components/num.tsx) at the call site, never baked into a
// translated string template. Keeps the two concerns (translation vs.
// bidi-safe number formatting) separate, which matters once the same
// pattern repeats across six more pages full of prices/percentages.
export const decisionSnapshot = {
  immutableBadge: "רשומה קבועה",
  decidedOnLabel: "התקבלה ב",
  priceAtDecisionLabel: "מחיר במועד ההחלטה",
  sizeLabel: "גודל",
  reasoningLabel: "הנימוק והתזה שלך (מילה במילה)",
  aiInterpretationLabel: "פרשנות ה-AI לתזה שלך",
  aiAssessmentLabel: "הערכת AI בזמן אמת",
  risksLabel: "סיכונים שנשקלו",
  exitConditionsLabel: "תנאי יציאה",
  predictionsTitle: "תחזיות שחולצו מהתזה שלך",
  checkableByLabel: "ניתנת לבדיקה עד",
  portfolioStateTitle: "מצב התיק במועד ההחלטה",
  cashLabel: "מזומן",
  sharesLabel: "מניות",
  avgCostLabel: "עלות ממוצעת",
  costUnknown: "לא ידועה",
  noOtherHoldings: "לא היו החזקות נוספות במועד זה.",
  marketContextTitle: "הקשר שוק במועד ההחלטה",
  onThatDay: "באותו יום",
  dnaHypothesesTitle: "השערות DNA בתוקף במועד ההחלטה",
};

export const laterContext = {
  title: "הקשר מאוחר",
  explanation:
    "הוסף הבהרות או תיקונים בלי לשכתב את הרשומה למעלה — שימושי אם התברר שהערכת ה-AI בזמן אמת או תחזית מסוימת הכילו טעות. מוצג ל-Decision Review כמקור סמכות על כל דבר שהוא מתקן.",
  addedByPrefix: "נוסף על ידי",
  placeholder: "לדוגמה: תיקון — הערכת ה-AI למעלה בלבלה בין גודל הפוזיציה למחיר למניה...",
  addButton: "הוספת הקשר מאוחר",
  addingButton: "מוסיף...",
};
