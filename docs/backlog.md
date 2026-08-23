# Backlog — Gaps Found, Deferred On Purpose

רשימה מצטברת של פערים אמיתיים שנתקלנו בהם תוך כדי המעבר בלולאה
המלאה (לא באגים — התנהגות חסרה או לא-אינטואיטיבית שהתגלתה, ותוקנה
במודע *לא* להיבנות מיד). המטרה: לצבור כמה פערים לפני שמחליטים ביחד
מה שווה לבנות, במקום אחד-אחד. כשמשהו מכאן נבנה בפועל — מעביר את
השורה לקטגוריית "נבנה" (או מוחק) ומצטט את המשימה/commit הרלוונטי,
לא משאיר את זה תלוי.

---

## עדיפות גבוהה

*(ריק כרגע — הפריט היחיד שהיה כאן, אימות שדות required ב-Case
Synthesis/Personal Fit, נבנה. ר' "נבנה" למטה.)*

---

## פתוח

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

### Prediction extraction מבלבל forecast עם decision/re-entry condition
**נמצא:** 2026-08-20, אתגור מהמשתמש לפני סגירת רשומת SNDK PASS
כ"נקייה": הנימוק המקורי פירט 3 תנאים חלופיים (OR) ל"אני אשקול מחדש
אם..." (pullback/consolidation; מידע fundamental/valuation שמצדיק את
המחיר; setup חדש להגדרת סיכון) — וה-extractor הפך רק את החלופה
הראשונה ל-Prediction בניסוח forecast: "SNDK will experience a
pullback or period of consolidation...". בדיקה בשלוש רמות, בלי לשנות
קוד:

1. **רמת מסמך:** `docs/data-model.md` §5 מגדיר Prediction כ-`claim_text`
   גנרי בלבד — אין שדה שמבחין forecast ("אני חושב ש-X יקרה") מ-
   decision/re-entry condition ("אני אשקול מחדש אם X יקרה"). הפער קיים
   כבר ברמת התכנון, לא רק במימוש.
2. **רמת קוד:** ה-SYSTEM_PROMPT ב-`src/lib/ai/decision.ts` מנחה "extract
   0-3 concrete, checkable claims implied by the reasoning" — בלי הנחיה
   לשמר מבנה OR בין כמה תנאים חלופיים, ובלי להבחין בין שני סוגי המשפט.
   זה בדיוק מה שחזר בפועל אצל המשתמש.
3. **השפעה בהמשך — מאושרת כאמיתית:** את סטטוס הפתרון (confirmed/
   refuted/inconclusive) **המשתמש** קובע בעצמו, לא ה-AI
   (`reviews.generate` ב-`src/server/routers/reviews.ts`,
   `predictionResolutions`), כולל `resolutionNote` חופשי שכן מגיע
   ל-AI של ה-Review. אבל: (א) `claim_text` immutable מרגע היצירה
   (`docs/data-model.md` §5) — אי אפשר לתקן את הניסוח השגוי, רק
   "לעקוף" אותו בהערה חופשית; (ב) אם התנאי שבפועל הפעיל BUY היה חלופה
   #2 (fundamentals) ולא #1 (pullback) — התשובה הכנה למה שבאמת נשאל
   ("did SNDK pull back") היא "לא" → refuted, גם אם ה-logic האמיתי
   (כל אחד מ-3 התנאים) התקיים; (ג) `thesisAccuracy` ב-
   `synthesizeDecisionReview` (`src/lib/ai/review.ts`) מסונתז "based
   ONLY on the given prediction resolutions" — ונכתב immutable ל-
   `decision_reviews.thesis_accuracy`; (ד) זה מוזן הלאה ל-
   `computeThesisAccuracyPattern`
   (`src/lib/learning/pattern-aggregation.ts`) וגם כטקסט מפורש
   ("Thesis accuracy: refuted") ל-AI של Learning Insight
   (`src/lib/ai/learning.ts`). כלומר — **כן, זה יכול להשפיע** על
   Decision Review (immutable) ועל Learning Insight, אלא אם ה-`resolutionNote`
   מנוסח בקפידה מספיק כדי להטות את סינתזת ה-AI חזרה לכיוון הנכון —
   ותלוי-ניסוח כזה הוא בדיוק סוג האי-ודאות ש-No Fake Certainty נועד
   למנוע ברמת השדה עצמו, לא רק בפרוזה מתקנת בהמשך.

**נראה שוב, חי, 2026-08-21:** תוך כדי בדיקת הנחיית השפה החדשה
ב-`decision.ts` (investor זמני, MSFT, לא קשור לשינוי השפה עצמו) —
אותה תבנית בדיוק חזרה: תנאי יציאה שכתבתי במפורש ("would exit if
Azure growth drops below 15% for a quarter") חולץ כ-Prediction נפרד
משלו, לא רק אותה מגמה בהיפותזה — reproduction ממשי, לא רק חשש
תיאורטי. עדיין לא תוקן, עדיין דורש החלטת Product/UX לפני בנייה (ר'
למטה) — לא שינה עדיפות, רק מוסיף ראיה נוספת.

**כיוון אפשרי (לא סוכם):** להבחין ב-extraction בין "forecast" ל-
"decision/re-entry condition", ולשמר קבוצת תנאים חלופיים (OR) כיחידה
אחת שנפתרת יחד ("התקיים לפחות תנאי אחד מהקבוצה") במקום לפרק לתחזית
בודדת. דורש החלטת Product/UX אמיתית (מבנה נתונים חדש? שדה `kind` על
Prediction? איך זה משפיע על thesis_accuracy rollup הקיים?) — לא להתחיל
לבנות בלי לסכם קודם.

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
  אלו עושות type assertion דומה בלי validation, אבל זה מחוץ ל-scope
  של הפריט הזה; לשקול כפריט חדש נפרד אם ירצו.
