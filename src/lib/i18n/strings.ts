// Centralized Hebrew UI strings (CLAUDE.md UI/RTL redesign task).
// Written directly in this file — never copy Hebrew text out of a chat
// transcript into a project file; encoding has broken doing that before.
//
// Covers all seven live-verified Slice 1 pages (Import, Interview, DNA,
// Strategy, Ideas, Cases, Decisions) as of the redesign rollout. Decision
// Review inside decisions/[id]/page.tsx is the one deliberate exception —
// stays English until its own open backlog items close (see that file's
// .legacy-scope wrapper).
//
// DNA, Evidence Strength, Personal Fit, Portfolio Fit stay in English
// everywhere, by explicit product decision — never add Hebrew entries
// for those four terms specifically. Tickers and $ amounts also stay as
// written elsewhere in the app. AI-generated or user-authored free text
// (thesis interpretation, DNA statements, evidence descriptions, a
// user's own note) is never translated — only static UI chrome (labels,
// buttons, instructions) is.
//
// Deliberately label-only, not value-embedding functions — the actual
// numeric/currency/date value always renders through <Num>
// (src/components/num.tsx) at the call site, never baked into a
// translated string template. Keeps the two concerns (translation vs.
// bidi-safe number formatting) separate.

// --- Shared enum-value maps (src/db/schema/enums.ts is the source of
// truth for the raw values) — reused verbatim across every page that
// shows one of these, instead of each page keeping its own copy. ---

export const decisionTypeLabel: Record<string, string> = {
  BUY: "קנייה",
  PASS: "דילוג",
  HOLD: "החזקה",
  ADD: "הוספה",
  REDUCE: "הפחתה",
  SELL: "מכירה",
};

// evidenceStrengthEnum — shared by DNA, Strategy (observed) and
// Learning Insight. "insufficient_evidence" doubles as the standalone
// "Insufficient Evidence" badge text wherever that's shown alone.
export const evidenceStrengthLabel: Record<string, string> = {
  insufficient_evidence: "ראיות בלתי מספיקות",
  weak: "חלשה",
  moderate: "בינונית",
  strong: "חזקה",
};

// decisionQualityEnum / thesisAccuracyEnum — display labels only, for the
// Review verdicts the Prior Record repeats as a historical record. The stored
// values and the Review contract are untouched.
export const reviewQualityLabel: Record<string, string> = {
  insufficient_evidence: "ראיות בלתי מספיקות",
  weak: "חלשה",
  reasonable: "סבירה",
  strong: "חזקה",
};

export const thesisAccuracyLabel: Record<string, string> = {
  confirmed: "אושרה",
  partially_confirmed: "אושרה חלקית",
  refuted: "הופרכה",
  inconclusive: "לא חד-משמעית",
  insufficient_evidence: "ראיות בלתי מספיקות",
};

// predictionStatusEnum
export const predictionStatusLabel: Record<string, string> = {
  pending: "ממתינה",
  confirmed: "אושרה",
  refuted: "הופרכה",
  inconclusive: "לא חד-משמעית",
};

// predictionKindEnum — null (no label shown) for predictions created
// before this distinction existed, never backfilled.
export const predictionKindLabel: Record<string, string> = {
  forecast: "תחזית",
  reentry_condition: "תנאי לשקילה מחדש",
};

// addedByEnum (LaterContext.added_by)
export const addedByLabel: Record<string, string> = {
  user: "המשתמש",
  ai: "AI",
};

// evidenceStanceEnum
export const evidenceStanceLabel: Record<string, string> = {
  supporting: "תומך",
  contradicting: "סותר",
};

// costBasisConfidenceEnum
export const costBasisConfidenceLabel: Record<string, string> = {
  known: "ידוע במדויק",
  approximate: "משוער",
  unknown: "לא ידוע",
};

// caseStatusEnum
export const caseStatusLabel: Record<string, string> = {
  researching: "בתהליך מחקר",
  decided: "הוחלט",
  archived: "בארכיון",
};

// --- Cross-page labels ---

export const common = {
  cashLabel: "מזומן",
  sharesLabel: "מניות",
  avgCostLabel: "עלות ממוצעת",
  costUnknown: "לא ידועה",
  createdOnLabel: "נוצר",
};

export const nav = {
  home: "בית",
  allDecisions: "כל ההחלטות",
};

// --- App shell (src/components/shell/*) — Frontend V1, unit 1 ---
// The chrome of every screen is Hebrew, Decision Review and Learning
// included (AGENTS.md "Backend Intelligence V1 — Frozen"): only the
// AI-generated content of those two stays English. Navigation speaks the
// investor's language, not the backend's: groups follow how the product
// is used, and each destination reuses its page's own title where one
// exists so the two never drift.
export const shell = {
  productName: "AI Investment Copilot",
  productDescription: "עוזר השקעות אישי שלומד איך אתה מחליט — לא מה לקנות.",
  skipToContent: "דלג לתוכן",
  openMenu: "פתח תפריט",
  closeMenu: "סגור תפריט",
  mainNavigation: "ניווט ראשי",
  groupDecisions: "מחזור ההחלטה",
  groupProfile: "הפרופיל שלך",
  groupData: "הנתונים שלך",
  navHome: "סקירה",
  navLearning: "תובנות למידה",
  signedInAs: "מחובר בתור",
  signOut: "התנתקות",
  signingOut: "מתנתק...",
  loadingUser: "טוען...",
  // shared state copy for the primitives in src/components/ui
  loading: "טוען...",
  loadFailedTitle: "לא הצלחנו לטעון את הנתונים",
  loadFailedHint: "בדוק את החיבור ונסה שוב. שום דבר לא נכתב או השתנה.",
  actionFailed: "הפעולה נכשלה. שום דבר לא נשמר.",
  retry: "נסה שוב",
  emptyDefaultTitle: "אין כאן עדיין כלום",
};

// --- Login (src/app/login/page.tsx) ---
export const loginPage = {
  emailLabel: "אימייל",
  passwordLabel: "סיסמה",
  signIn: "כניסה",
  signingIn: "נכנס...",
  failedTitle: "הכניסה לא הצליחה",
  failedHint: "בדוק את האימייל והסיסמה ונסה שוב.",
};

// Evidence Strength tiers as PRODUCT STATES, not errors. The tier is
// computed in code (src/lib/dna/evidence-strength.ts) and never changed
// here — this is only how each tier is explained to the investor. The
// short badge text stays evidenceStrengthLabel above; this map adds the
// one-line explanation the badge can show beside it. Wording follows the
// real rule: fewer than three independent supporting cases is
// "insufficient"; from three on, the share of contradicting cases sets
// weak / moderate / strong.
export const evidenceTierHint: Record<string, string> = {
  insufficient_evidence: "עדיין אין מספיק מקרים עצמאיים כדי לקרוא לזה דפוס. זה מצב תקין — לא שגיאה.",
  weak: "יש מספיק מקרים, אבל חלק ניכר מהם סותר את הטענה.",
  moderate: "דפוס שחוזר על עצמו ברוב המקרים העצמאיים.",
  strong: "דפוס יציב: חמישה מקרים עצמאיים לפחות, ולכל היותר מיעוט קטן של סתירות.",
};

// --- Home (src/app/page.tsx, src/components/home/*) — Frontend V1, unit 2 ---
// The investor's decision cockpit. Every line here describes a fact the
// backend already derived (monitoring, next actions, open conditions,
// evidence reach); none of it judges a decision, predicts a price or ranks
// anything. Reason, fact and destination wording for attention and next
// actions is reused from decisionAttention / nextActions below, not
// duplicated.

export const homePage = {
  title: "סקירה",
  newIdea: "רעיון חדש",
  // A — orientation
  historyThroughPrefix: "ההיסטוריה מעודכנת עד",
  historyAgePrefix: "לפני",
  historyAgeSuffix: "ימים",
  historyToday: "עודכנה היום",
  noHistory: "עדיין אין היסטוריית עסקאות",
  portfolioStatusPrefix: "מצב התיק:",
  portfolioStatus: {
    ok: "תקין",
    warnings: "יש אזהרות חישוב",
    unavailable: "לא זמין",
  } as Record<string, string>,
  countAttention: "לתשומת לב",
  countSteps: "צעדים מוצעים",
  countConditions: "תנאים פתוחים",
  // B — attention
  attentionTitle: "דורש את תשומת לבך",
  attentionHint: "החלטות שמשהו השתנה סביבן מאז שבדקת אותן לאחרונה. אלה עובדות, לא המלצה.",
  attentionEmpty: "אין החלטה שדורשת תשומת לב עכשיו.",
  moreFactsPrefix: "ועוד",
  // a next action shown inside its decision's attention row: the decision is
  // already named by the row, so the fact drops it
  joinedFact: {
    RESOLVE_EXECUTION_CANDIDATES: "עסקאות מועמדות לביצוע שלא סווגו",
    REVIEW_UNREVIEWED_DECISION: "טרם עבר Review",
    SET_REVIEW_HORIZON: "לא נקבע תאריך Review",
    RESOLVE_OPEN_REENTRY_CONDITION: "הגיע מועד הבדיקה של תנאי שקילה-מחדש",
  } as Record<string, string>,
  // C — next steps
  stepsTitle: "הצעד הבא",
  stepsEmpty: "אין כרגע צעד מוצע.",
  // D — monitoring
  monitoringTitle: "החלטות במעקב",
  monitoringHint: "כל ההחלטות שרשמת, ומה מצב המעקב על כל אחת.",
  monitoringEmpty: "עדיין אין החלטות. החלטה נרשמת מתוך תיק מחקר.",
  columns: {
    decision: "החלטה",
    date: "תאריך",
    state: "מצב",
    reviewBy: "תאריך Review",
    reviews: "Reviews",
    pending: "תחזיות ממתינות",
    held: "מוחזק כעת",
  },
  state: {
    attention: "דורשת תשומת לב",
    monitoring: "במעקב",
    settled: "הושלמה",
  } as Record<string, string>,
  horizon: {
    not_set: "לא נקבע",
    upcoming: "עתידי",
    due: "הגיע",
    satisfied: "הושלם",
  } as Record<string, string>,
  undatedSuffix: "ללא תאריך",
  heldYes: "כן",
  heldNo: "לא",
  heldUnknown: "לא זמין",
  // E — conditions
  conditionsTitle: "תנאים שהצבת לעצמך",
  conditionsHint: "רק אתה קובע אם תנאי התקיים. המערכת לא בודקת אותו מול השוק.",
  conditionsEmpty: "אין תנאים פתוחים.",
  conditionsShow: "הצג את התנאים",
  // F — research
  researchTitle: "מחקר פתוח",
  researchHint: "תיקים שאתה חוקר, ורעיונות שעוד לא הפכו לתיק. רעיון מתחיל ממך, לא מהמערכת.",
  researchEmpty: "אין תיק מחקר פתוח ואין רעיון ממתין.",
  stalled: "לא התקדם זמן רב",
  openCase: "פתח את התיק",
  ideasWaitingPrefix: "רעיונות שעוד לא הפכו לתיק:",
  openIdeas: "לרעיונות",
  // G — investment memory
  memoryTitle: "זיכרון ההשקעות שלך",
  memoryHint: "כמה מהטענות על דפוס ההשקעה שלך כבר נשענות על מספיק מקרים עצמאיים.",
  memoryEmpty: "עדיין אין השערות DNA או עקרונות Strategy. הם נוצרים מתשובות הראיון ומההחלטות שלך.",
  dnaLabel: "DNA",
  strategyLabel: "Strategy",
  claimsUnit: "טענות",
  allBelowThreshold: "כולן עדיין מתחת לסף הראיות. זה מצב תקין, לא שגיאה.",
  aboveThresholdMiddle: "מעל הסף,",
  belowThresholdSuffix: "מתחת לסף",
  statementsLabel: "הצהרות שלך",
  uncitedMiddle: "עוד לא צוטטו ב-",
  journalLabel: "יומן",
  coverageMiddle: "מתוך",
  coverageSuffix: "פוזיציות עם נימוק",
  openDna: "DNA",
  openStrategy: "Strategy",
  openJournal: "יומן",
  openInterview: "לראיון המודרך",
  memoryFootnote: "טענה משמשת את המערכת בניתוחים רק כשיש לה מספיק מקרים עצמאיים. עד אז היא מוצגת לך, אבל שום ניתוח לא נשען עליה.",
};

