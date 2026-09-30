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

// principleTypeEnum
export const principleTypeLabel: Record<string, string> = {
  declared: "מוצהר",
  observed: "נצפה",
  validated: "מאומת",
};

export const principleTypeHint: Record<string, string> = {
  declared: "אמרת את זה בעצמך בראיון.",
  observed: "דפוס שהמערכת שמה לב אליו — עדיין נבדק.",
  validated: "גדר סיכון בסיסית קבועה, לא נלמדה ממך.",
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
  openInterview: "לראיון הפתיחה",
  memoryFootnote: "טענה משמשת את המערכת בניתוחים רק כשיש לה מספיק מקרים עצמאיים. עד אז היא מוצגת לך, אבל שום ניתוח לא נשען עליה.",
};

// --- Decisions: list (src/app/decisions/page.tsx) ---

export const decisionsListPage = {
  title: "החלטות",
  description: "כל החלטה שנרשמה — בלתי ניתנת לשינוי מהרגע שנוצרה. רשום החלטה חדשה מתוך תיק מחקר.",
  noDecisionsYet: "עדיין לא נרשמו החלטות.",
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

// --- Evidence Reach V1 (src/components/evidence-reach.tsx) — per-claim
// transparency. "The AI does not currently use this" is a threshold fact,
// never a verdict that the claim is false; the distance line is shown only
// when the threshold table makes it exactly true, and it counts INDEPENDENT
// cases — another answer about an episode already counted adds nothing. ---

export const evidenceReach = {
  sourcesPrefix: "מקורות:",
  interviewAnswers: "תשובות ראיון",
  decisionStatements: "הצהרות מזמן החלטה",
  usedByAi: "ה-AI משתמש בזה כרגע בניתוחים.",
  notUsedByAi: "ה-AI לא משתמש בזה כרגע — לא כי זה שגוי, אלא כי הראיות מתחת לסף.",
  distancePrefix: "נדרשים עוד",
  distanceMiddle: "מקרים עצמאיים תומכים כדי לעבור לרמה",
  distanceNote: "ראיה נוספת על אותו אירוע/אותה החלטה אינה מקרה נוסף.",
  unresolvedSuffix: "החלטות מצוטטות עם עסקאות מועמדות שלא סווגו — לא נספרות לאף צד עד לסיווג.",
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
  noOtherHoldings: "לא היו החזקות נוספות במועד זה.",
  marketContextTitle: "הקשר שוק במועד ההחלטה",
  onThatDay: "באותו יום",
  dnaHypothesesTitle: "השערות DNA בתוקף במועד ההחלטה",
  // Open-Decision Monitoring V1 — the review horizon line.
  reviewByLabel: "Review עד",
  noReviewDate: "לא נקבע תאריך Review",
  setReviewDateButton: "קבע תאריך Review (פעם אחת)",
  settingReviewDateButton: "קובע...",
  reviewDateSetOnceNote: "ניתן לקבוע פעם אחת בלבד; לא ניתן לשנות אחר כך.",
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
    "העלה היסטוריית מסחר חלקית (למשל 6–12 החודשים האחרונים). אם פוזיציה נפתחה לפני החלון שאתה מעלה, תתבקש להזין את יתרת הפתיחה שלה בנפרד — לעולם לא מניחים שהקובץ הוא כל התיק שלך.",
  fileModeTab: "ייבוא מקובץ",
  manualModeTab: "הזנה ידנית",
  rowsDetectedLabel: "שורות זוהו. מפה את העמודות שלך למטה (ניחוש ראשוני כבר מולא):",
  validatingLabel: "מאמת...",
  notMappedOption: "— לא ממופה —",
  previewFirstRows: "תצוגה מקדימה של השורות הראשונות",
  validateButton: "אמת",
  validRowsLabel: "שורות תקינות,",
  invalidRowsLabel: "שורות לא תקינות.",
  fixRowsInstruction: "תקן את השורות האלה בקובץ ה-CSV והעלה מחדש:",
  rowLabel: "שורה",
  openingStateInstruction:
    "לטיקרים האלה יש מכירה (SELL) שלא מוסברת על ידי הקובץ הזה בלבד — כנראה פוזיציה שנפתחה לפני החלון המיובא. הזן מה החזקת ממש לפני תאריך ההתחלה של הקובץ (מדווח עצמית, מסומן ככזה — לא נגזר מהיסטוריית עסקאות):",
  quantityPlaceholder: "כמות",
  costBasisPlaceholder: "עלות בסיס למניה",
  confirmImportButton: "אשר ייבוא",
  importingButton: "מייבא...",
  importedLabel: "עסקאות יובאו.",
  skippedExactLabel: "שורות דולגו כי כבר היו בהיסטוריה (כפילות מדויקת).",
  skippedSameLabel: "שורות דולגו כי אישרת שהן אותן עסקאות שהוזנו ידנית.",
  currentPositions: "פוזיציות נוכחיות:",
};

// --- History freshness (History Refresh V1) — /import and the Dashboard
// import card. Facts about how far the persisted history reaches; never a
// broker-sync claim and never a statement that the portfolio is current
// beyond the latest transaction date. ---
export const historyFreshness = {
  title: "מצב ההיסטוריה",
  upToDatePrefix: "היסטוריית העסקאות מעודכנת עד",
  agePrefix: "עודכנה לפני",
  ageSuffixDays: "ימים",
  ageToday: "עודכנה היום",
  transactionsSuffix: "עסקאות בסך הכול",
  latestBatchPrefix: "הייבוא האחרון:",
  latestBatchWindow: "מכסה",
  latestBatchTo: "עד",
  latestBatchRows: "שורות נוספו",
  manualPrefix: "הזנה ידנית:",
  manualSuffix: "עסקאות, האחרונה ב-",
  noHistory: "עדיין אין היסטוריית עסקאות — ייבא קובץ או הזן עסקאות ידנית.",
  disclaimer: "המערכת יודעת רק מה שיובא או הוזן; היא לא מסונכרנת עם הברוקר.",
};

// --- Stock splits (Import Blockers V1) — src/app/import/page.tsx. One
// kind only; the investor records a fact from a named source and confirms
// it explicitly; the original BUY/SELL rows are never touched. ---
export const corporateActionsPage = {
  title: "פיצולי מניה",
  description:
    "פיצול (או פיצול הפוך) שבוצע בנייר שאתה מחזיק. הרישום הוא עובדה בלתי ניתנת לשינוי עם מקור מזוהה; העסקאות המקוריות לא נערכות — חישוב הפוזיציות מיישם את היחס מתאריך התחילה.",
  none: "לא נרשמו פיצולים.",
  tickerLabel: "טיקר",
  effectiveDateLabel: "תאריך תחילה",
  effectiveDateHint: "היום הראשון שבו הכמויות מבוטאות ביחידות שאחרי הפיצול",
  ratioLabel: "יחס",
  ratioHint: "לדוגמה 4 : 1 = ארבע מניות חדשות על כל מניה; פיצול הפוך = 1 : 10",
  sourceLabel: "מקור העובדה",
  sourceIssuer: "הודעת החברה / דיווח רגולטורי",
  sourceBroker: "דוח ברוקר",
  sourceUser: "הצהרה שלי",
  evidenceLabel: "ראיה (ציטוט המקור)",
  evidencePlaceholder: "לדוגמה: הודעת החברה על פיצול 4:1, מסחר מותאם מ-…; דוח ברוקר: שורת ההחזקה לפני התאריך ושורת המכירה אחריו",
  confirmLabel: "אני מאשר שהיחס והתאריך נלקחו מהמקור שצוין ולא הוסקו מכמויות בלבד",
  recordButton: "רשום פיצול",
  recordingButton: "רושם...",
  recordedLabel: "נרשם.",
  listHeading: "פיצולים רשומים",
  recordedOnLabel: "נרשם ב",
};

// --- Transaction reconciliation (History Refresh V1) — shared by CSV
// review and manual entry in src/app/import/page.tsx. ---
export const reconciliation = {
  heading: "התאמה מול ההיסטוריה הקיימת",
  explanation:
    "לפני ההוספה כל שורה מושווית לעסקאות שכבר במערכת. כפילות מדויקת מדולגת אוטומטית; שורה שאולי תואמת עסקה שהזנת ידנית דורשת את ההכרעה שלך — המערכת לא מנחשת.",
  newCount: "חדשות",
  exactCount: "כפילויות מדויקות (ידולגו)",
  probableCount: "התאמות אפשריות לעסקה ידנית",
  ambiguousCount: "לא חד-משמעיות",
  willInsertPrefix: "ייכנסו להיסטוריה:",
  willInsertSuffix: "שורות",
  unresolvedNote: "יש שורות שדורשות הכרעה לפני האישור.",
  rowPrefix: "שורה",
  probableRowNote: "אולי אותה עסקה שהוזנה ידנית:",
  ambiguousRowNote: "יותר מעסקה קיימת אחת יכולה להתאים — בחר איזו, או סמן כעסקה נפרדת:",
  exactRowNote: "זהה לעסקה שכבר קיימת במערכת.",
  exactWithinBatchNote: "זהה לשורה קודמת בטופס הזה.",
  sameChoice: "זו אותה עסקה — השאר את הידנית ודלג על שורה זו",
  separateChoice: "זו עסקה נפרדת — הוסף גם אותה",
  manualSameChoice: "זו אותה עסקה — אל תשמור שוב",
  manualSeparateChoice: "זו עסקה זהה נפרדת בכוונה — שמור בכל זאת",
  candidateLabel: "עסקה קיימת:",
  manualSource: "הוזנה ידנית",
  csvSource: "מקובץ",
  chooseCandidate: "— בחר עסקה קיימת —",
};

// --- Same-day ordering collision resolution (Investment Episode
// Independence design) — shared between file-mode (import.validate's
// collisionGroups) and manual mode (import.checkManualEntryCollisions) in
// src/app/import/page.tsx, one set of strings for both since it's the
// same UI concept in both places. ---
export const collisionResolution = {
  heading: "יותר מעסקה אחת באותו טיקר באותו תאריך",
  explanation:
    "לשורות האלה אין למערכת דרך לדעת איזו התרחשה קודם. אפשר להזין מספר סדר (1, 2, ...) לכל שורה חדשה אם ידוע — כל השורות בקבוצה צריכות מספר שונה. אם לא כולן יקבלו מספר, כל הקבוצה תישמר כ\"סדר לא ידוע\", וזה תקין לגמרי.",
  existingRowLabel: "עסקה קיימת כבר במערכת:",
  orderPlaceholder: "סדר",
};

// --- Manual Historical Entry (src/app/import/page.tsx, manual mode) —
// Actual trades only, never hypothetical/what-if scenarios
// (docs/backlog.md). ---

export const manualEntryPage = {
  description:
    "הזן עסקאות היסטוריות אמיתיות שביצעת בפועל — לא תרחישים היפותטיים. כל שורה נשמרת בדיוק כמו עסקה שיובאה מקובץ, ומשפיעה על חישובי התיק באותו אופן.",
  tickerLabel: "טיקר",
  typeLabel: "סוג",
  quantityLabel: "כמות",
  priceLabel: "מחיר למניה",
  dateLabel: "תאריך",
  notesLabel: "הערה כללית (אופציונלי)",
  notesPlaceholder:
    "הערה כללית על הרשומה — לא כאן מספרים את הסיפור/הרציונל של ההשקעה. לכך משמש \"ספר לי למה\" אחרי השמירה.",
  buyOption: "קנייה",
  sellOption: "מכירה",
  addRowButton: "הוסף שורה",
  removeRowButton: "הסר שורה",
  submitButton: "שמור עסקאות",
  savingButton: "שומר...",
  provenanceBadge: "הוזן ידנית",
  provenanceExplanation: "הנתונים הוזנו ידנית ולא יובאו מקובץ מסחר.",
  savedCountLabel: "עסקאות נשמרו.",
  skippedCountLabel: "שורות לא נשמרו כי אישרת שהן אותן עסקאות שכבר במערכת.",
  enterMoreButton: "הזן עוד עסקאות",
};

// --- "Tell me why" — user-initiated historical rationale
// (docs/backlog.md). Deterministic, not AI-generated — {ticker} is
// interpolated in code (src/lib/interview/tell-me-why-question.ts), not
// by a model call. ---

export const tellMeWhy = {
  buttonLabel: "אני רוצה לספר למה ביצעתי את העסקה הזו",
  questionTemplate:
    "ספר לי על ההשקעה שלך ב-{ticker} — למה נכנסת, איך התנהלת במהלך הפוזיציה, ולמה החלטת לממש חלק ממנה או לצאת ממנה?",
  answerPlaceholder:
    "התשובה שלך — הסיפור המלא, כולל אם רלוונטי: למה נכנסת, מה קרה במהלך ההחזקה, ולמה יצאת (בבת אחת או בכמה שלבים)...",
  saveButton: "שמור",
  savingButton: "שומר...",
  savedConfirmation: "נשמר — התשובה תילקח בחשבון בפעם הבאה שתיצור השערות DNA.",
  // Episode Journal V1 — the same deterministic builder, with episode
  // context. Only ENTRY-time facts may appear in these templates
  // (hindsight protection): never P&L, exit, or later prices.
  questionTemplateOpen:
    "ספר לי על ההשקעה שלך ב-{ticker} — למה נכנסת, ואיך אתה מנהל את הפוזיציה מאז?",
  contextTemplate: "פוזיציה {episode} — כניסה ב-{date} {amount}.",
  entryAmountTemplate: "(קנייה של {quantity} מניות במחיר ${price})",
  updateButton: "עדכן את הרציונל",
  updateHint: "עדכון יוצר תשובה חדשה שמחליפה את הקודמת בספירה; התשובה המקורית נשארת בהיסטוריה כמות שהיא.",
  cancelButton: "ביטול",
};

// --- Episode Journal (src/app/journal/page.tsx) ---

export const journalPage = {
  title: "יומן פוזיציות",
  description:
    "כל פוזיציה שפתחת (וסגרת) בהיסטוריה שלך — כדי לתעד, בקצב שלך, למה החלטת מה שהחלטת. הרציונל נשמר במילים שלך בלבד ומזין את השערות ה-DNA ואת האסטרטגיה בפעם הבאה שתיצור אותן; המערכת לא מריצה את זה לבד.",
  loading: "טוען...",
  empty: "עדיין אין פוזיציות ביומן — ייבא היסטוריית מסחר קודם.",
  coveragePrefix: "תועדו",
  coverageMiddle: "מתוך",
  coverageSuffix: "פוזיציות",
  unansweredHeading: "ממתינות לרציונל",
  answeredHeading: "מתועדות",
  allDocumented: "כל הפוזיציות מתועדות.",
  statusOpen: "פתוחה",
  statusClosed: "סגורה",
  episodeLabel: "פוזיציה",
  entryLabel: "כניסה",
  firstTransactionLabel: "עסקה ראשונה בחלון",
  sharesAtLabel: "מניות במחיר",
  buysLabel: "קניות",
  sellsLabel: "מכירות",
  notAnchorable:
    "לא ניתן לתעד רציונל לפוזיציה הזו: אין קנייה בהיסטוריה שלה (כנראה נפתחה לפני חלון הייבוא).",
  hindsightNote:
    "לפני הכתיבה מוצגות רק עובדות מזמן הכניסה. מה שקרה אחר כך יוצג רק אחרי שהרציונל יישמר — כדי לא לצבוע את הזיכרון.",
  rationaleLabel: "הרציונל שלך",
  writtenOnLabel: "נכתב ב",
  showRationale: "הצג רציונל",
  hideRationale: "הסתר רציונל",
  laterFactsHeading: "מה קרה אחר כך — עובדות מאוחרות, לא חלק מהרציונל",
  exitLabel: "יציאה",
  holdingDaysLabel: "ימי החזקה",
  sellLabel: "מכירה",
  realizedLabel: "תשואה ממומשת",
  insufficientHoldingsNote: "מכירה שעלתה על ההחזקה הידועה — ייתכן ש-Opening State חסר; המספר לא אמין",
  stillOpenNote: "הפוזיציה עדיין פתוחה — אין עדיין תוצאה ממומשת.",
  noSellTrace: "לא נרשמו מכירות עם תוצאה ממומשת לפוזיציה הזו.",
};

// --- Onboarding Interview (src/app/interview/page.tsx) ---

export const interviewPage = {
  title: "ראיון פתיחה",
  description:
    "כמה שאלות על עסקאות ספציפיות מההיסטוריה שלך — תשובות חופשיות, דלג על כל מה שאתה לא רוצה להיכנס אליו. ככה המערכת מתחילה ללמוד איך אתה באמת חושב, לא רק מה סחרת.",
  startButton: "התחל ראיון",
  preparingQuestions: "מכין שאלות...",
  questionLabel: "שאלה",
  ofLabel: "מתוך",
  whyAskedThis: "למה אתה נשאל את זה",
  answerPlaceholder: "התשובה שלך...",
  nextButton: "הבא",
  finishButton: "סיום",
  skipButton: "דלג",
  completePrefix: "הראיון הושלם — נענו",
  completeMiddle: "מתוך",
  completeSuffix: "שאלות. התשובות האלה יזינו את השערות ה-DNA שלך בשלב הבא.",
};

// --- Investor DNA (src/app/dna/page.tsx) ---

export const dnaPage = {
  title: "DNA משקיע",
  description:
    "השערות על איך אתה חושב ומתנהג כמשקיע — מוצעות על ידי AI מתוך ראיון הפתיחה שלך, אבל תמיד מגובות רק בראיות שאפשר לבדוק. שום דבר כאן לא מוצג כמוכח; דפוסים חלשים או דלים מסומנים ככאלה.",
  generateButton: "צור השערות מהראיון",
  analyzingButton: "מנתח תשובות ראיון...",
  createdLabel: "השערות נוצרו",
  droppedPrefix: "(",
  droppedSuffix: "הוצעו אך נפסלו בשל ראיות לא תקפות)",
  supportingLabel: "תומכות",
  contradictingLabel: "סותרות",
  viewEvidence: "הצג ראיות",
  hideEvidence: "הסתר ראיות",
  disagree: "לא מסכים",
  noHypothesesYet: "אין עדיין השערות — השלם את ראיון הפתיחה, ואז צור כמה.",
};

// --- Baseline Strategy (src/app/strategy/page.tsx) ---

export const strategyPage = {
  title: "אסטרטגיית בסיס",
  description:
    "שלושה סוגי עקרונות, שנשארים נפרדים באופן ברור: מה שאמרת לנו ישירות (מוצהר), דפוסים שהמערכת עדיין בודקת (נצפה), וגדרות סיכון בסיסיות קבועות (מאומת). שום דבר כאן לא מוצג כוודאי יותר מהמקור שלו.",
  currentVersionLabel: "גרסת אסטרטגיה נוכחית: v",
  declaredTitle: "עקרונות מוצהרים",
  findDeclaredButton: "מצא כללים מוצהרים מהראיון",
  readingAnswersButton: "קורא תשובות ראיון...",
  noExplicitRule: "לא נמצא כלל מפורש בתשובות הראיון שלך עדיין — זו תוצאה נורמלית, לא שגיאה.",
  confirmedLabel: "אושר.",
  confirmButton: "אשר — כן, זה הכלל שלי",
  observedTitle: "עקרונות נצפים",
  generateObservedButton: "צור עקרונות נצפים",
  analyzingButton: "מנתח תשובות ראיון...",
  createdLabel: "עקרונות נוצרו",
  droppedPrefix: "(",
  droppedSuffix: "הוצעו אך נפסלו בשל ראיות לא תקפות)",
  noneYet: "אין עדיין.",
  supportingLabel: "תומכות",
  contradictingLabel: "סותרות",
  viewEvidence: "הצג ראיות",
  hideEvidence: "הסתר ראיות",
  noEvidenceRecorded: "לא נרשמו ראיות.",
  approveTitle: "אשר אסטרטגיית בסיס",
  approveDescription:
    "מאגד כל עיקרון למעלה (כפי שהוא עכשיו) לגרסת אסטרטגיה חדשה וממוספרת — שום דבר כאן לא נכתב מחדש בשקט אחר כך, רק מוחלף בגרסה מאושרת חדשה.",
  changeSummaryPlaceholder: "לדוגמה: אסטרטגיית בסיס ראשונית",
  approveButton: "אשר כגרסת אסטרטגיה חדשה",
  approvingButton: "מאשר...",
  approvedAsLabel: "אושר כ-v",
};

// --- Ideas (src/app/ideas/page.tsx) ---

export const ideasPage = {
  title: "רעיונות",
  description: "הערה קצרה על טיקר שאתה סקרן לגביו — קדם אותו לתיק מחקר מלא כשתרצה לחקור אותו ברצינות.",
  tickerPlaceholder: "טיקר, למשל AAPL",
  notePlaceholder: "מה גרם לך לחשוב על זה?",
  addButton: "הוסף רעיון",
  savingButton: "שומר...",
  viewCase: "צפה בתיק המחקר",
  promoteButton: "קדם לתיק מחקר",
  noIdeasYet: "אין עדיין רעיונות.",
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
  actionFailed: "הפעולה נכשלה. שום דבר לא נשמר.",
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
