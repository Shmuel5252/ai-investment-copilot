# Backlog — Gaps Found, Deferred On Purpose

רשימה מצטברת של פערים אמיתיים שנתקלנו בהם תוך כדי המעבר בלולאה
המלאה (לא באגים — התנהגות חסרה או לא-אינטואיטיבית שהתגלתה, ותוקנה
במודע *לא* להיבנות מיד). המטרה: לצבור כמה פערים לפני שמחליטים ביחד
מה שווה לבנות, במקום אחד-אחד. כשמשהו מכאן נבנה בפועל — מעביר את
השורה לקטגוריית "נבנה" (או מוחק) ומצטט את המשימה/commit הרלוונטי,
לא משאיר את זה תלוי.

---

## עדיפות גבוהה

(ריק כרגע — הפריט היחיד שהיה כאן נבנה, ר' "נבנה" למטה.)

---

## פתוח

### Decision Review — Later Context factual precedence אינו אכוף מבנית, רק prompt instruction
**נמצא:** 2026-09-06, תוך כדי בדיקת ה-Review האמיתי של LLY (וידוא חי
מול DB + קוד, ר' git history). `narrativeSummaryText` כתב "the $500
entry" — מספר שתוקן במפורש כ-sizeDollars, לא מחיר — למרות ש-Prediction
#3's own claim_text עדיין קורא "$500" (immutable). התיקון ב-`case.ts`/
`review.ts` (formatSizeDollarsLine, ר' "נבנה" למטה) סוגר את המנגנון
הקונקרטי שנמצא (Outcome formatting חסר את אותה הבחנה שכבר הייתה
ב-decision.ts) — אבל **זה לא סוגר את הבעיה הרחבה יותר**.

**הממצא המרכזי שחשוב לתעד:** proximity/prompt wording לבד אינו מספיק
אמין. במקרה LLY, התיקון "$1278.83, not $500" הופיע **בשלושה מקומות
נפרדים** באותה קריאת AI בדיוק: (1) ב-Later Context עצמו, (2) בתוך
`resolutionNote` הצמוד ישירות ל-Prediction #3 (אותה שורה ממש בפרומפט),
(3) ב-`Outcome.priceAtDecision` הנכון (אחרי התיקון הנוכחי). ובכל זאת
`narrativeSummaryText` חזר ל-"$500 entry" — בזמן שממד `exit_conditions`
**באותה תגובה בדיוק** תיקן נכון. כלומר אין להניח ש"treat later contexts
as authoritative" (הנחיית ה-SYSTEM_PROMPT הקיימת) נותן אמינות מספקת —
המודל יכול ליישם תיקון נכון בשדה פלט אחד ולהחטיא אותו בשדה אחר, **באותה
תגובה**.

**כיוון אפשרי לעתיד (לא סוכם, לא לבנות עכשיו):** פתרון מבני, לא רק
prompt tuning נוסף — כולל אפשרות לקשר Later Context ל-Prediction/שדה
ספציפי (סכימה חדשה: `later_contexts` היום הוא decision-level בלבד, לא
מקושר ל-prediction id ספציפי) כך שתיקון יוכל להיות מוצמד inline ל-
claim_text הרלוונטי בפרומפט, ולא רק לשבת בפסקה נפרדת. **נבדק ונדחה
במפורש לעכשיו:** schema change, קריאת AI שנייה ל-validation עצמי,
substitution heuristic (regex-style), post-generation validator — אף
אחד מאלה לא ממומש כרגע; זו החלטת Product/Architecture אמיתית, לא תיקון
קטן.

### Engineering Principles — "כמה implementations יש לזה?" כשאלה סטנדרטית לפני תיקון מידע פיננסי
**נמצא:** 2026-09-06, מתוך אותה חקירה. CANONICAL_FIELDS (ר' git
history), `computePositions()` (ר' Engineering Principles ב-AGENTS.md),
ועכשיו Outcome formatting (size/price) — כולם אותה תבנית חוזרת: אותו
מושג עסקי מיוצג ביותר ממקום אחד בקוד, ותיקון מגיע רק לעותק אחד. **הצעה
לעתיד, לא שינוי עכשיו:** לשקול להוסיף עיקרון מפורש ל-Engineering
Principles ב-`AGENTS.md` — כשמתגלה תיקון במידע פיננסי/עובדתי בסיסי,
השאלה הראשונה צריכה להיות "כמה implementations של הדבר הזה קיימים?"
לפני שמתקנים את המופע המקומי. לא לערוך את `AGENTS.md` כחלק מהמשימה
הזו — רק לתעד את ההצעה כאן.

### Decision Review — expose per-dimension evidence citations in UI
**נמצא:** 2026-09-06, תוך כדי בדיקת enforcement על ה-Review האמיתי של
SNDK (וידאתי חי מול DB + קוד, לפני מעבר ל-LLY) — התייעצנו ותיעדנו
בניסוח הבא, בדיוק כפי שסוכם:

The review engine already persists and validates citedSnapshotFields
for every dimension, with forced downgrade to insufficient_evidence
when no valid citable field remains.

Current gap: the Decision Review drill-down renders only verdict +
rationaleText; citedSnapshotFields are returned by the API but not
shown to the user.

Product impact: judgments are traceable internally but not visibly
traceable in the UI, despite "Traceable Judgments" being a product
principle / Done-bar expectation.

Suggested future UX: a compact "View evidence" affordance per
dimension (same pattern already used on the DNA page) that opens
readable evidence, not raw field names like caseMarketIntelligence —
those stay debug/admin-only if ever shown directly.

Priority: non-blocking UI/product gap; engine correctness already
verified on real SNDK review data.

### Dashboard — תווית "Learning Insights" בניווט צריכה עדכון כש-Learning Insight יתורגם
**נמצא:** 2026-08-23, תוך כדי redesign ה-Dashboard. `src/app/page.tsx`
משאיר את תווית הניווט ל-`/learning` באנגלית במפורש (`{ href:
"/learning", label: "Learning Insights" }`), עקבי עם זה שהעמוד עצמו
עדיין באנגלית (נדחה עד לסגירת פער forecast/re-entry-condition, ר'
הפריט מעל). **תזכורת בלבד:** כשLearning Insight יתורגם בעתיד, קל
לעדכן את `src/lib/ai/review.ts`/`learning.ts` ואת עמוד ה-Learning עצמו
ולשכוח שתווית הניווט הזו ב-Dashboard נשארה מקודדת-קשיח באנגלית באותו
קובץ — לבדוק אז.

### Baseline Strategy — אין דרך להוסיף עיקרון משלי ישירות
**נמצא:** 2026-08-17, תוך כדי מעבר על עמוד ה-Strategy לפני אישור
ה-Bundle הראשון.

היום הדרך היחידה לעיקרון **Declared** היא חילוץ AI מתשובת ראיון
קיימת + אישור (`strategy.proposeDeclared` → `strategy.confirmDeclared`,
דורש `citedAnswerIds` אמיתיים). אין אפשרות להקליד עיקרון ישירות בלי
לעבור דרך תשובת ראיון.

**כיוון אפשרי (לא סוכם):** סכימת ה-Evidence כבר תומכת ב-`manual_note_text`
כמקור חלופי ל-`interview_answer_id` — כלומר עיקרון "Declared ידני" עם
Evidence שמקורו הערה חופשית, לא ציטוט תשובת ראיון, הוא הרחבה טבעית
של המודל הקיים ולא ידרוש שינוי סכימה. עדיין דורש החלטת UX/Product
אמיתית (האם זה סוג עיקרון נפרד? האם נדרש נימוק?) — לא להתחיל לבנות
בלי לסכם קודם.

### Personal Fit / Portfolio Fit — אין חישוב חשיפה מצטברת לפי sector/industry, למרות עיקרון Strategy שמפנה אליה
**נמצא:** 2026-08-20, בעקבות בקשת המשתמש לבדוק (לא לתקן) למה Personal
Fit על SNDK הזכיר ריכוזיות. בדיקה עובדתית בשלושה שלבים, בלי הנחה
מראש:

1. **sector/industry נשלף בפועל?** כן — לכל holding, לא רק לטיקר
   הנחקר. `computePortfolioFitForInvestor`
   (`src/lib/portfolio/portfolio-fit-for-investor.ts`) קורא
   ל-`getMarketIntelligence()` עבור כל טיקר מוחזק אחר כדי לתמחר אותו,
   וזה אותו `fetchProfile` מ-FMP שמחזיר גם `sector`/`industry`
   (`src/lib/market/fmp.ts`) ונשמר במלואו ב-cache
   (`market_data_cache.payload_json`, ר' `market-intelligence.ts`).
   הנתון האמיתי קיים ונשלף — הבעיה אינה בשליפה.
2. **מחושבת חשיפה מצטברת לפי sector/industry?** לא. מיד אחרי
   ה-fetch, `computePortfolioFitForInvestor` שולף רק `.price` מהתוצאה
   (`prices[ticker] = intelligence.price`) וזורק את שאר האובייקט.
   `computePortfolioFit()` (`src/lib/portfolio/portfolio-fit.ts`) עוקב
   רק אחרי משקל טיקר בודד ואחרי הפוזיציה הגדולה ביותר — אין בכלל שדה
   sector/industry ב-`PortfolioFit`, לא כל שכן צבירה לפי sector.
3. **מוזן כ-context מובנה ל-AI?** לא, בשני המקומות שבהם AI מתייחס
   לריכוזיות: (א) `generatePersonalFit`
   (`src/server/routers/cases.ts` → `synthesizePersonalFit` ב-
   `src/lib/ai/case.ts`) מקבל **רק** ticker + הערת הרעיון + DNA
   hypotheses + Strategy principles — לא holdings, לא sector, לא
   `PortfolioFit` בכלל. (ב) גם `portfolioFitText` של Case Synthesis
   (`formatPortfolioFit` באותו קובץ) מקבל רק מספרי משקל ברמת טיקר, לא
   שדה sector.

**שורש מה שהמשתמש ראה בפועל:** אחד מארבעת עקרונות ה-Strategy הקבועים
(`avoid-correlated-concentration`,
`src/lib/strategy/default-risk-principles.ts`) מנוסח במפורש: "Watch
for concentration across positions that would all move together on
the same underlying risk (sector, theme, or macro driver)". העיקרון
הזה validated מברירת המחדל ולכן כן מגיע ל-prompt של Personal Fit. אבל
כשה-AI מיישם אותו על SNDK אין לו שום מספר חשיפה אמיתי שחושב מהנתונים
של המשקיע הזה להיבנות עליו — הוא יכול רק "לדעת" מהידע הכללי שלו לאיזה
sector שייך SNDK ולנחש קורלציה, לא מנתון שחושב בפועל. זו בדיוק הפרה
עדינה של "AI לא ממציא facts": הנתון הגולמי (sector/industry) כן אמיתי
וכן קיים ב-DB, אבל לא מוזן כ-context מובנה, אז ה-AI ממלא את החוסר
מהידע הפנימי שלו במקום.

**כיוון אפשרי (לא סוכם):** לחשב חשיפה מצטברת לפי sector/industry
בתוך/לצד `computePortfolioFit` (הנתון כבר נשלף היום ונזרק — צריך רק
"לצנרר" אותו הלאה במקום לזרוק), ולהזין את התוצאה כ-context מובנה גם
ל-Portfolio Fit וגם ל-Personal Fit, באותו אופן שכבר עובד ל-DNA/Strategy
citations. דורש גם החלטה אם/איך זה מוצג למשתמש (מספר %? אזהרה בלבד
כמו `warnings` הקיים?) — לא להתחיל לבנות בלי לסכם קודם.

### Concentration מעבר ל-sector — theme/risk-driver משותף (SNDK/NVDA כדוגמה)
**נמצא:** 2026-08-20, באותה בדיקה כמו הפער למעלה, אך **רעיון נפרד
ומורכב יותר במכוון** — לא לערבב את השניים.

גם אם הפער למעלה ייבנה (צבירת חשיפה לפי sector/industry קטגוריים כפי
שמגיעים מ-FMP), זה עדיין לא תופס את כל הריכוזיות האמיתית: שתי מניות
יכולות לחלוק risk-driver כלכלי אמיתי (למשל מחזור AI/capex) גם כש-
sector/industry הרשמיים שלהן שונים — וגם ההפך, לשתף sector רשמי בלי
להיות קורלטיביות כלכלית בפועל. `sector`/`industry` מ-FMP הוא שדה
קטגורי סטנדרטי (טקסונומיה חיצונית קבועה); "theme/risk-driver משותף"
הוא **לא** שדה כזה — זה judgment אמיתי שדורש AI לזהות תזה/מחזור
משותף בין טיקרים, עם Evidence/Traceability משלו (בהתאם ל-CLAUDE.md:
AI vs Code + Traceable Judgments) — לא רק שדה DB נוסף שאפשר "להביא
מ-FMP". דורש החלטת Product/UX אמיתית לפני בנייה: זו ממדיות חדשה על
MarketIntelligence? judgment עם citations כמו DNA/Strategy? מה
בכלל "Evidence" אומר לגבי סיווג מבני-שוק (לא התנהגות המשקיע עצמו)?
לא לעצב את זה יותר כאן — רק לתעד כרעיון נפרד לדיון עתידי, לא כתיקון
לפער הראשון.

### 3 מתוך 5 ה-UNIQUE constraints החדשים (double-submit fix) — עדיין נכשלים כ-500 גולמי בהתנגשות אמיתית
**נמצא:** 2026-08-17, תוך כדי בירור שאלת המשתמש "האם constraint שנתקל
בהתנגשות אמיתית נכשל בהודעה ברורה או כ-500 גולמי". התשובה: **לא**,
לכל חמשת ה-constraints מלבד `strategy_principles` (שכבר מטופל ע"י
`onConflictDoNothing`). `decisions` ו-`strategy_versions` תוקנו מיד
(catch מפורש → `TRPCError({code:"BAD_REQUEST"})`, ר' `src/db/errors.ts`
ו-git history) כי שניהם נגישים היום דרך ה-UI (שני טאבים / retry
רשת). **נשארו לא מטופלים במכוון:**

- `dna_hypothesis_versions_dna_hypothesis_id_version_number_unique`
- `strategy_principle_versions_strategy_principle_id_version_numbe`
  (השם עצמו נחתך ל-63 תווים ע"י Postgres — זה השם האמיתי בפועל)
- `learning_insight_versions_learning_insight_id_version_number_un`
  (נחתך גם הוא)

כל שלושתם מוגנים ברמת ה-DB (ה-constraint קיים ופעיל), אבל נשארים
הגנה תיאורטית בלבד: אושר בזמן ההחלטה שאין היום נתיב קוד שיוצר גרסה
שנייה לזהות קיימת באף אחת מהשלוש — `insertDnaHypothesisWithEvidence`,
`insertObservedPrincipleWithEvidence`/`insertDeclaredPrinciple`,
ו-`insertLearningInsightWithEvidence` תמיד יוצרים identity חדש (UUID
טרי) + `version_number=1`, אף פעם לא גרסה נוספת לזהות קיימת. אם ותהיה
פעם תכונה שכן יוצרת גרסה שנייה (למשל "ערוך/שפר השערת DNA קיימת") —
להוסיף אז את אותה תבנית catch בדיוק (`isUniqueViolation` כבר קיים
וגנרי, רק לחבר אותו בנקודת ה-insert הרלוונטית).

### עקרון עיצוב עתידי (Market Scanner) — השערות DNA/Strategy מוגזמות עלולות ליצור feedback loop
**נמצא:** 2026-08-21, אגב תיקון overclaim ב-`src/lib/ai/dna.ts`
(השערה שטענה "מעדיף להימנע מחברות לא-מוכרות" כשמה שהראיה תמכה בו
בפועל זה רק "בוטח יותר בשמות מוכרים" — ר' git history). **לא בקשת
קוד פעילה** — Market Scanner לא בונים עכשיו
(`docs/architecture.md` §3), ואין היום שום מנגנון הצעה אוטומטי
ל-Ideas בכלל; `ideas.create` מקבל ticker+noteText בהקלדה ידנית של
המשתמש בלבד, שום דבר לא "מציע" לו טיקרים.

עקרון לזכור **כשה**-Market Scanner (או כל מנגנון הצעה/סינון
אוטומטי עתידי ל-Ideas) ייבנה בפועל: אם השערת DNA/Strategy מנוסחת
בהגזמה ביחס לראיה (tendency בודדת שהופכת ל-preference/goal מוצהר)
ותוזן כקלט למנגנון שמסנן/מציע טיקרים — ההגזמה עלולה להצטמצם
ל-feedback loop אמיתי: המערכת "לומדת" העדפת-הימנעות שהמשקיע מעולם
לא הצהיר עליה בפועל, ומצמצמת יותר ויותר את מגוון הרעיונות שהוא
נחשף אליו, בלי שביקש את זה ובלי לדעת שזה קורה. הכלל שכבר נוסף
ל-`dna.ts` (לא להסיק preference/goal מ-tendency בודדת) הוא ההגנה
הרלוונטית ברמת ה-prompt — צריך לחול גם על `strategy.ts` (מבנה כמעט
זהה, אותו סיכון בדיוק) לפני שכל מנגנון עתידי קורא מ-DNA/Strategy
בתור קלט להחלטה מה להציע.

---

## נבנה
- **decision.ts — runtime validation מקביל ל-case.ts** (2026-09-07):
  `assertNonEmptyStrings` (מיובא ישירות מ-`src/lib/ai/case.ts`, לא
  שוכפל) מופעל ב-`synthesizeDecisionContext` על `thesisInterpretationText`
  ו-`realtimeAssessmentText`, ובנוסף בלולאה על כל `predictions[].claimText`
  בנפרד (שגיאה כוללת את האינדקס, למשל `predictions[2]`, throw-on-first).
  מערך `predictions` ריק (`[]`) נשאר תקין ולא נבדק — תוצאה נורמלית.
  Tests: `tests/unit/decision-synthesis-validation.test.ts` (15 טסטים).
  **נכלל בכוונה בתיקון הזה בלבד:** שני השדות השטוחים + מערך ה-predictions.
  **לא נכלל אז, נבנה בנפרד:** transaction wrapping סביב רצף הכתיבה כולו
  (thesis/decision/predictions/snapshot) — ר' הפריט הבא למטה.
- **Decision creation — insertThesis/insertDecision/predictions/
  insertDecisionSnapshot עכשיו עטופים ב-transaction אחד** (2026-09-07):
  `src/server/routers/decisions.ts`'s `create` mutation ביצע קודם רצף
  כתיבות נפרדות — `insertThesis` → `insertDecision` → לולאת
  `insertPrediction` → `insertDecisionSnapshot` (+`updateInvestmentCase`
  בסוף) — **בלי transaction עוטף אחד** (רק ה-snapshot ו-DNA references
  שלו היו עטופים יחד, `src/db/repositories/decisions.ts:81-92`). כשל
  באמצע הרצף היה יכול להשאיר `Decision` אמיתי, immutable, בלי
  `decision_snapshot` תואם, בלי נתיב FK לשחזר thesis/predictions שכן
  נכתבו.

  **תיקון לניסוח קודם של הפריט הזה — חשוב:** גרסה קודמת כאן טענה "ראיה
  אמפירית אמיתית... נמצאו 31 decisions ללא snapshot" כהדגמה של הפער. זה
  **לא מדויק**, ותוקן: 30 מתוך 31 מוסברים במלואם ע"י
  `tests/integration/decisions-race.test.ts`, שקורא ל-`insertDecision`
  בבידוד (לא דרך ה-`create` mutation), אף פעם לא מגיע ל-thesis/snapshot,
  ולא מנקה אחריו — תוצר-לוואי ידוע של טסט צר, לא הדגמה של הפער הזה. ה-1
  הנוסף (בחשבון `race-check-*`) תואם אותה תבנית שמית אך לא אומת ישירות
  (סקריפט המקור נמחק לפי המוסכמה הקיימת). **לא נמצא עד כה מקרה אמפירי
  מוכח** של הכשל הזה בזרימת ה-`create` mutation האמיתית — הגילוי
  והתיקון נעשו מניתוח קוד (חקירת הרצף, nested transaction support,
  תאימות טיפוסים — ר' git history), לא מתקרית שקרתה בפועל.

  **התיקון שנבנה:** הרצף כולו עטוף עכשיו ב-`db.transaction(async (tx) =>
  {...})` — `insertThesis(tx,...)` → `insertDecision(tx,...)` (ה-
  try/catch הקיים שממיר unique violation להודעה ידידותית ממשיך לזרוק
  מתוך ה-callback, כנדרש כדי שה-rollback יקרה) → לולאת
  `insertPrediction(tx,...)` → `insertDecisionSnapshot(tx,...)`
  (ה-transaction הפנימי שלו הופך אוטומטית ל-SAVEPOINT, לא שגיאה) →
  `updateInvestmentCase(tx,...)`. חמש פונקציות repository
  (`insertThesis`, `insertDecision`, `insertPrediction`,
  `insertDecisionSnapshot`, `updateInvestmentCase`) שונו מ-`db: typeof
  Db` ל-`db: DbOrTx` (type alias חדש ב-`src/db/client.ts`,
  `PgDatabase<PostgresJsQueryResultHKT, typeof schema>` — טיפוס בסיס
  משותף שגם ה-instance העליון וגם `tx` assignable אליו; אומת עם ניסיון
  קומפילציה אמיתי, לא רק הונח). נשארים בכוונה מחוץ ל-transaction:
  `getMarketIntelligence`/`getOrCaptureMarketContext` (כולל כתיבות cache
  עצמאיות משלהם) ו-`synthesizeDecisionContext` (קריאת Anthropic) — I/O
  חיצוני איטי שאסור להחזיק transaction DB פתוח מולו, ו-caches עצמאיים
  שרצוי שישרדו גם כשל בהחלטה עצמה.

  **נבדק ואומת:** `tests/integration/decisions-create-atomicity.test.ts`
  חדש — מריץ את אותו רצף בדיוק (אותן חמש פונקציות repository אמיתיות,
  לא mock) פעמיים במקביל על אותו case, ומאשר: הזוכה מקבל בדיוק שורה
  אחת בכל טבלה (theses/decisions/decision_snapshots/predictions),
  והמפסיד מקבל **rollback מלא כולל ה-thesis** (לא רק "אין decision") —
  בדיוק ההגנה שהייתה חסרה. **לא מוכיח** שה-`create` mutation עצמו
  ממשיך לקרוא ל-`db.transaction` באותה נקודה — זה נשען על code-review
  ידני ב-diff, לא test אוטומטי (mocking ל-Anthropic/FMP נבדק ונדחה
  כבלתי מוצדק לנקודת-קריאה אחת קטנה ויציבה, אותה מסקנה כמו
  ב-`validateDecisionSynthesis`).
- **הערה לא-מדויקת ב-`decision.ts` — תוקנה, ונוסף regression test אמיתי
  ל-`formatContext`** (2026-09-08): ההערה ליד `formatContext` טענה
  לכיסוי מ-`tests/unit/format-price-size.test.ts` — בפועל אותו טסט
  מעולם לא ייבא/קרא ל-`formatContext` עצמה, רק בדק את
  `formatSizeDollarsLine` בבידוד; שינוי עתידי בתוך `formatContext` עצמו
  (למשל היפוך "above"/"below") לא היה נתפס, בניגוד למה שההערה טענה.

  **התיקון:** `tests/unit/decision-format-context.test.ts` חדש קורא
  ל-`formatContext` **האמיתית** (לא helper/reimplementation), עם
  fixture מלא, ובודק את הפלט **המלא** ב-`toBe()` — לא `toContain()`
  חלקי — כך ששינוי סדר סעיפים או היפוך "above"/"below" בקריאה
  ל-`formatSizeDollarsLine` ייתפס, לא רק היעדרות ביטוי ספציפי. מכסה
  במפורש גם ענפים מותנים: `sizeDollars` חסר (נופל ל-"not specified"),
  שדות אופציונליים ב-`portfolioFit`
  (`projectedWeightPercent`/`largestCurrentPositionTicker`/
  `largestCurrentPositionWeightPercent`=`null`, `warnings=[]` — נעלמים
  לגמרי מהפלט, לא משאירים שורה ריקה), ומערכי DNA/Strategy ריקים
  (נופלים ל-"none yet"). ההערה ב-`decision.ts` עודכנה להצביע לטסט
  החדש ולתעד במפורש שהניסוח הקודם היה שגוי.
- **Systematic double-submit fix** (2026-08-17, commit `4c91bd6`
  ואילך): `useSubmitGuard` בכל כפתורי ה-mutation + 5 constraints
  ברמת ה-DB. `decisions` ו-`strategy_versions` גם מטפלים בהתנגשות
  אמיתית בהודעה ברורה (לא 500 גולמי) — ר' פירוט מעל למה 3 האחרים
  עדיין לא.
- **Case Synthesis / Personal Fit — validation על שדות `required`
  שנעלמים בשקט** (2026-08-23): `assertNonEmptyStrings()` חדשה
  ב-`src/lib/ai/case.ts`, מופעלת על שני מקומות ה-cast
  (`synthesizeInvestmentCase`/`synthesizePersonalFit`) — זורקת שגיאה
  ברורה עם שמות השדות החסרים ושם ה-tool, במקום לתת ל-`null`/`undefined`
  לדלוף עד ה-DB/UI בלי אזהרה. 9 בדיקות unit ייעודיות
  (`tests/unit/case-assert-non-empty-strings.test.ts`) — לא smoke test.
  אומת חי שגם לא יוצר false positive על תשובה תקינה אמיתית (PLTR,
  investor זמני). לא הורחב ל-`decision.ts`/`dna.ts`/`strategy.ts` —
  אלו עושות type assertion דומה בלי validation; `decision.ts` עלה
  לעדיפות גבוהה (ר' למעלה), `dna.ts`/`strategy.ts` לא עלו — לא
  קיימת שם עדות דומה לרגישות אמיתית בפועל.
- **Prediction extraction — forecast/re-entry-condition distinction**
  (2026-08-23): גישה A מתוך שלוש שהוצגו למשתמש (ר' `docs/data-model.md`
  §5 להסבר המלא). שדה `kind(forecast|reentry_condition)?` חדש על
  `Prediction` (migration `0005_confused_rattler.sql`, נוסף nullable —
  לא נגזר בדיעבד ל-Prediction-ים ישנים). `src/lib/ai/decision.ts`
  מחלץ כל חלופה בקבוצת-OR כ-Prediction נפרד משלה (לא רק את הראשונה),
  עם ניסוח כתנאי ולא כתחזית. `src/lib/ai/review.ts`'s thesisAccuracy
  קורא את מלוא `userReasoningText`/`exitConditionsText` (כבר היו שם,
  רק לא נוצלו לצורך הזה) כדי להסיק בעצמו יחס OR בין כמה
  `reentry_condition`, במקום לדרוש שכולם יתקיימו בנפרד. UI: תג kind
  מוצג גם ב-Decision Snapshot (עברית, `predictionKindLabel`) וגם
  בטופס הפתרון של Decision Review (אנגלית, לא מעוצב — תואם את שאר
  הסקשן).

  **אומת חי מקצה לקצה**, לא רק typecheck: החלטת PASS עם 3 תנאים
  חלופיים (PLTR, investor זמני) — כל השלושה חולצו כ-`reentry_condition`
  נפרדים, מנוסחים כתנאי לא כתחזית. פתרון שבו רק אחד אושר ושניים
  הופרכו הניב `thesisAccuracy: "partially_confirmed"` (לא `refuted`),
  עם נרטיב שמסביר במפורש: "since these were stated as alternatives,
  this still counts as partial confirmation of the reasoning, not a
  failure" — בדיוק ההתנהגות שהתלונה המקורית (SNDK) ביקשה.

  **לא נבנה (אופציה B שנדחתה במכוון בשלב הזה):** אין `group_id`
  פורמלי בטבלה שמקשר תנאים חלופיים כמבנה נתונים מפורש; ה-AI מסיק את
  יחס ה-OR מהטקסט המקורי בכל Review מחדש, לא ממבנה מובטח. תיעוד מלא
  של הבחירה ב-`docs/data-model.md` §5.

- **formatSizeDollarsLine — הבחנת size/price משותפת בין decision.ts
  ל-review.ts** (2026-09-06): `src/lib/ai/format-price-size.ts` חדש —
  מקור אמת יחיד להבהרה "זה size, לא price", בשימוש גם ב-`decision.ts`
  (שכבר הוכיח את התיקון בעבר) וגם ב-`review.ts`'s `formatOutcome()`
  (שמעולם לא קיבל אותו). פלט `decision.ts` נשמר זהה-בית (regression
  test). 6 טסטים חדשים על נתוני LLY האמיתיים (`priceAtDecision=1278.83`,
  `sizeDollars=500`) מוכיחים שהפורמט לא מציג את השניים בצורה שניתנת
  לבלבול. **סוגר רק את המנגנון הקונקרטי הזה** — לא את בעיית ה-precedence
  הרחבה יותר, ר' "פתוח" מעל.