// --- Decisions: list (src/app/decisions/page.tsx) ---

export const decisionsListPage = {
  title: "החלטות",
  description: "כל החלטה שנרשמה — בלתי ניתנת לשינוי מהרגע שנוצרה. רשום החלטה חדשה מתוך תיק מחקר.",
  noDecisionsYet: "עדיין לא נרשמו החלטות.",
  listLabel: "ההחלטות שלך",
  emptyHint: "החלטה נרשמת מתוך תיק מחקר. מהרגע שנרשמה היא רשומה קבועה.",
  goToCases: "לתיקי המחקר",
  openDecision: "פתח את ההחלטה",
};

// --- Open-Decision Monitoring V1 (src/app/page.tsx) — derived on read,
// never persisted. Reason labels are neutral facts, never judgments
// (docs/architecture.md §2.9): never "executed", "contradiction", "mistake". ---
export const decisionAttention = {
  title: "החלטות שדורשות תשומת לב",
  loading: "בודק...",
  empty: "אין החלטות שדורשות תשומת לב כרגע",
  historyThroughPrefix: "ההיסטוריה מעודכנת עד",
  noHistory: "אין עדיין היסטוריית עסקאות",
  reason: {
    REVIEW_DUE: "הגיע מועד ה-Review",
    PREDICTION_DUE: "תחזיות שניתן לבדוק",
    NEW_EXECUTION_AFTER_DECISION: "עסקאות אחרי ההחלטה",
    HISTORY_BACKFILLED: "היסטוריה שנוספה בדיעבד",
  } as Record<string, string>,
  txnType: { buy: "קנייה", sell: "מכירה" } as Record<string, string>,
  reviewDueFact: "תאריך ה-Review שקבעת:",
  predictionDueFact: "תחזיות ממתינות שהגיע מועד בדיקתן",
  newExecutionFactMiddle: "עסקאות ב-",
  newExecutionFactSuffix: "אחרי ההחלטה נוספו להיסטוריה ב-",
  backfilledFactMiddle: "עסקאות ב-",
  backfilledFactSuffix: "מלפני ההחלטה נוספו להיסטוריה אחרי שהרשומה הוקפאה, ב-",
  backfilledNote: "רשומת ההחלטה עצמה אינה משתנה.",
  sameDayFact: "עסקאות ביום ההחלטה (הסדר ביחס להחלטה לא ידוע)",
  executionUnavailablePrefix: "היסטוריית העסקאות זמינה רק עד",
  heldPrefix: "מוחזק כעת:",
  flat: "לא מוחזק כעת",
  frozenHoldingPrefix: "החזקה ברשומת ההחלטה:",
  positionUnavailable: "מצב הפוזיציה לא זמין (אזהרות חישוב או כשל) — מוצגות עובדות עסקה בלבד.",
  openDecision: "פתח החלטה",
  addContext: "הוסף הקשר",
  runReview: "הרץ Review",
  withoutHorizonSuffix: "החלטות במעקב ללא תאריך Review",
  // Decision Follow-Through V1 — the action a card with execution facts offers.
  markExecution: "סמן ביצוע",
};

// --- Evidence Reach V1 (src/components/home/steps-region.tsx) — the deterministic
// next-action list beside Monitoring. FACT -> REASON -> DESTINATION. ---

export const nextActions = {
  title: "מה הצעד הבא",
  explanation: "פעולות שמוסיפות למערכת מידע אמיתי ממך. כל שורה נעלמת ברגע שהפעולה בוצעה. זו לא רשימת התראות ולא שיפוט על ההחלטות.",
  loading: "בודק...",
  empty: "אין כרגע צעד מוצע.",
  fact: {
    execPrefix: "ל-",
    execMiddle: "יש",
    execSuffix: "עסקאות מועמדות לביצוע שלא סווגו",
    unreviewed: "— טרם עבר Review",
    noHorizon: "— לא נקבע תאריך Review",
    conditionPrefix: "הגיע מועד הבדיקה של תנאי שקילה-מחדש מ-",
    stalledCasePrefix: "תיק המחקר",
    stalledCaseSuffix: "לא התקדם זמן רב",
    rationale: "אפיזודות בהיסטוריה ללא נימוק רשום",
    unusedDna: "הצהרות שלך שאף השערת DNA פעילה עדיין לא מצטטת",
    unusedStrategy: "הצהרות שלך שאף עיקרון Strategy נצפה עדיין לא מצטט",
  },
  reason: {
    RESOLVE_EXECUTION_CANDIDATES: "עד לסיווג, ההצהרות מהחלטה זו אינן נספרות כראיה — לא תומכת ולא סותרת.",
    REVIEW_UNREVIEWED_DECISION: "בלי Review אין Learning, ואין הפרדה בין איכות ההחלטה לתוצאה.",
    SET_REVIEW_HORIZON: "בלי תאריך Review ה-Monitoring לא יזכיר לך לחזור להחלטה.",
    RESOLVE_OPEN_REENTRY_CONDITION: "רק אתה קובע אם התנאי שהצבת התקיים; המערכת לא בודקת זאת מול השוק.",
    CONTINUE_STALLED_CASE: "תיק פתוח בלי החלטה לא מייצר רשומה, ראיה או Review.",
    ADD_EPISODE_RATIONALE: "נימוק שאתה כותב הוא ראיה לגיטימית ל-DNA ול-Strategy; בלעדיו האפיזודה אילמת.",
    REGENERATE_WITH_UNUSED_EVIDENCE: "יצירה מחדש עשויה לצטט את ההצהרות האלה; היא לא מעלה ביטחון מעבר למה שהראיות מוכיחות.",
  } as Record<string, string>,
  destination: {
    RESOLVE_EXECUTION_CANDIDATES: "סמן ביצוע",
    REVIEW_UNREVIEWED_DECISION: "הרץ Review",
    SET_REVIEW_HORIZON: "קבע תאריך Review",
    RESOLVE_OPEN_REENTRY_CONDITION: "פתח את ההחלטה",
    CONTINUE_STALLED_CASE: "פתח את התיק",
    ADD_EPISODE_RATIONALE: "פתח את היומן",
    REGENERATE_WITH_UNUSED_EVIDENCE: "פתח את העמוד",
  } as Record<string, string>,
};

// --- Decision Follow-Through V1 (src/components/execution-facts.tsx) —
// investor-confirmed execution facts. Wording never asserts that a trade
// executed a decision; candidates are candidates until the investor marks
// them. ---

export const decisionExecution = {
  title: "ביצוע בפועל",
  explanation:
    "עסקאות באותו טיקר סביב מועד ההחלטה מוצגות כמועמדות בלבד — המערכת לעולם לא קובעת שעסקה ביצעה החלטה. רק אתה מסמן. כל סימון נרשם כעובדה חדשה; שינוי דעה נרשם כעובדה נוספת, לא כמחיקה.",
  loading: "בודק...",
  historyBeforeDecisionPrefix: "היסטוריית העסקאות מגיעה רק עד",
  noHistory: "אין עדיין היסטוריית עסקאות",
  noCandidates: "אין עסקאות באותו טיקר סביב מועד ההחלטה.",
  executedTitle: "סימנת כביצוע ההחלטה",
  candidatesTitle: "עסקאות מועמדות",
  beforeTitle: "עסקאות מלפני יום ההחלטה",
  beforeNote: "מתוארכות לפני יום ההחלטה — לא יכולות להיות הביצוע שלה. אם ההחלטה התקבלה בפועל מוקדם יותר, הוסף הקשר מאוחר.",
  sameDayNote: "ביום ההחלטה (הסדר ביחס להחלטה לא ידוע)",
  afterNote: "אחרי יום ההחלטה",
  notExecutableNote: "החלטת דילוג/החזקה אינה מבוצעת על ידי עסקה — ניתן רק לסמן עסקאות כלא קשורות.",
  sideMismatchNote: "צד העסקה לא תואם לסוג ההחלטה — לא יכולה להיות הביצוע שלה.",
  markExecuted: "ביצעה את ההחלטה",
  markUnrelated: "לא קשורה להחלטה",
  markingButton: "רושם...",
  verdictExecuted: "סומנה: ביצוע ההחלטה",
  verdictUnrelated: "סומנה: לא קשורה",
  changeToUnrelated: "שנה: לא קשורה",
  changeToExecuted: "שנה: ביצעה את ההחלטה",
  unrelatedCountSuffix: "עסקאות סומנו כלא קשורות להחלטה",
  amountLabel: "סכום",
};

// --- Decision Follow-Through V1 (src/components/reentry-condition.tsx) —
// a re-entry condition is the investor's own check; they resolve it. ---

export const reentryCondition = {
  resolvePrompt: "האם התנאי התקיים? זו קביעה שלך — המערכת לא בודקת את השוק.",
  fired: "התקיים",
  notFired: "לא התקיים",
  undetermined: "לא ניתן לקבוע",
  notePlaceholder: "מה קרה בפועל (חובה)",
  submitButton: "רשום פתרון",
  submittingButton: "רושם...",
  yourCallPrefix: "קביעתך:",
  resolvedNotePrefix: "מה שקרה בפועל:",
  resolvedAtPrefix: "נפתר ב",
  reconsiderButton: "פתח Case חדש לשקילה מחדש",
  reconsiderOpening: "פותח...",
  forecastNote: "תחזית — נפתרת במסגרת Decision Review.",
  openReconsiderationCase: "פתח את התיק לשקילה מחדש",
};

// --- Decision Follow-Through V1 (src/app/page.tsx) — open re-entry
// conditions, listed as facts (Pull), never checked against the market. ---

export const openConditions = {
  title: "תנאי שקילה-מחדש פתוחים",
  loading: "בודק...",
  empty: "אין תנאי שקילה-מחדש פתוחים.",
  explanation: "תנאים שקבעת בעצמך בהחלטות קודמות ועדיין לא נפתרו. המערכת לא בודקת אם התקיימו — זו קביעה שלך.",
  fromDecisionPrefix: "מהחלטת",
  openDecision: "פתח החלטה",
  checkableByPrefix: "ניתן לבדוק עד",
};

// --- Decision Snapshot (src/app/decisions/[id]/page.tsx) ---

