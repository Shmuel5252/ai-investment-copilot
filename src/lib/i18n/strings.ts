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

// --- Dashboard (src/app/page.tsx) ---
// Nav link labels are deliberately NOT duplicated here — each links to a
// page that already owns its own title string (dnaPage.title,
// strategyPage.title, etc.); the Dashboard reuses those directly. Only
// "Learning Insights" stays a literal English label below, since that
// page itself is still English (deferred with Decision Review).

export const dashboardPage = {
  signedInAs: "מחובר בתור",
  loading: "טוען...",
  description:
    "עוזר השקעות אישי מבוסס AI שלומד איך אתה חושב כמשקיע — לא ממליץ מה לקנות. זיכרון מובנה של תהליך ההחלטות שלך, עם ראיות ומעקב אחורה לכל מסקנה.",
  signOut: "התנתקות",
};

// --- Decisions: list (src/app/decisions/page.tsx) ---

export const decisionsListPage = {
  title: "החלטות",
  description: "כל החלטה שנרשמה — בלתי ניתנת לשינוי מהרגע שנוצרה. רשום החלטה חדשה מתוך תיק מחקר.",
  noDecisionsYet: "עדיין לא נרשמו החלטות.",
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
  type: "סוג (קנייה/מכירה/דיבידנד/...)",
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
  currentPositions: "פוזיציות נוכחיות:",
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
  noCasesYet: "אין עדיין תיקים.",
};

// --- Investment Cases: detail (src/app/cases/[id]/page.tsx) ---

export const caseDetailPage = {
  marketIntelligenceTitle: "מודיעין שוק — Financial Modeling Prep",
  fetchButton: "שלוף נתוני שוק",
  refreshButton: "רענן נתוני שוק",
  fetchingButton: "שולף...",
  todayLabel: "היום",
  unknownSector: "sector לא ידוע",
  unknownIndustry: "industry לא ידוע",
  marketCapLabel: "שווי שוק",
  betaLabel: "בטא",
  weekRangeLabel: "טווח 52 שבועות",
  naLabel: "לא זמין",
  valuationRatiosUnavailable: "יחסי שווי לא זמינים בתוכנית הנתונים הנוכחית לטיקר הזה.",
  divYieldLabel: "תשואת דיבידנד",
  fetchedAtLabel: "נשלף",
  portfolioFitTitle: "Portfolio Fit — מחושב בזמן אמת, לא נשמר",
  hypotheticalSizePlaceholder: "גודל היפותטי ב-$ (אופציונלי)",
  computeFitButton: "חשב Portfolio Fit",
  computingButton: "מחשב...",
  fetchMarketDataFirst: "שלוף קודם נתוני שוק.",
  totalPortfolioValueLabel: "שווי תיק כולל",
  approximateNote: "(משוער)",
  existingExposureLabel: "חשיפה קיימת",
  sharesOfLabel: "מניות ·",
  ofPortfolioLabel: "מהתיק",
  projectedLabel: "צפוי",
  currentHoldingsLabel: "החזקות נוכחיות",
  largestLabel: "הגדולה ביותר",
  cashLabel: "מזומן",
  sectorExposureTitle: "חשיפה לפי סקטור",
  industryExposureTitle: "חשיפה לפי ענף",
  currentLabel: "נוכחי",
  // Distinct on purpose from unknownSector/unknownIndustry above — those
  // describe the candidate ticker under research itself; this describes
  // a real *held* position with no sector/industry data on file (the
  // computePortfolioFit() null bucket, docs/backlog.md — Sector +
  // Industry Exposure). Different concepts, so a different term, not a
  // reuse of "לא ידוע".
  unclassifiedLabel: "לא מסווג",
  personalFitTitle: "Personal Fit — לעומת ה-DNA וה-Strategy שלך",
  generatePersonalFitButton: "צור Personal Fit",
  assessingButton: "מעריך...",
  researchCompletenessTitle: "שלמות המחקר",
  marketIntelligenceRow: "מודיעין שוק",
  notFetchedRequired: "לא נשלף — נדרש לפני סינתזה",
  fetchedLabel: "נשלף",
  personalFitRow: "Personal Fit (DNA + Strategy)",
  generatedLabel: "נוצר",
  notGeneratedWontReflect: "לא נוצר — הסינתזה לא תשקף אותו",
  dnaOnFileRow: "השערות DNA בתיק",
  informsPersonalFitNotSynthesis: "משפיע על Personal Fit, לא ישירות על הסינתזה",
  strategyOnFileRow: "עקרונות Strategy בתיק",
  caseSynthesisTitle: "סינתזת התיק",
  generateSynthesisButton: "צור סינתזה",
  synthesizingButton: "מסנתז...",
  bullCase: "תזת עלייה (Bull)",
  bearCase: "תזת ירידה (Bear)",
  catalysts: "קטליזטורים",
  invalidationConditions: "תנאי הפרכה",
  portfolioFitNarrative: "Portfolio Fit (נרטיב)",
  marketBlindspot: "נקודה עיוורת בשוק",
  devilsAdvocate: "עורך דין לשטן",
  recordDecisionTitle: "רשום החלטה",
  decisionAlreadyRecordedPrefix: "החלטה כבר נרשמה לתיק הזה —",
  viewDecisionSnapshot: "צפה ברשומת ההחלטה",
  freezeDescription:
    "מקפיא מחיר, מצב תיק, הקשר שוק, וגרסאות האסטרטגיה/DNA בתוקף כרגע, יחד עם הנימוק שלך — לצמיתות. שום דבר כאן לא ניתן לעריכה אחר כך, רק להוספה כהקשר מאוחר.",
  sizePlaceholder: "גודל ב-$ (אופציונלי)",
  reasoningPlaceholder: "הנימוק והתזה שלך — למה ההחלטה הזו, מה אתה מאמין שיקרה?",
  risksPlaceholder: "סיכונים ששקלת (אופציונלי)",
  exitConditionsPlaceholder: "תנאי יציאה — מה היה משנה את דעתך? (אופציונלי)",
  recordPrefix: "רשום",
  recordSuffix: "— לצמיתות",
  recordingButton: "רושם...",
};