// --- Decision record + Review (src/components/decision, Frontend V1 unit 4).
// Chrome only. The investor's frozen words, the AI's texts from recording,
// the Review's stored narrative and rationale (English by contract) and
// every stored enum pass through here only as display labels. ---
export const decisionPage = {
  // page states
  notFoundTitle: "ההחלטה לא נמצאה",
  noSnapshotTitle: "להחלטה הזו אין רשומה קפואה",
  noSnapshotHint: "ההחלטה קיימת, אבל לא נשמרה איתה רשומת רישום. אין מה להציג כ'אז', ולא ניתן להריץ עליה Review.",
  actionFailed: "הפעולה נכשלה. שום דבר לא נשמר.",
  // header
  immutableBadge: "רשומה קבועה",
  decidedOnPrefix: "התקבלה ב-",
  recordedOnPrefix: "נרשמה ב-",
  priceAtRecordLabel: "מחיר ברישום",
  sizeLabel: "גודל",
  openCase: "פתח את תיק המחקר",
  goToReview: "למבט לאחור",
  backdatedTitle: "ההחלטה נרשמה אחרי שהתקבלה",
  backdatedNote:
    "המחיר, מצב התיק, הקשר השוק וגרסאות ה-DNA וה-Strategy שהוקפאו הם מרגע הרישום, לא מתאריך ההחלטה. הרקורד הקודם, אם נשמר, נבנה לפי תאריך ההחלטה.",
  reviewByPrefix: "מועד Review שקבעת:",
  noReviewDate: "לא נקבע מועד Review",
  reviewDateLabel: "מועד Review",
  setReviewDateButton: "קבע מועד (פעם אחת)",
  settingReviewDateButton: "קובע...",
  reviewDateSetOnceNote: "ניתן לקבוע פעם אחת בלבד, ואי אפשר לשנות אחר כך. מועד ה-Review הוא תזכורת, לא תנאי.",
  // THEN
  thenTitle: "אז · מה ידעתי וכתבתי בזמן ההחלטה",
  thenHint: "כל מה שבמקטע הזה הוקפא ברגע הרישום ואינו משתנה.",
  reasoningLabel: "הנימוק והתזה שלך",
  risksLabel: "סיכונים ששקלת",
  exitConditionsLabel: "תנאי יציאה ושקילה מחדש",
  notWritten: "לא נכתב",
  statementsNote: "שלושת הטקסטים האלה הם המילים שלך, כפי שנכתבו. אלו המילים שהמערכת רשאית לצטט כראיה לאופן החשיבה שלך.",
  aiAtRecordTitle: "קריאת ה-AI בזמן הרישום",
  aiAtRecordNote: "נכתב על ידי ה-AI ברגע הרישום, מתוך מה שהיה מולו אז. לא המילים שלך, ולא ראיה עליך.",
  thesisInterpretationLabel: "פרשנות התזה",
  realtimeAssessmentLabel: "הערכה בזמן הרישום",
  frozenContextTitle: "ההקשר שהוקפא ברישום",
  portfolioStateTitle: "מצב התיק ברישום",
  cashLabel: "מזומן",
  noOtherHoldings: "לא היו החזקות במועד הרישום.",
  tickerColumn: "טיקר",
  quantityColumn: "כמות",
  avgCostColumn: "עלות ממוצעת",
  costUnknown: "לא ידועה",
  marketContextTitle: "הקשר השוק",
  capturedPrefix: "נתפס ב-",
  indexChangeSuffix: "באותו יום",
  dnaTitle: "השערות DNA שהיו בתוקף",
  dnaNote: "הניסוח ו-Evidence Strength כפי שהיו בגרסה שבתוקף ברישום.",
  strategyTitle: "גרסת ה-Strategy שהוקפאה",
  strategyIsCurrent: "גרסת ה-Strategy שהוקפאה היא הגרסה שבתוקף גם היום.",
  strategyIsOlder: "מאז הרישום אושרה גרסת Strategy חדשה יותר. הגרסה שהוקפאה נשמרה כפי שהייתה.",
  strategyUnknown: "לא ניתן לבדוק כרגע אם זו עדיין הגרסה שבתוקף.",
  strategyLimitation: "עקרונות הגרסה שהוקפאה אינם מוצגים כאן.",
  caseCopyTitle: "העתק התיק כפי שהוקפא",
  caseCopyNote: "העתק של תיק המחקר מרגע הרישום. ה-Review מצטט ממנו.",
  caseCopyEmpty: "העתק התיק לא כולל קריאת AI או נתוני שוק.",
  // TODAY
  todayTitle: "היום",
  todayHint: "מחושב עכשיו מהנתונים שלך. לא חלק מהרשומה.",
  settled: "אין כרגע דבר פתוח בהחלטה הזו.",
  horizon: {
    not_set: "לא נקבע מועד Review",
    upcoming: "מועד ה-Review עוד לא הגיע",
    due: "הגיע מועד ה-Review",
    satisfied: "בוצע Review מאז המועד",
  } as Record<string, string>,
  predictionsDueSuffix: "תחזיות שהגיע מועד בדיקתן",
  pendingSuffix: "תחזיות ותנאים פתוחים",
  heldPrefix: "מוחזק כעת:",
  flat: "לא מוחזק כעת",
  positionUnknown: "מצב הפוזיציה לא זמין",
  historyThroughPrefix: "היסטוריית העסקאות עד",
  // SINCE
  sinceTitle: "מאז · מה נוסף אחרי ההחלטה",
  sinceHint: "תוספות מאוחרות. הן לא משנות את מה שנכתב אז.",
  laterContextTitle: "הקשר שהוספת",
  laterContextEmpty: "עוד לא הוספת הקשר להחלטה הזו.",
  addedByPrefix: "נוסף על ידי",
  laterContextLabel: "הקשר חדש",
  laterContextHelp: "הבהרה או תיקון שנשמרים לצד הרשומה, בלי לשכתב אותה. ה-Review מתייחס אליהם.",
  addContextButton: "הוסף הקשר",
  addingContextButton: "מוסיף...",
  // predictions
  predictionsTitle: "תחזיות ותנאים",
  predictionsHint: "בכל שורה: מה ה-AI חילץ מהנימוק שלך ברישום, ומה קבעת מאז. תנאי לשקילה מחדש הוא בדיקה שקבעת לעצמך, לא ציון לתזה.",
  predictionsEmpty: "לא חולצו תחזיות או תנאים מהנימוק של ההחלטה הזו.",
  thenColumn: "מה חולץ מהנימוק אז",
  sinceColumn: "מה קבעת מאז",
  checkableByPrefix: "ניתנת לבדיקה עד",
  noCheckDate: "בלי מועד בדיקה",
  stillOpen: "עדיין פתוח",
  resolvedOnPrefix: "נקבע ב-",
  resolvedInReview: "נקבע במסגרת Review",
  // REVIEW
  reviewTitle: "מבט לאחור (Review)",
  reviewHint: "ניתוח בדיעבד. כל Review נשמר כפי שנוצר; Review נוסף הוא רשומה חדשה.",
  noReviewTitle: "עדיין אין Review להחלטה הזו",
  noReviewHint: "אפשר להריץ Review בכל עת. מועד ה-Review שקבעת הוא תזכורת, לא תנאי.",
  resolveFirstTitle: "לפני Review: מה קרה בפועל?",
  resolveFirstHint:
    "ה-Review דורש קביעה שלך לכל תחזית ותנאי שעדיין פתוחים. זו קביעה שלך, המערכת לא בודקת את השוק. תנאי אפשר לקבוע גם בשורה שלו למעלה.",
  resolutionNoteLabel: "מה קרה בפועל (חובה)",
  runReview: "הרץ Review",
  runAnotherReview: "הרץ Review נוסף",
  runningReview: "מריץ Review. זה עשוי לקחת רגע...",
  reviewFailed: "ה-Review לא נשמר. שום דבר לא נכתב.",
  reviewOfPrefix: "מבט לאחור מ-",
  latestReview: "האחרון",
  olderReviewsTitle: "Reviews קודמים",
  axisQuality: "איכות התהליך",
  axisAccuracy: "דיוק התזה",
  axisOutcomePrefix: "תוצאה נכון ל-",
  axesNote: "שלושה דברים נפרדים: איך התקבלה ההחלטה, האם התזה החזיקה, ומה קרה למחיר. התוצאה אינה משנה את תווית האיכות.",
  reviewLanguageNote: "הניתוח עצמו נשמר באנגלית, כפי שנוצר.",
  outcomePriceThen: "מחיר ברישום",
  outcomePriceAtReview: "מחיר במועד ה-Review",
  outcomeUnavailable: "לא היה זמין",
  outcomeChange: "שינוי",
  outcomePnl: "רווח/הפסד על הגודל שנרשם",
  outcomeStillHeld: "הוחזק במועד ה-Review",
  outcomeNotHeld: "לא הוחזק במועד ה-Review",
  passRevealShow: "הצג מה קרה למחיר מאז",
  passRevealHide: "הסתר",
  passRevealNote: "בהחלטת דילוג זה בדיוק ה'מה היה אילו'. מוצג רק כשביקשת.",
  dimensionsTitle: "שבעת הממדים",
  citedTitle: "הראיות שצוטטו",
  noCitations: "לא צוטטו ראיות",
  disagreeButton: "חולק על השיפוט הזה",
  disagreeLabel: "למה אתה חולק?",
  disagreeSubmit: "שלח השגה",
  disagreeSubmitting: "שולח...",
  disagreeCancel: "ביטול",
  disagreeSaved: "ההשגה נרשמה. היא לא משנה את ה-Review, ועדיין אין באתר מקום לקרוא השגות קודמות.",
};

// ReviewDimension.dimension — display labels only.
export const reviewDimensionLabel: Record<string, string> = {
  thesis_quality: "איכות התזה",
  evidence_quality: "איכות הראיות",
  risk_awareness: "מודעות לסיכון",
  valuation_awareness: "מודעות לשווי",
  portfolio_fit: "Portfolio Fit",
  strategy_consistency: "עקביות עם ה-Strategy",
  exit_conditions: "תנאי יציאה",
};

// ReviewDimension.cited_snapshot_fields — display labels for the field
// identifiers the review engine validates (CITABLE_SNAPSHOT_FIELDS plus the
// two conditional fields). The stored identifiers never change.
export const citedFieldLabel: Record<string, string> = {
  userReasoningText: "הנימוק שכתבת",
  risksConsideredText: "סיכונים ששקלת",
  exitConditionsText: "תנאי היציאה שכתבת",
  aiRealtimeAssessmentText: "הערכת ה-AI ברישום",
  laterContexts: "הקשר שהוספת",
  thesisText: "התזה",
  thesisInterpretationText: "פרשנות התזה ברישום",
  priceAtDecision: "מחיר ברישום",
  size: "גודל",
  portfolioStateJson: "מצב התיק ברישום",
  marketContext: "הקשר השוק",
  caseMarketIntelligence: "תמונת השוק מהתיק",
  caseBullCaseText: "Bull מהתיק",
  caseBearCaseText: "Bear מהתיק",
  caseCatalystsText: "קטליזטורים מהתיק",
  caseInvalidationConditionsText: "מה יפריך את התזה, מהתיק",
  caseMarketBlindspotText: "מה הנתונים לא יכלו לומר, מהתיק",
  caseDevilsAdvocateText: "עורך דין לשטן, מהתיק",
  casePersonalFitText: "Personal Fit מהתיק",
  casePortfolioFitText: "Portfolio Fit מהתיק",
  strategyPrinciplesInEffect: "עקרונות Strategy שבתוקף",
  dnaHypothesesInEffect: "השערות DNA שבתוקף",
  predictionsAndResolutions: "תחזיות והקביעות שלך",
  priorRecord: "הרקורד הקודם",
  executionFacts: "ביצוע בפועל",
};

// --- Trade History Import (src/app/import/page.tsx) ---

export const importFieldLabel: Record<string, string> = {
  date: "תאריך",
  ticker: "טיקר",
  type: "סוג (קנייה/מכירה/דיבידנד/עמלה/הפקדה/משיכה/זיכוי מס)",
  quantity: "כמות",
  price: "מחיר",
  amount: "סכום",
  commission: "עמלה (אופציונלי — נכלל בתוך הסכום)",
  notes: "הערות",
};

export const importPage = {
  title: "ייבוא היסטוריית מסחר",
  description:
    "שחזור היסטוריית העסקאות שלך, מקובץ של הברוקר או בהזנה ידנית. היסטוריה חלקית היא תקינה: אם פוזיציה נפתחה לפני החלון שאתה מעלה, תתבקש להזין בנפרד מה החזקת בתחילתו. המערכת לעולם לא מניחה שהקובץ הוא כל התיק.",
  modeLabel: "איך להוסיף עסקאות",
  fileMode: "ייבוא מקובץ",
  fileModeHint: "קובץ CSV מהברוקר, עם עמודה לכל שדה.",
  manualMode: "הזנה ידנית",
  manualModeHint: "עסקאות קנייה ומכירה שאתה מקליד בעצמך.",
  // upload
  uploadTitle: "בחירת קובץ",
  uploadLabel: "קובץ CSV",
  uploadHelp:
    "הקובץ משמש להכנת הייבוא ולאישורו. המערכת שומרת את העסקאות ואת שם הקובץ, לא את הקובץ עצמו.",
  readingFile: "קורא את הקובץ...",
  // mapping
  mappingTitle: "מיפוי עמודות",
  mappingRowsPrefix: "נמצאו בקובץ",
  mappingRowsSuffix: "שורות.",
  mappingHint:
    "לכל שדה בחר את העמודה בקובץ שמספקת אותו. המערכת מילאה ניחוש ראשוני לפי שמות העמודות; אפשר לשנות כל בחירה. המיפוי משמש לייבוא הזה בלבד ואינו נשמר.",
  mappingRequiredNote: "תאריך וסוג עסקה חובה. שאר השדות לפי מה שיש בקובץ.",
  notMappedOption: "לא ממופה",
  previewRowsSummary: "השורות הראשונות בקובץ, כפי שנקראו",
  previewRowPrefix: "שורה",
  checkButton: "בדוק את הקובץ",
  changeFileButton: "בחר קובץ אחר",
  backToMappingButton: "חזרה למיפוי",
  // review
  reviewTitle: "בדיקה מקדימה",
  advisoryNote: "זו בדיקה מקדימה. בזמן האישור המערכת בודקת מחדש מול המידע העדכני.",
  checking: "בודק את הקובץ...",
  rowsTotal: "שורות בקובץ",
  rowsValid: "שורות תקינות",
  rowsInvalid: "שורות לא תקינות",
  splitsConsidered: "פיצולי מניה רשומים שנלקחו בחשבון",
  invalidTitle: "שורות שצריך לתקן",
  invalidHint:
    "האישור לא יתקבל כל עוד יש שורה לא תקינה. תקן אותן בקובץ והעלה אותו מחדש. הודעות הבדיקה מוצגות כפי שהמערכת כתבה אותן.",
  rowLabel: "שורה",
  // opening states
  openingTitle: "מה החזקת בתחילת החלון",
  openingHint:
    "לטיקרים האלה יש מכירה שהקובץ לבדו לא מסביר, כנראה כי הפוזיציה נפתחה לפני החלון. הזן מה החזקת ממש לפני תחילת הקובץ. זה מידע שאתה מצהיר עליו, והוא נשמר ככזה.",
  openingSeparateNote:
    "יתרות הפתיחה נשמרות אחרי שהעסקאות נשמרו, כפעולה נפרדת. אם תשאיר טיקר ריק, העסקאות יישמרו והמכירות שלו יסומנו כחורגות מההחזקה הידועה.",
  openingQuantity: "כמות",
  openingCostBasis: "עלות למניה (אופציונלי)",
  openingConfidence: "ודאות העלות",
  openingAsOf: "נכון לתאריך",
  // confirm
  confirmTitle: "אישור",
  confirmExplanation:
    "באישור המערכת קוראת את הקובץ מחדש, מאמתת כל שורה, בודקת שוב מול ההיסטוריה העדכנית ושומרת את העסקאות בפעולה אחת. אם משהו השתנה מאז הבדיקה המקדימה, התוצאה עשויה להיות שונה, או שהאישור יסורב.",
  confirmOpeningNote: "יתרות הפתיחה שהזנת יישמרו אחרי העסקאות, בנפרד.",
  estimatePrefix: "לפי הבדיקה המקדימה ייכנסו להיסטוריה",
  estimateSuffix: "שורות.",
  blockedInvalid: "יש שורות לא תקינות בקובץ.",
  blockedUnresolved: "יש שורות שממתינות להכרעה שלך.",
  blockedRefresh: "רענן את מצב ההיסטוריה לפני ניסיון נוסף.",
  confirmButton: "אשר ושמור את העסקאות",
  confirmingButton: "שומר...",
  // failure
  refusedTitle: "האישור סורב. שום דבר לא נשמר.",
  uncertainTitle: "האישור לא הושלם כצפוי. ייתכן שחלק מהמידע כבר נשמר.",
  uncertainBody:
    "רענן את המצב ובדוק אותו לפני ניסיון נוסף. אם העסקאות כבר נשמרו, אישור חוזר ידלג על כפילויות מדויקות, אבל יתרות פתיחה יישמרו שוב.",
  manualUncertainBody:
    "רענן את המצב ובדוק אותו לפני ניסיון נוסף. אם העסקאות כבר נשמרו, שליחה חוזרת תסומן ככפילות ותדרוש את ההכרעה שלך.",
  refreshButton: "רענן את המצב",
  refreshingButton: "מרענן...",
  // done
  doneTitle: "העסקאות נשמרו",
  doneTransactionsTitle: "העסקאות",
  doneImported: "עסקאות נוספו להיסטוריה",
  doneSeparate: "מתוכן סומנו על ידך כעסקאות נפרדות",
  doneSkippedExact: "שורות דולגו כי כבר היו בהיסטוריה",
  doneSkippedSame: "שורות דולגו כי אישרת שהן עסקאות קיימות",
  doneFile: "קובץ",
  doneOpeningTitle: "יתרות פתיחה",
  doneOpeningSaved: "יתרות פתיחה נשמרו אחרי העסקאות, בפעולה נפרדת.",
  doneOpeningNone: "לא הוזנו יתרות פתיחה בייבוא הזה.",
  positionsSummary: "הפוזיציות כפי שחושבו אחרי השמירה",
  positionsAvgCost: "עלות ממוצעת",
  positionsCash: "מזומן",
  noPositions: "אין פוזיציות פתוחות.",
  journalNext: "אם תרצה לתעד למה נכנסת לפוזיציות, אפשר להוסיף את הנימוק ביומן הפוזיציות.",
  journalLink: "ליומן הפוזיציות",
  importAnotherButton: "ייבא קובץ נוסף",
};

// --- History status (History Refresh V1) on /import. Facts about how far
// the persisted history reaches: orientation, never a score, a broker-sync
// claim, or a statement that the portfolio is current. ---
export const historyFreshness = {
  title: "מצב ההיסטוריה",
  latestTransaction: "העסקה האחרונה הידועה",
  age: "לפני",
  ageDays: "ימים",
  ageToday: "היום",
  totalTransactions: "עסקאות בהיסטוריה",
  latestFile: "הקובץ האחרון שיובא",
  latestFileWindow: "טווח התאריכים בקובץ",
  latestFileRows: "שורות שנוספו ממנו",
  manualEntries: "עסקאות שהוזנו ידנית",
  manualLatestPrefix: "האחרונה ב-",
  to: "עד",
  noHistoryTitle: "עדיין אין היסטוריית עסקאות",
  noHistory: "זה הייבוא הראשון. אפשר להתחיל מקובץ של הברוקר או להזין עסקאות ידנית.",
  disclaimer: "המערכת יודעת רק מה שיובא או הוזן כאן; היא לא מחוברת לברוקר.",
};

// --- Stock splits (Import Blockers V1) on /import. One kind only; the
// investor records a fact from a named source and confirms it explicitly;
// the original BUY/SELL rows are never touched. ---
export const corporateActionsPage = {
  title: "פיצולי מניה",
  description:
    "פיצול (או פיצול הפוך) שבוצע בנייר שהחזקת. המערכת לא מזהה פיצולים לבד: אתה רושם עובדה ממקור שאתה מציין, והרישום אינו ניתן לשינוי. העסקאות המקוריות לא נערכות; חישוב הפוזיציות מיישם את היחס מתאריך התחילה.",
  listTitle: "פיצולים רשומים",
  none: "לא נרשמו פיצולים.",
  recordedOnPrefix: "נרשם ב-",
  formTitle: "רישום פיצול",
  tickerLabel: "טיקר",
  effectiveDateLabel: "תאריך תחילה",
  effectiveDateHint: "היום הראשון שבו הכמויות מבוטאות ביחידות שאחרי הפיצול.",
  ratioNumerator: "מניות אחרי",
  ratioDenominator: "מניות לפני",
  ratioHint: "לדוגמה 4 : 1 הן ארבע מניות חדשות על כל מניה; פיצול הפוך הוא 1 : 10.",
  sourceLabel: "מקור העובדה",
  sourceIssuer: "הודעת החברה או דיווח רגולטורי",
  sourceBroker: "דוח ברוקר",
  sourceUser: "הצהרה שלי",
  evidenceLabel: "ראיה (ציטוט מהמקור)",
  evidencePlaceholder: "לדוגמה: הודעת החברה על פיצול 4:1; או שורת ההחזקה בדוח הברוקר לפני התאריך ושורת המכירה אחריו",
  confirmLabel: "אני מאשר שהיחס והתאריך נלקחו מהמקור שצוין ולא הוסקו מכמויות בלבד",
  recordButton: "רשום פיצול",
  recordingButton: "רושם...",
  uniqueNote: "לכל טיקר אפשר לרשום פיצול אחד בכל תאריך.",
  uncertainBody: "רענן את הדף ובדוק ברשימה אם הפיצול נרשם לפני ניסיון נוסף.",
};

// --- Transaction reconciliation (History Refresh V1) — shared by the file
// review and manual entry on /import. ---
export const reconciliation = {
  heading: "התאמה מול ההיסטוריה הקיימת",
  explanation:
    "כל שורה הושוותה לעסקאות שכבר במערכת. כפילות מדויקת של עסקה קיימת מדולגת; שורה שאולי תואמת עסקה קיימת דורשת את ההכרעה שלך, והמערכת לא מנחשת. בזמן האישור ההשוואה נעשית שוב.",
  manualExplanation:
    "כל שורה הושוותה לעסקאות שכבר במערכת ולשורות הקודמות בטופס. שורה זהה או שאולי תואמת דורשת את ההכרעה שלך. בזמן השמירה ההשוואה נעשית שוב.",
  newCount: "חדשות",
  exactCount: "כפילויות מדויקות",
  probableCount: "התאמות אפשריות",
  ambiguousCount: "לא חד-משמעיות",
  willInsertPrefix: "לפי הבדיקה המקדימה ייכנסו",
  willInsertSuffix: "שורות.",
  unresolvedNote: "יש שורות שדורשות הכרעה לפני האישור.",
  decisionsTitle: "שורות שדורשות הכרעה",
  rowPrefix: "שורה",
  probableRowNote: "אולי אותה עסקה שכבר קיימת:",
  ambiguousRowNote: "יותר מעסקה קיימת אחת יכולה להתאים. בחר איזו, או סמן כעסקה נפרדת.",
  exactRowNote: "זהה לעסקה שכבר קיימת במערכת.",
  exactWithinBatchNote: "זהה לשורה קודמת בטופס הזה.",
  sameChoice: "זו אותה עסקה: השאר את הקיימת ודלג על השורה",
  separateChoice: "זו עסקה נפרדת: הוסף גם אותה",
  manualSameChoice: "זו אותה עסקה: אל תשמור שוב",
  manualSeparateChoice: "זו עסקה זהה נפרדת בכוונה: שמור בכל זאת",
  candidateLabel: "עסקה קיימת",
  chooseCandidate: "בחר עסקה קיימת",
  manualSource: "הוזנה ידנית",
  csvSource: "מקובץ",
};

// --- Same-day ordering (Investment Episode Independence design) — shared
// by the file review and manual entry on /import. ---
export const collisionResolution = {
  heading: "כמה עסקאות באותו טיקר באותו יום",
  explanation:
    "כדי לשחזר את ההחזקות נכון, המערכת צריכה לדעת באיזה סדר התרחשו עסקאות של אותו יום. אין לה שעות, ולכן היא לא מנחשת.",
  declareHint:
    "אם אתה יודע את הסדר, תן לכל שורה מספר שונה (1, 2, ...). אם לא כל השורות יקבלו מספר, הקבוצה תישמר עם סדר לא ידוע, וזה תקין.",
  orderLabel: "סדר",
  existingNote:
    "הקבוצה כוללת עסקה שכבר שמורה, ולכן לא מזינים כאן סדר: כל העסקאות בקבוצה יישמרו עם סדר שלא נרשם.",
  existingOrderedNote:
    "לעסקאות הקיימות ביום הזה כבר נקבע סדר, והמערכת עדיין לא תומכת בהוספת עסקה נוספת לאותו יום. האישור יסורב כל עוד השורה הזו בקובץ.",
  existingRow: "עסקה שכבר שמורה",
};

// --- Manual Historical Entry on /import — actual trades only, never
// hypothetical scenarios (docs/backlog.md). ---
export const manualEntryPage = {
  title: "הזנה ידנית",
  description:
    "עסקאות היסטוריות שביצעת בפועל, לא תרחישים. כל שורה נשמרת כמו עסקה מקובץ ומשפיעה על חישובי התיק באותו אופן, עם סימון שהיא הוזנה ידנית. הסכום מחושב במערכת מהכמות והמחיר.",
  rowTitle: "עסקה",
  tickerLabel: "טיקר",
  typeLabel: "סוג",
  quantityLabel: "כמות",
  priceLabel: "מחיר למניה",
  dateLabel: "תאריך",
  notesLabel: "הערה כללית (אופציונלי)",
  notesPlaceholder: "הערה על הרשומה. את הסיבה שנכנסת לפוזיציה כותבים ביומן הפוזיציות.",
  buyOption: "קנייה",
  sellOption: "מכירה",
  addRowButton: "הוסף שורה",
  removeRowButton: "הסר שורה",
  incompleteNote: "הבדיקה מול ההיסטוריה הקיימת תרוץ כשכל השורות מלאות.",
  submitButton: "שמור עסקאות",
  savingButton: "שומר...",
  provenance: "הוזן ידנית",
  savedTitle: "העסקאות נשמרו",
  savedCountLabel: "עסקאות נשמרו",
  skippedCountLabel: "שורות לא נשמרו כי אישרת שהן עסקאות קיימות",
  enterMoreButton: "הזן עוד עסקאות",
  journalNext:
    "אם תרצה לתעד למה נכנסת, אפשר להוסיף את הנימוק ביומן הפוזיציות. עסקה שאינה חלק מפוזיציה עם קנייה בהיסטוריה לא תופיע שם כפוזיציה שאפשר לתעד.",
};

// --- "Tell me why" — user-initiated historical rationale
// (docs/backlog.md). Deterministic, not AI-generated — {ticker} is
// interpolated in code (src/lib/interview/tell-me-why-question.ts), not
// by a model call. ---

export const tellMeWhy = {
  buttonLabel: "אני רוצה לספר למה ביצעתי את העסקה הזו",
  // Unit 7C-B: Tell me why is ENTRY rationale only. The one template asks
  // about the decision to enter and nothing after it (no management, selling
  // or exit). Rows stored under the earlier wordings keep their own
  // question_text (tell_me_why_legacy); nothing here rewrites them.
  entryQuestionTemplate: "ספר לי על הכניסה שלך ל-{ticker}: מה הוביל אותך להחליט להיכנס להשקעה הזו באותו זמן?",
  answerPlaceholder:
    "התשובה שלך — הסיפור המלא, כולל אם רלוונטי: למה נכנסת, מה קרה במהלך ההחזקה, ולמה יצאת (בבת אחת או בכמה שלבים)...",
  saveButton: "שמור",
  savingButton: "שומר...",
  savedConfirmation: "נשמר — התשובה תילקח בחשבון בפעם הבאה שתיצור השערות DNA.",
  // Episode Journal V1 — the same deterministic builder, with episode
  // context. Only ENTRY-time facts may appear in these templates
  // (hindsight protection): never P&L, exit, or later prices.
  contextTemplate: "פוזיציה {episode} — כניסה ב-{date} {amount}.",
  entryAmountTemplate: "(קנייה של {quantity} מניות במחיר ${price})",
  updateButton: "עדכן את הרציונל",
  updateHint: "עדכון יוצר תשובה חדשה שמחליפה את הקודמת בספירה; התשובה המקורית נשארת בהיסטוריה כמות שהיא.",
  cancelButton: "ביטול",
};

// --- Episode Journal (src/app/journal/page.tsx, Frontend V1 unit 7A) ---
// A position lifecycle and the investor's own rationale for entering it.
// Before a rationale exists only entry-time facts appear; later facts sit
// in a closed, labelled region. An answer is a possible source, never
// "evidence" by the mere fact of existing.

export const journalPage = {
  title: "יומן פוזיציות",
  description:
    "כל פוזיציה מההיסטוריה שלך, לצד מה שכתבת על הסיבה שנכנסת אליה. היומן נגזר מהעסקאות שייבאת ואינו נשמר בנפרד; הנימוקים נשמרים במילים שלך.",
  coveragePrefix: "כתבת נימוק ל-",
  coverageMiddle: "מתוך",
  coverageSuffix: "פוזיציות.",
  unansweredTitle: "ממתינים לנימוק",
  unansweredHint: "מהכניסה האחרונה לראשונה. מוצג רק מה שהיה ידוע ביום הכניסה; מה שקרה אחר כך יופיע אחרי שתכתוב.",
  answeredTitle: "עם נימוק",
  answeredHint: "מהכניסה האחרונה לראשונה. הנימוק שלך קודם; מה שקרה אחר כך נמצא בנפרד.",
  noneWaiting: "לכל הפוזיציות ביומן יש נימוק.",
  noneAnswered: "עדיין לא נכתב נימוק לאף פוזיציה.",
  emptyTitle: "אין עדיין פוזיציות לשחזר",
  emptyHint: "היומן נבנה מהיסטוריית המסחר שלך. אחרי ייבוא העסקאות יופיעו כאן הפוזיציות שפתחת.",
  emptyAction: "לייבוא היסטוריית מסחר",
  positionOrdinal: "פוזיציה",
  entryPrefix: "כניסה",
  firstTradePrefix: "עסקה ראשונה בהיסטוריה המיובאת",
  sharesAt: "מניות במחיר",
  notAnchorable:
    "אי אפשר לכתוב נימוק לפוזיציה הזו: אין בה קנייה בהיסטוריה המיובאת, כנראה כי נפתחה לפני חלון הייבוא.",
  writeButton: "כתוב למה נכנסת",
  openingButton: "פותח...",
  hindsightNote: "לפני הכתיבה מוצגות רק עובדות מיום הכניסה. מה שקרה אחר כך יוצג רק אחרי שהנימוק יישמר.",
  questionLabel: "השאלה",
  questionProvenance: "שאלה קבועה שהמערכת בונה מעובדות הכניסה בלבד. היא לא נכתבה על ידי AI ואינה ראיה.",
  answerLabel: "התשובה שלך",
  saveNote:
    "התשובה תישמר כפי שכתבת אותה, עם התאריך של היום, כהצהרה היסטורית שלך. התשובה עשויה לשמש בהמשך כמקור כאשר המערכת בוחנת דפוסים ועקרונות.",
  saveButton: "שמור את הנימוק",
  savingButton: "שומר...",
  closeButton: "סגור בלי לשמור",
  saveFailedTitle: "השמירה לא אושרה. הטקסט שלך נשאר כאן; פתח את השאלה מחדש כדי לקבל את העובדות העדכניות לפני שתשמור.",
  writtenOnPrefix: "כתבת ב-",
  inReplyTo: "בתשובה לשאלה:",
  answerProvenance: "המילים שלך, כפי שנשמרו. הן עשויות לשמש בהמשך כמקור כאשר המערכת בוחנת דפוסים ועקרונות.",
  severalAnswers: "לפוזיציה הזו יש כמה תשובות נוכחיות, מהישנה לחדשה. עדכון מחליף את האחרונה בלבד.",
  updateButton: "עדכן את הנימוק",
  updateNote:
    "העדכון נשמר כתשובה חדשה; התשובה הקודמת נשארת ברשומה ואינה משמשת עוד כתשובה הנוכחית. אי אפשר לעיין כאן בתשובות קודמות, והעדכון אינו משנה ראיות או ניתוחים קודמים של DNA ו-Strategy.",
  updateHindsight: "בזמן העדכון מה שקרה אחר כך מוסתר.",
  updateUnchanged: "הטקסט זהה לתשובה הנוכחית.",
  updateSaveButton: "שמור כתשובה חדשה",
  laterSummary: "מה קרה אחר כך",
  laterNote: "עובדות שנגזרו מהעסקאות אחרי הכניסה. הן לא היו ידועות כשנכנסת ואינן חלק מהנימוק.",
  statusLabel: "מצב הפוזיציה",
  statusOpen: "פתוחה",
  statusClosed: "סגורה",
  tradesLabel: "עסקאות בפוזיציה",
  buysSuffix: "קניות",
  sellsSuffix: "מכירות",
  exitLabel: "יציאה",
  holdingDaysLabel: "ימי החזקה",
  sellsTitle: "תשואה ממומשת בכל מכירה",
  sellOnPrefix: "מכירה ב-",
  insufficientHoldingsNote: "המכירה עלתה על ההחזקה הידועה, כנראה כי חסר מצב פתיחה; המספר לא אמין",
  stillOpenNote: "הפוזיציה עדיין פתוחה, ולכן אין לה יציאה.",
  noSellTrace: "לא נרשמו מכירות עם תשואה ממומשת לפוזיציה הזו.",
  // Unit 7C-F: answers about other actions of the position (action answers).
  actionAnswersTitle: "תשובות על פעולות בפוזיציה",
  actionAnswersNote: "תשובות שנתת על פעולות אחרות בפוזיציה. הן אינן הנימוק לכניסה ואינן נספרות בכיסוי.",
  sideBuy: "קנייה",
  sideSell: "מכירה",
  actionFactsTitle: "מה היה רשום עד הפעולה",
  provenanceUnknown: "מקור השאלה לא נרשם.",
};

// --- Guided Interview (src/app/interview/page.tsx, src/components/interview,
// Frontend V1 unit 7C-F). Three layers stay apart on every question: the
// system's record of what was known at the action, the system's question, and
// the investor's answer. Nothing here speaks of results, rankings or what
// happened afterwards. ---

export const interviewPage = {
  title: "ראיון מודרך",
  description: "כמה שאלות על פעולות מההיסטוריה שלך. לכל פעולה מוצג רק מה שהיה רשום עד אותו רגע, והשאלה היא מה הנחה אותך אז.",
  howTitle: "איך זה עובד",
  howSelect: "המערכת בוחרת פעולות לפי מבנה ההיסטוריה המיובאת: קנייה ראשונה, הוספה לפוזיציה, מכירה חלקית, מכירת כל הפוזיציה.",
  howFacts: "העובדות שמוצגות לכל פעולה הן מהעסקאות שייבאת, כפי שעמדו רגע לפני הפעולה. מה שקרה אחר כך אינו מוצג.",
  howAnswers: "כל תשובה נשמרת במילים שלך כהצהרה מתוארכת, ועשויה לשמש בהמשך כמקור כאשר המערכת בוחנת דפוסים ועקרונות.",
  startButton: "התחל ראיון",
  preparing: "מכין את השאלות...",
  noHistoryTitle: "עדיין אין היסטוריית עסקאות",
  noHistoryBody: "אחרי ייבוא העסקאות יהיה על מה לשאול.",
  importLink: "לייבוא היסטוריית מסחר",
  noEligibleTitle: "אין כרגע פעולה שאפשר לשאול עליה",
  noEligibleBody:
    "הראיון שואל רק על פעולות מההיסטוריה המיובאת שהמצב שלפניהן ידוע מספיק. כרגע לא נמצאה פעולה מתאימה לשאלה בטוחה. פעולה שסדר הביצוע שלה באותו יום לא נרשם, או שכבר יש לה תשובה, אינה נשאלת.",
  startFailed: "לא הצלחנו להכין את השאלות. לא נפתח ראיון ושום דבר לא נשמר. אפשר לנסות שוב.",
  progressPrefix: "שאלה",
  progressMiddle: "מתוך",
  factsTitle: "מה היה רשום עד הפעולה",
  factsProvenance: "עובדות מהעסקאות שייבאת, כפי שעמדו רגע לפני הפעולה. לא כולל מה שקרה אחר כך.",
  questionLabel: "השאלה",
  aboutQuestion: "על השאלה הזו",
  sourceAi: "נוסחה מתוך העובדות שלמעלה בלבד ונבדקה בקוד לפני שהוצגה.",
  sourceDeterministic: "ניסוח קבוע של המערכת מתוך העובדות שלמעלה.",
  answerLabel: "מה הנחה אותך אז",
  answerHelp: "התשובה תישמר כפי שכתבת אותה, עם תאריך של היום. היא עשויה לשמש בהמשך כמקור כאשר המערכת בוחנת דפוסים ועקרונות.",
  saveNext: "שמור והמשך",
  saveFinish: "שמור וסיים",
  saving: "שומר...",
  skip: "דלג על השאלה הזו",
  skipHelp: "שאלה שדילגת עליה לא נשמרת; ייתכן שתופיע שוב בראיון הבא.",
  announceSaved: "נשמר.",
  announceSkipped: "דילגת.",
  restartRequired:
    "העובדות שמאחורי השאלה הזו השתנו מאז שהראיון נפתח, ולכן התשובה לא נשמרה. הטקסט שלך נשאר כאן. התחל ראיון מחדש כדי לקבל שאלות על העובדות העדכניות.",
  restartButton: "התחל ראיון מחדש",
  previousDraft: "הטקסט שכתבת קודם (לא נשמר)",
  refusedTitle: "התשובה לא נשמרה.",
  uncertain: "לא התקבל אישור שהתשובה נשמרה. הטקסט שלך נשאר כאן. אם תשלח שוב ייתכן שתיווצר תשובה שנייה.",
  doneTitle: "הראיון הסתיים",
  doneSavedPrefix: "נשמרו",
  doneSavedMiddle: "תשובות מתוך",
  doneSavedSuffix: "שאלות",
  doneSkippedSuffix: "דולגו",
  doneBody: "התשובות נשמרו כהצהרות מתוארכות שלך. הן עשויות לשמש כמקור בפעם הבאה שתיצור או תבחן DNA ואסטרטגיה; שום דבר לא נוצר אוטומטית.",
  toJournal: "ליומן הפוזיציות",
  toDna: "ל-DNA משקיע",
  unconfirmedSavedTitle: "התשובה נשמרה",
  unconfirmedSavedBody: "התשובה האחרונה נשמרה, אבל לא התקבל אישור שהראיון נסגר. אין צורך לשלוח את התשובה שוב.",
  unconfirmedSkippedTitle: "לא התקבל אישור שהראיון נסגר",
  unconfirmedSkippedBody: "דילגת על השאלה האחרונה, ולכן לא נשמרה עליה תשובה. לא התקבל אישור שהראיון נסגר.",
  unconfirmedCountsPrefix: "בראיון הזה:",
  unconfirmedCountsSaved: "תשובות נשמרו",
  unconfirmedNext: "אפשר לחזור לראיון מאוחר יותר או לעבור ליומן.",
  backToInterview: "חזרה לראיון",
};

// The structural role of a historical action (anchor_context.anchor.role).
// Descriptive only: no role is better or worse than another.
export const actionRoleLabel: Record<string, string> = {
  initial_buy: "קנייה ראשונה",
  add_buy: "הוספה לפוזיציה",
  partial_sell: "מכירה חלקית",
  full_sell: "מכירת כל הפוזיציה",
};

// interview_answers.question_provenance, as a calm human label: where the
// question an answer responded to came from. Never a quality grade.
export const questionProvenanceLabel: Record<string, string> = {
  guided_pit_ai: "שאלה שנוסחה מתוך עובדות הזמן־אמת.",
  guided_pit_fallback: "שאלה קבועה של המערכת מתוך עובדות הזמן־אמת.",
  guided_legacy: "שאלה שנוצרה לפני כלל הזמן־אמת ועשויה להזכיר מידע מאוחר.",
  tell_me_why_pit: "שאלת \"ספר לי למה\" הקבועה, על הכניסה.",
  tell_me_why_legacy: "שאלת \"ספר לי למה\" קבועה, מלפני שעובדות הזמן־אמת נשמרו עם התשובה.",
};

// --- Investor DNA (src/components/dna + src/components/claims, Frontend V1
// unit 6A). A DNA statement is a claim about a possible recurring pattern,
// shown with the current strength of its evidence. Chrome only: statements,
// AI citation summaries and change reasons stay as stored. ---

export const dnaPage = {
  title: "DNA משקיע",
  description:
    "טענות על דפוסים אפשריים באופן שבו אתה משקיע, כל אחת עם הראיות שתומכות בה ושסותרות אותה. Evidence Strength מתאר כמה הראיות חזקות לטענה, לא ציון שלך כמשקיע.",
  // generate
  generateTitle: "עדכון הטענות",
  generateHint:
    "ה-AI קורא את תשובות הראיון שלך ואת מה שכתבת בזמן ההחלטות (נימוק, סיכונים, תנאי יציאה), ומציע טענות עם ציטוטים. כל ציטוט נבדק מול הטקסט שלך, והקוד סופר מקרים עצמאיים וקובע את Evidence Strength. הרצה יכולה ליצור טענה חדשה, להוסיף גרסה לטענה קיימת, להשאיר טענה כפי שהיא או לפסול הצעה.",
  generateButton: "הרץ עדכון",
  generatingButton: "מנתח את ההצהרות שלך...",
  resultCreated: "נוצרו",
  resultVersioned: "עודכנו בגרסה חדשה",
  resultUnchanged: "נשארו ללא שינוי",
  resultDropped: "הצעות נפסלו",
  resultNothingNew: "לא נמצא שום דבר חדש בהרצה הזו.",
  // groups
  usedTitle: "טענות שהמערכת משתמשת בהן",
  usedHint: "יש להן מספיק מקרים עצמאיים, והמערכת נשענת עליהן בניתוחים.",
  usedEmpty: "כרגע אין טענה עם מספיק מקרים עצמאיים כדי שהמערכת תשתמש בה כדפוס. זה מצב תקין.",
  belowTitle: "טענות שעדיין מתחת לסף הראיות",
  belowHint: "מוצגות לך, אבל המערכת לא מתייחסת אליהן כדפוס ולא נשענת עליהן בניתוחים.",
  belowEmpty: "אין טענות מתחת לסף.",
  orderHint: "בסדר שבו המערכת מחזירה אותן. הסדר אינו דירוג.",
  // row
  supportingCasesSuffix: "מקרים עצמאיים תומכים",
  contradictingSuffix: "סותרים",
  citedSuffix: "הצהרות מצוטטות",
  casesNote: "כמה ציטוטים על אותו אירוע או אותה החלטה נספרים כמקרה עצמאי אחד.",
  usedByAi: "המערכת משתמשת בטענה הזו בניתוחים.",
  notUsedByAi: "המערכת לא משתמשת בטענה הזו כרגע. לא כי היא שגויה, אלא כי הראיות מתחת לסף.",
  reachUnknown: "מצב השימוש בטענה לא זמין כרגע.",
  // disclosure
  evidenceTitle: "מה עומד מאחורי הטענה",
  versionPrefix: "גרסה",
  versionCreatedPrefix: "נוצרה ב-",
  changeReasonLabel: "סיבת העדכון, כפי שנשמרה:",
  provenanceMissing: "לגרסה הזו לא נשמר פירוט של ההרצה שיצרה אותה.",
  provenanceGeneratedPrefix: "הרצה מתועדת מ-",
  basisMissing: "לגרסה הזו לא נשמר פירוט של קיבוץ המקרים העצמאיים.",
  basisRangePrefix: "הספירה היא הערכה זהירה: עד",
  basisRangeSuffix: "מקרים תומכים אם אין תלות בין חלק מהם.",
  sourcesPrefix: "מקורות:",
  interviewAnswers: "תשובות ראיון",
  decisionStatements: "הצהרות מזמן החלטה",
  distancePrefix: "כדי לעבור לרמה",
  distanceMiddle: "נדרשים עוד",
  distanceSuffix: "מקרים עצמאיים תומכים, אם לא יתווספו סתירות.",
  unresolvedSuffix: "החלטות מצוטטות עם עסקאות מועמדות שלא סווגו. הן לא נספרות לאף צד עד לסיווג.",
  citationsTitle: "הציטוטים",
  citationsEmpty: "לגרסה הזו אין ציטוטים שנספרים.",
  aiSummaryLabel: "סיכום AI של הציטוט",
  answerTextUnavailable: "הטקסט המקורי של התשובה אינו זמין במסך הזה.",
  openDecision: "פתח את ההחלטה",
  evidenceFailed: "לא הצלחנו לטעון את הציטוטים.",
  // reject
  rejectButton: "אני לא מסכים עם הטענה",
  rejectConfirmTitle: "להסיר את הטענה מהרשימה?",
  rejectConfirmText: "הטענה תפסיק להופיע כפעילה, והמערכת לא תשתמש בה. ההיסטוריה שלה לא נמחקת, אבל כרגע אין באתר פעולה להחזיר אותה.",
  rejectConfirm: "כן, להסיר",
  rejectCancel: "ביטול",
  rejecting: "מסיר...",
  // empty
  emptyTitle: "עוד אין טענות DNA",
  emptyHint: "טענות מוצעות מתוך תשובות הראיון שלך ומהטקסטים שכתבת בזמן ההחלטות. אחרי הראיון המודרך אפשר להריץ עדכון.",
  openInterview: "לראיון המודרך",
  // rule footnote
  ruleTitle: "איך נקבע Evidence Strength",
  ruleText:
    "הקוד סופר מקרים עצמאיים שתומכים בטענה ומקרים שסותרים אותה. פחות משלושה מקרים תומכים: ראיות בלתי מספיקות. סתירה לעולם לא מעלה את הרמה. הרמה מתארת את הביטחון בטענה, לא אותך.",
};

// dna_created_by — who or what produced a DNA statement version.
export const dnaCreatedByLabel: Record<string, string> = {
  ai_generated: "הוצעה על ידי ה-AI מתוך ההצהרות שלך",
  user_correction: "תיקון שלך",
  system_grounding_revalidation: "בדיקה חוזרת של הציטוטים מול הטקסט שלך",
  system_confidence_recalculation: "חישוב מחדש של Evidence Strength",
  system_independence_recalculation: "חישוב מחדש של המקרים העצמאיים",
};

// Where one citation comes from.
export const evidenceSourceLabel: Record<string, string> = {
  interview_answer: "תשובת ראיון",
  decision_statement: "הצהרה מזמן החלטה",
  decision_review: "Review",
  transaction: "עסקה",
  learning_insight: "תובנת למידה",
  manual_note: "הערה ידנית",
  none: "ללא מקור מקושר",
};

// decision_statement_kind — which of the three decision-time texts.
export const decisionStatementKindLabel: Record<string, string> = {
  reasoning: "הנימוק",
  risks: "הסיכונים",
  exit_conditions: "תנאי היציאה",
};

// --- Strategy (src/components/strategy, Frontend V1 unit 6B). The
// investor's operating document: principles they adopted, fixed system
// guardrails, and system observations still being tested — never merged.
// Chrome only: statements, rationales, summaries and edited wording stay as
// stored. ---

export const strategyPage = {
  title: "אסטרטגיית בסיס",
  description:
    "העקרונות שמהם אתה יוצא כשאתה מחליט. חלקם אימצת בעצמך, חלקם גדרות קבועות של המערכת, וחלקם תצפיות של המערכת שעדיין נבדקות. גרסה מאושרת של האסטרטגיה נשמרת עם כל החלטה שנרשמת אחריה.",
  // approved version
  approvedTitle: "הגרסה המאושרת",
  approvedVersionPrefix: "גרסה",
  approvedOnPrefix: "אושרה ב-",
  approvedSummaryLabel: "סיכום השינוי, כפי שכתבת:",
  approvedFrozenNote: "החלטות שנרשמות מעכשיו שומרות את הגרסה הזו כפי שהיא. שינוי מאוחר בעיקרון לא משנה אותה ולא את ההחלטות שכבר נרשמו.",
  historyNote: "גרסאות קודמות נשמרות, וכל החלטה שומרת את הגרסה שהייתה בתוקף כשנרשמה. כרגע אין באתר תצוגה של גרסאות קודמות.",
  driftMiddle: "עקרונות נוצרו או עודכנו אחרי אישור הגרסה הזו, ולכן הגרסה הנוכחית שלהם אינה כלולה בה. תוכן הגרסה המאושרת עצמו אינו מוצג כאן.",
  driftMarker: "נוצר או עודכן אחרי אישור הגרסה; הגרסה הנוכחית שלו אינה כלולה בה",
  noApprovedTitle: "עוד אין גרסה מאושרת",
  noApprovedHint: "רישום החלטה דורש גרסת אסטרטגיה מאושרת, כי כל החלטה שומרת את הגרסה שבתוקף. אפשר לאשר גרסה ראשונה מהעקרונות שלמטה.",
  // approve
  approveTitle: "אישור גרסה חדשה",
  approveHint:
    "האישור יוצר גרסה חדשה, ממוספרת ומתוארכת, מכל העקרונות כפי שהם עכשיו. הגרסאות הקודמות נשארות כפי שהן, והחלטות שכבר נרשמו לא משתנות. החלטות שיירשמו אחרי האישור ישמרו את הגרסה החדשה. כל אישור יוצר גרסה נוספת.",
  summaryLabel: "סיכום השינוי",
  summaryHelp: "במילים שלך. נשמר כפי שנכתב.",
  approveButton: "אשר כגרסה חדשה",
  approvingButton: "מאשר...",
  approvedAsPrefix: "אושרה גרסה",
  // sections
  livePrinciplesTitle: "העקרונות כפי שהם עכשיו",
  livePrinciplesHint: "הגרסה הנוכחית של כל עיקרון, בסדר שבו נוספו.",
  declaredTitle: "עקרונות מוצהרים",
  declaredHint: "עקרונות שאישרת בעצמך כשלך.",
  declaredEmpty: "עוד אין עקרונות מוצהרים. אפשר להציע כאלה מתוך הראיון, למטה.",
  validatedTitle: "עקרונות מאומתים",
  validatedHint: "גדר קבועה של המערכת, לא נלמדה ממך.",
  validatedEmpty: "הגדרות הקבועות של המערכת עוד לא נטענו.",
  observedTitle: "עקרונות נצפים",
  observedHint: "תצפית של המערכת שעדיין נבדקת, לא עיקרון שבחרת. כמו טענות DNA, היא נשענת על מקרים עצמאיים ונמדדת ב-Evidence Strength.",
  observedEmpty: "עוד אין עקרונות נצפים.",
  rationaleLabel: "הנימוק שנשמר:",
  declaredOrigin: "אישרת את הניסוח הזה כעיקרון שלך",
  validatedOrigin: "גדר קבועה של המערכת",
  // declared flow
  proposeTitle: "הצעת עקרונות מוצהרים מהראיון",
  proposeHint:
    "ה-AI קורא את תשובות הראיון שלך ומציע ניסוחים של כללים שאמרת במפורש. שום הצעה לא הופכת לחלק מהאסטרטגיה עד שתאשר אותה. אפשר לערוך את הניסוח לפני האישור.",
  proposeButton: "הצע עקרונות מהראיון",
  proposingButton: "קורא את תשובות הראיון...",
  proposeNone: "לא נמצא כלל מפורש בתשובות הראיון שלך. זו תוצאה תקינה.",
  candidatesTitle: "הצעות לאישור",
  candidateLabel: "ניסוח העיקרון",
  candidateHelp: "ה-AI הציע את הניסוח הזה. הוא יישמר כפי שיופיע כאן כשתאשר.",
  candidateRationaleLabel: "הנימוק שה-AI הציע:",
  confirmButton: "אשר כעיקרון שלי",
  confirmingButton: "מאשר...",
  confirmed: "אושר ונוסף לעקרונות המוצהרים.",
  duplicateNote: "עיקרון מוצהר בניסוח זהה כבר קיים, ולכן אין צורך לאשר אותו שוב.",
  // observed generation
  generateTitle: "עדכון עקרונות נצפים",
  generateHint:
    "ה-AI מציע תצפיות מתוך תשובות הראיון שלך ומהטקסטים שכתבת בזמן ההחלטות. כל ציטוט נבדק מול הטקסט שלך, והקוד סופר מקרים עצמאיים וקובע את Evidence Strength. תצפית שנוצרת כאן אינה עיקרון שאימצת.",
  generateButton: "הרץ עדכון",
  generatingButton: "מנתח את ההצהרות שלך...",
  resultCreated: "נוצרו",
  resultVersioned: "עודכנו בגרסה חדשה",
  resultUnchanged: "נשארו ללא שינוי",
  resultDropped: "הצעות נפסלו",
  resultNothingNew: "לא נמצא שום דבר חדש בהרצה הזו.",
};

// principle_created_by — who or what produced a principle version.
export const principleCreatedByLabel: Record<string, string> = {
  user_declared: "אושר על ידך",
  ai_observed: "הוצע על ידי ה-AI מתוך ההצהרות שלך",
  system_default: "גדר קבועה של המערכת",
  system_grounding_revalidation: "בדיקה חוזרת של הציטוטים מול הטקסט שלך",
  system_confidence_recalculation: "חישוב מחדש של Evidence Strength",
  system_independence_recalculation: "חישוב מחדש של המקרים העצמאיים",
};

// --- Ideas notebook (src/components/ideas, Frontend V1 unit 5). An idea is a
// dated note in the investor's own words; the page never ranks, scores or
// enriches it. The notes themselves never pass through here. ---

export const ideasPage = {
  title: "רעיונות",
  description: "הערה קצרה עם תאריך, במילים שלך, על מה שמשך את תשומת לבך בטיקר מסוים. רעיון עוד אינו מחקר ואינו המלצה.",
  // capture
  captureTitle: "רעיון חדש",
  tickerLabel: "טיקר",
  tickerHelp: "כפי שמופיע בבורסה",
  noteLabel: "מה משך את תשומת לבך?",
  noteHelp: "נשמר מילה במילה. כרגע אין באתר עריכה או מחיקה של רעיונות.",
  saveButton: "שמור רעיון",
  savingButton: "שומר...",
  // lists
  unresearchedTitle: "עוד לא נחקרו",
  researchedTitle: "הפכו לתיקי מחקר",
  orderHint: "לפי מועד הכתיבה, החדש ראשון.",
  writtenOnPrefix: "נכתב ב-",
  allResearched: "כל הרעיונות שכתבת כבר הפכו לתיקי מחקר.",
  noneResearched: "עוד לא נפתח תיק מחקר מאף רעיון.",
  // promotion
  promoteButton: "פתח תיק מחקר מהרעיון",
  promotingButton: "פותח...",
  promoteHelp: "ייפתח תיק מחקר לאותו טיקר, המקושר לרעיון הזה. הערת הרעיון תישאר כפי שנכתבה, ותוכל לשמש את המחקר ואת קריאת ה-AI.",
  existingCaseFact: "יש כבר תיק מחקר לטיקר הזה",
  openExistingCase: "פתח אותו",
  // promoted
  becameCasePrefix: "הפך לתיק מחקר ב-",
  becameCase: "נפתח ממנו תיק מחקר",
  openCase: "פתח את התיק",
  // empty
  emptyTitle: "עוד אין רעיונות",
  emptyHint:
    "רעיון הוא הערה קצרה עם תאריך, במילים שלך, על מה שמשך את תשומת לבך. הוא לא ניתוח ולא המלצה. כשתרצה לבדוק אותו ברצינות, תוכל לפתוח ממנו תיק מחקר.",
};

// --- Investment Cases: list (src/app/cases/page.tsx) ---

export const casesListPage = {
  title: "תיקי מחקר",
  description: "חקור טיקר ישירות, או קדם אחד מהרעיונות שלך לתיק מחקר.",
  tickerPlaceholder: "טיקר, למשל AAPL",
  createButton: "תיק חדש",
  creatingButton: "יוצר...",
  tickerLabel: "טיקר",
  tickerHelp: "תיק שנפתח כאן מתחיל בלי הערת רעיון. כדי לשמור את המחשבה הראשונה, פתח רעיון בעמוד הרעיונות וקדם אותו.",
  emptyTitle: "עוד אין תיקי מחקר",
  emptyHint: "תיק מחקר נפתח מרעיון שקידמת, מטיקר שהקלדת כאן, או מתנאי שקילה-מחדש שאישרת. המערכת לא פותחת תיקים מעצמה.",
  listLabel: "תיקי המחקר שלך",
  openedPrefix: "נפתח",
  updatedPrefix: "עודכן",
  stalled: "לא עודכן זמן מה",
  openCase: "פתח את התיק",
  createFailed: "פתיחת התיק נכשלה. שום דבר לא נשמר.",
};

// --- Prior Record Brief V1 (src/components/prior-record-brief.tsx) — the
// investor's own record on a ticker. Facts only: never "you changed your
// mind", never a price move since a past PASS, never a score. ---
export const priorRecord = {
  title: "הרקורד שלך בטיקר הזה",
  frozenTitle: "הרקורד הקודם שלך בטיקר, כפי שהיה ידוע במועד ההחלטה",
  loading: "טוען את הרקורד שלך...",
  liveNote: "עובדות מההיסטוריה שלך בלבד — בלי ניתוח AI ובלי מחירי שוק",
  frozenNote: "הוקפא יחד עם ההחלטה — לא מתעדכן בדיעבד",
  legacyNote: "לא נשמר: ההחלטה נרשמה לפני שהרקורד הקודם נשמר עם ההחלטה.",
  generatedAtPrefix: "נכון ל",
  historyThroughPrefix: "היסטוריית העסקאות עד",
  noHistory: "אין עדיין היסטוריית עסקאות",
  heldPrefix: "מוחזק כעת:",
  notHeld: "לא מוחזק כעת",
  // frozen with a decision: the holding as of that decision, never "now"
  heldAtDecisionPrefix: "הוחזק במועד ההחלטה:",
  notHeldAtDecision: "לא הוחזק במועד ההחלטה",
  positionUnavailable: "מצב הפוזיציה לא זמין (חישוב לא אמין לטיקר הזה)",
  empty: "אין לך עדיין החלטות או עסקאות קודמות בטיקר הזה.",
  decisionsCountSuffix: "החלטות קודמות",
  reviewedSuffix: "עברו Review",
  episodesCountSuffix: "תקופות החזקה",
  openSuffix: "פתוחות",
  rationaleCountSuffix: "נימוקים שתיעדת",
  reentryTitle: "תנאים שקבעת בעבר לשקילה מחדש — עדיין פתוחים",
  decisionsTitle: "החלטות קודמות",
  priceAtDecisionLabel: "מחיר במועד ההחלטה",
  notReviewed: "ללא Review",
  reasoningLabel: "הנימוק שכתבת",
  risksLabel: "סיכונים ששקלת",
  exitConditionsLabel: "תנאי יציאה / שקילה מחדש",
  predictionsLabel: "תחזיות ותנאים",
  laterContextLabel: "הקשר מאוחר שהוספת",
  episodesTitle: "תקופות החזקה קודמות",
  episodeOpen: "פתוחה",
  episodeClosed: "סגורה",
  buysSuffix: "קניות",
  sellsSuffix: "מכירות",
  realizedPrefix: "תוצאה ממומשת במכירות:",
  untrustedSell: "לא ניתן לחשב",
  rationaleLabel: "הנימוק שלך:",
  noRationale: "לא תועד נימוק לתקופה הזו.",
  // Frontend V1 unit 3 — the shared presentation (Case page live, Decision page frozen)
  openPastDecision: "פתח את ההחלטה",
  reviewQualityPrefix: "איכות ההחלטה:",
  thesisAccuracyPrefix: "דיוק התזה:",
  reviewLabelsNote: "תוויות ה-Review הן רישום היסטורי של אותה החלטה, לא תחזית להחלטה הזו.",
};

// --- Investment Case: the research file (src/components/case, Frontend V1
// unit 3). Chrome only: the investor's own words, FMP's strings, the AI's
// texts and computePortfolioFit()'s warnings are shown as they are and never
// pass through here. ---
export const caseDetailPage = {
  // page states
  loadingCase: "טוען את התיק...",
  caseNotFound: "התיק לא נמצא",
  caseNotFoundHint: "ייתכן שהקישור שגוי, או שהתיק שייך לחשבון אחר.",
  // A. header
  openedPrefix: "נפתח",
  updatedPrefix: "עודכן לאחרונה",
  goToRecord: "לרישום ההחלטה",
  openDecision: "פתח את רשומת ההחלטה",
  // B. original thought
  thoughtTitle: "המחשבה המקורית",
  thoughtHint: "המילים שלך כפי שנכתבו. לא נערכות ולא מתורגמות.",
  thoughtFromIdeaPrefix: "הרעיון כפי שכתבת ב-",
  thoughtFromCondition: "התנאי שקבעת בהחלטה קודמת ואישרת שהתקיים",
  originFromDecisionPrefix: "מהחלטת",
  originResolutionNotePrefix: "מה שקרה בפועל, כפי שרשמת:",
  originOpenDecision: "פתח את ההחלטה המקורית",
  thoughtEmptyTitle: "התיק נפתח ישירות, בלי הערת רעיון",
  thoughtEmpty: "הנימוק שתכתוב ברישום ההחלטה יהיה המילים הראשונות שלך על הטיקר הזה.",
  thoughtIdeaMissing: "התיק נפתח מרעיון, אבל הרעיון לא נמצא ברשימת הרעיונות שלך.",
  // C. market picture
  marketTitle: "תמונת שוק",
  marketProvenancePrefix: "Financial Modeling Prep · נשלף",
  marketCacheNote: "רענון עשוי להחזיר נתון שנשלף בדקות האחרונות; מועד השליפה שמוצג הוא המועד של הנתון עצמו.",
  marketEmptyTitle: "עוד לא נשלפו נתוני שוק לטיקר הזה",
  marketEmpty: "Portfolio Fit, Personal Fit וקריאת ה-AI נשענים על המחיר והסיווג שנשלפים כאן.",
  fetchButton: "שלוף נתוני שוק",
  refreshButton: "רענן נתוני שוק",
  fetchingButton: "שולף...",
  priceLabel: "מחיר",
  dayChangeLabel: "שינוי יומי",
  marketCapLabel: "שווי שוק",
  betaLabel: "בטא",
  weekRangeLabel: "טווח 52 שבועות",
  sectorLabel: "סקטור",
  industryLabel: "ענף",
  unknownSector: "sector לא ידוע",
  unknownIndustry: "industry לא ידוע",
  naLabel: "לא זמין",
  valuationLabel: "יחסי שווי",
  valuationRatiosUnavailable: "יחסי שווי לא זמינים בתוכנית הנתונים הנוכחית לטיקר הזה.",
  descriptionLabel: "תיאור החברה, כפי שנשלף",
  // G. AI case reading
  readingTitle: "קריאת ה-AI של התיק",
  readingProvenance:
    "ניתוח AI אחד על בסיס תמונת השוק, Portfolio Fit והערת הרעיון בלבד. הוא לא ראה את ה-DNA, ה-Strategy או הרקורד שלך. לא המלצה.",
  readingEmptyTitle: "עוד לא נוצרה קריאה לתיק הזה",
  readingEmpty: "הקריאה מסכמת מה הנתונים שנשלפו תומכים בו, מה סותר אותם ומה הם לא יכולים לומר.",
  readingNeedsMarket: "צריך קודם נתוני שוק.",
  generateReading: "צור קריאה",
  regenerateReading: "צור קריאה מחדש",
  generatingReading: "יוצר קריאה...",
  regenerateWarning: "יצירה מחדש מחליפה את הקריאה השמורה. גרסאות קודמות לא נשמרות.",
  summaryLabel: "סיכום",
  bullCase: "מה תומך (Bull)",
  catalysts: "קטליזטורים אפשריים",
  bearCase: "מה נגד (Bear)",
  devilsAdvocate: "עורך דין לשטן",
  invalidationConditions: "מה יפריך את התזה",
  marketBlindspot: "מה הנתונים האלה לא יכולים לומר",
  portfolioFitNarrative: "Portfolio Fit במילים",
  // D. Portfolio Fit
  portfolioFitTitle: "Portfolio Fit",
  portfolioFitProvenance: "מחושב בקוד מהעסקאות שיובאו ומהמחירים שנשלפו. לא נשמר, ולא המלצה.",
  notComputedThisVisit: "לא חושב בביקור הזה",
  notComputedHint: "Portfolio Fit מחושב רק כשאתה מבקש, ואינו נשמר בין ביקורים.",
  computedThisVisit: "חושב בביקור הזה · לא נשמר",
  hypotheticalSizeLabel: "גודל היפותטי ב-$",
  hypotheticalSizeHelp: "אופציונלי. אותו סכום משמש גם בטופס הרישום ובקריאת ה-AI.",
  computeFitButton: "חשב Portfolio Fit",
  recomputeFitButton: "חשב שוב",
  computingButton: "מחשב...",
  fitNeedsMarket: "צריך קודם נתוני שוק: החישוב דורש מחיר עדכני.",
  totalPortfolioValueLabel: "שווי תיק כולל",
  approximateNote: "משוער: חלק מההחזקות תומחרו לפי עלות, לא לפי מחיר עדכני",
  existingHoldingLabel: "החזקה קיימת",
  sharesLabel: "מניות",
  existingWeightLabel: "משקל קיים",
  cashLabel: "מזומן",
  holdingsCountLabel: "החזקות נוכחיות",
  largestLabel: "ההחזקה הגדולה",
  projectedTitlePrefix: "אם יתווספו",
  projectedWeightLabel: "משקל צפוי",
  projectedValueLabel: "שווי צפוי",
  projectedCashLabel: "מזומן צפוי",
  ofPortfolioSuffix: "מהתיק",
  sectorExposureTitle: "חשיפה לפי סקטור",
  industryExposureTitle: "חשיפה לפי ענף",
  currentColumn: "נוכחי",
  projectedColumn: "צפוי",
  unclassifiedLabel: "לא מסווג",
  warningsTitle: "הערות החישוב",
  decidedFitNote: "Portfolio Fit של היום אינו חלק מהתיק שהוחלט. מצב התיק בזמן ההחלטה קפוא ברשומת ההחלטה.",
  // E. Personal Fit
  personalFitTitle: "Personal Fit",
  personalFitProvenance:
    "ניתוח AI מול השערות DNA ועקרונות Strategy שיש להם ראיות. פריטים עם Insufficient Evidence לא נכללים. לא המלצה.",
  personalFitEmptyTitle: "עוד לא נוצר Personal Fit לתיק הזה",
  personalFitEmpty: "הניתוח משווה את הרעיון להשערות ה-DNA ולעקרונות ה-Strategy שלך, רק לאלה שיש להם ראיות.",
  personalFitNeedsMarket: "צריך קודם נתוני שוק: הניתוח נשען על ה-sector וה-industry של הטיקר.",
  generatePersonalFit: "צור Personal Fit",
  regeneratePersonalFit: "צור מחדש",
  generatingPersonalFit: "מעריך...",
  personalFitRegenerateWarning: "יצירה מחדש מחליפה את הניתוח השמור. גרסאות קודמות לא נשמרות.",
  untraceable: "הניתוח אינו מצביע על אף השערה או עיקרון בעלי ראיות, ולכן אינו ראיה על ההתאמה.",
  citedTitle: "הפריטים שהניתוח מצביע עליהם",
  citedTierNote: "Evidence Strength כפי שהוא כעת בפרופיל שלך.",
  // H. before recording
  readinessTitle: "לפני הרישום",
  readinessHint: "הרשימה משקפת רק דרישות קיימות של המערכת ואת מה שכבר נעשה בתיק. אין בה ציון ואין המלצה.",
  rulesTitle: "תנאים לרישום",
  inventoryTitle: "מה עוד לא נעשה בתיק",
  ruleMet: "מתקיים",
  ruleUnmet: "חסר",
  ruleUnknown: "בבדיקה",
  rule: {
    researching: "התיק עדיין בתהליך מחקר",
    strategy: "קיימת גרסת Strategy מאושרת",
    reasoning: "הנימוק כתוב",
    horizon: "נבחר מועד Review, או 'ללא תאריך' במפורש",
  } as Record<string, string>,
  ruleStrategyMissingHint: "כל רשומת החלטה מקפיאה את גרסת ה-Strategy שבתוקף.",
  openStrategy: "לעמוד ה-Strategy",
  freshAtRecord: "מחיר, מצב התיק והקשר השוק נשלפים מחדש ברגע הרישום, ולכן אי אפשר לאמת אותם מראש.",
  inventory: {
    market: "נתוני שוק",
    portfolioFit: "Portfolio Fit בביקור הזה",
    personalFit: "Personal Fit",
    reading: "קריאת ה-AI של התיק",
  } as Record<string, string>,
  inventoryDone: "נעשה",
  inventoryNotDone: "לא נעשה",
  inventoryAllDone: "כל שלבי המחקר הקיימים בוצעו בתיק הזה.",
  // I. decision recording
  recordTitle: "רישום ההחלטה",
  freezeDescription:
    "הרישום מקפיא לצמיתות את המחיר, מצב התיק, הקשר השוק וגרסאות ה-Strategy וה-DNA שבתוקף, יחד עם הטקסטים שתכתוב כאן ועותק של התיק. שום דבר ממה שנרשם לא ניתן לעריכה.",
  decisionTypeLabel: "סוג ההחלטה",
  sizeLabel: "גודל ב-$",
  sizeHelp: "אופציונלי.",
  reasoningLabel: "הנימוק והתזה שלך",
  reasoningPlaceholder: "למה ההחלטה הזו, ומה אתה מאמין שיקרה?",
  reasoningHint: "נשמר מילה במילה ואינו ניתן לעריכה. אלו המילים שהמערכת תוכל לצטט בעתיד כראיה לאופן החשיבה שלך.",
  risksLabel: "סיכונים ששקלת",
  exitConditionsLabel: "תנאי יציאה: מה היה משנה את דעתך?",
  optionalHelp: "אופציונלי. נשמר מילה במילה.",
  reviewHorizonLabel: "מועד Review להחלטה הזו",
  reviewHorizonDateOption: "לקבוע תאריך Review",
  reviewHorizonDateAria: "תאריך Review",
  reviewHorizonNoneOption: "ללא תאריך Review (בחירה מפורשת)",
  reviewHorizonRequired: "בחר תאריך Review או 'ללא תאריך' לפני הרישום.",
  recordPrefix: "רשום",
  recordSuffix: "לצמיתות",
  recordingPending: "מקפיא: שולף מחיר עדכני, מצב תיק והקשר שוק, ומחלץ תחזיות מהנימוק שלך...",
  recordFailed: "הרישום נכשל. שום דבר לא נרשם.",
  notResearching: "התיק אינו בתהליך מחקר, ולכן אי אפשר לרשום לו החלטה.",
  decidedPrefix: "החלטה נרשמה לתיק הזה ב-",
  decidedFrozenNote: "העותק הקפוא של התיק נמצא ברשומת ההחלטה. התיק כאן אינו מתעדכן עוד, ופעולות הרענון והיצירה מוסתרות.",
};
