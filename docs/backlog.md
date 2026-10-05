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

### Decision page — Sector/Industry Exposure עדיין לא מוצג
**נמצא:** 2026-09-09, תוך כדי implementation של Sector/Industry Exposure
ב-UI (עמוד Case בלבד, ר' "נבנה" למטה). Product **אישרו במפורש** להשאיר
את עמוד ה-Decision (`src/app/decisions/[id]/page.tsx`) מחוץ ל-scope
של אותה משימה — זה לא נשכח, זו החלטה מתועדת. הפריט הזה **נפרד** מהפריט
"Sector + Industry Exposure" תחת "נבנה" למטה — אותו לא צריך "לתקן",
הוא נבנה נכון למה שאושר בו (AI context + UI בעמוד Case). זה פריט חדש
לגמרי, לא המשך שלו.

**למה זה לא "רק עוד UI"** — א-סימטריה אמיתית מול עמוד Case, נמצאה
תוך כדי אותה בדיקה:
- ב-Case, `trpc.cases.computePortfolioFit` (mutation קיים) כבר מחזיר
  `PortfolioFit` מלא ל-client (כולל `sectorExposure`/`industryExposure`)
  — הרחבת ה-UI לא דרשה שום שינוי server, רק רינדור.
- ב-Decision, `decisions.get` (`src/server/routers/decisions.ts`)
  מחזיר `snapshot.portfolioStateJson` — זו **רק** תוצאת
  `computePositions()` הקפואה (positions+cash גולמיים), **לא**
  `PortfolioFit` מחושב. ה-`portfolioFit` שכן מחושב בזמן `create`
  (`decisions.ts`, קורא ל-`computePortfolioFit`) משמש **רק** להזנת
  ה-AI narrative (`synthesizeDecisionContext`) — אף פעם לא נשמר, אף
  פעם לא מוחזר ל-client.

**מה יידרש בפועל (לא סוכם, לא לבנות בלי דיון Product נפרד):** query/
endpoint חדש שמריץ מחדש `computePortfolioFit` על `portfolioStateJson`
הקפוא של ה-snapshot + classification (`sector`/`industry`) שנשלף מחדש
בזמן אמת per ticker (לא נשמר ב-snapshot) — זה מערבב semantics: המחיר/
positions קפואים לתאריך ההחלטה, אבל sector/industry classification
יהיה live/עדכני. האם זה תקין (sector/industry כמעט אף פעם לא משתנים
לטיקר נתון, בניגוד למחיר), או שנדרשת החלטה מפורשת על "מה בדיוק
נשמר/מוקפא ב-Decision Snapshot לצורך התצוגה הזו" — שאלת Product פתוחה.

### ~~Transactions — אין שום מנגנון deduplication, לא cross-source ולא בכלל~~ — נבנה (History Refresh V1, 2026-09-22; ר' "נבנה")
**נמצא:** 2026-09-08, תוך כדי חקירת Manual Historical Entry — נבדק
במפורש כי המשתמש מתכנן לייבא בעתיד CSV אמיתי מהברוקר שעשוי לכלול
עסקאות שכבר הוזנו ידנית (או ייבוא חוזר). נבדק בקוד, לא הונח מהתיעוד:

- **אין UNIQUE constraint זהות על `transactions`** בשום migration
  (`src/db/migrations/*.sql`) — רק שני FK (`investor_id`,
  `import_batch_id`), שום אילוץ ייחודיות על ticker/date/quantity/price
  או כל שילוב שלהם. (**דיוק 2026-09-22:** מאז `0007` קיים אינדקס ייחודי
  **חלקי** `(investor_id, ticker, transaction_date, intra_day_order) WHERE
  intra_day_order IS NOT NULL` — הוא אוכף סדר-יומי מוצהר ייחודי, לא זהות
  עסקה, ולא נוגע לרוב השורות. גם אחרי History Refresh V1 אין אילוץ זהות
  ב-DB **בכוונה**: עסקאות זהות לגמרי הן לגיטימיות; הזהות היא multiset
  בקוד.)
- **אין לוגיקת dedup באפליקציה** — `grep` מקיף על `duplicate|dedup`
  בכל `src/lib/import/` ו-`src/server/routers/import.ts` העלה רק
  שימושי `Set()` לתצוגת רשימת טיקרים ב-UI (לא לדה-דופליקציה של
  עסקאות). `confirmImport`/`confirmManualEntry` שניהם כותבים ישירות,
  בלי לבדוק מול שורות `transactions` קיימות.

**תיקון תיעוד נלווה (Docs Sync Rule) — לא רק ממצא, גם סטייה מתועדת
שתוקנה:** `docs/architecture.md` §2.1 טען במפורש "פרסור/ולידציה/
**דה-דופליקציה** דטרמיניסטיים" — זה **לא נכון** ביחס לקוד הקיים; תוקן
באותו commit שמתעד את הממצא הזה (הוסר "דה-דופליקציה" מהמשפט).

**הסיכון האמיתי:** ייבוא CSV עתידי שמכיל עסקת MP שכבר הוזנה ידנית
(או כל עסקה אחרת שהוזנה ידנית ואז מיובאת מהברוקר) ייצור **שורה
כפולה** ב-`transactions` — position מנופחת, cost-basis שגוי,
`sellTrace`/P&L כפולים. לא מטופל.

**לא נבנה במסגרת המשימה הזו — במפורש מחוץ ל-scope:** שום מנגנון
dedup חדש (cross-source או בכלל). כיוונים אפשריים לעתיד (לא סוכם, לא
לבנות): אזהרת "עסקה דומה כבר קיימת" בזמן `import.validate`/
`confirmManualEntry` (heuristic על ticker+date+quantity+price קרובים,
לא UNIQUE constraint קשיח — עסקאות אמיתיות זהות-לגמרי יכולות לקרות
בלגיטימיות, למשל שתי קניות נפרדות באותו יום/מחיר), או flow ידני
"סמן כפילות וסגור" בזמן ייבוא. דורש החלטת Product/UX אמיתית.

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

### ~~Dashboard — תווית "Learning Insights" בניווט צריכה עדכון כש-Learning Insight יתורגם~~ — נבנה (Frontend V1 יחידה 1: הניווט עבר ל-shell ותוויתו "תובנות למידה"; ר' "נבנה")
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

### Concentration מעבר ל-sector — theme/risk-driver משותף (SNDK/NVDA כדוגמה)
**נמצא:** 2026-08-20, באותה בדיקה שהובילה ל-Sector/Industry Exposure
(ר' "נבנה" למטה), אך **רעיון נפרד ומורכב יותר במכוון** — לא לערבב את
השניים; לא נסגר, לא נבנה כאן.

גם אחרי ש-Sector/Industry Exposure הבסיסי נבנה (צבירת חשיפה לפי
sector/industry קטגוריים כפי שמגיעים מ-FMP), זה עדיין לא תופס את כל
הריכוזיות האמיתית: שתי מניות
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
לא לעצב את זה יותר כאן — רק לתעד כרעיון נפרד לדיון עתידי, לא כהרחבה
של Sector/Industry Exposure הבסיסי.

### 2 מתוך 5 ה-UNIQUE constraints החדשים (double-submit fix) — עדיין נכשלים כ-500 גולמי בהתנגשות אמיתית
**נמצא:** 2026-08-17, תוך כדי בירור שאלת המשתמש "האם constraint שנתקל
בהתנגשות אמיתית נכשל בהודעה ברורה או כ-500 גולמי". התשובה: **לא**,
לכל חמשת ה-constraints מלבד `strategy_principles` (שכבר מטופל ע"י
`onConflictDoNothing`). `decisions` ו-`strategy_versions` תוקנו מיד
(catch מפורש → `TRPCError({code:"BAD_REQUEST"})`, ר' `src/db/errors.ts`
ו-git history) כי שניהם נגישים היום דרך ה-UI (שני טאבים / retry
רשת). **נשארו לא מטופלים במכוון:**

- `strategy_principle_versions_strategy_principle_id_version_numbe`
  (השם עצמו נחתך ל-63 תווים ע"י Postgres — זה השם האמיתי בפועל)
- `learning_insight_versions_learning_insight_id_version_number_un`
  (נחתך גם הוא)

שני אלה מוגנים ברמת ה-DB (ה-constraint קיים ופעיל), אבל נשארים הגנה
תיאורטית בלבד: אין היום נתיב קוד שיוצר גרסה שנייה לזהות קיימת באף אחת
מהשתיים — `insertObservedPrincipleWithEvidence`/`insertDeclaredPrinciple`
ו-`insertLearningInsightWithEvidence` תמיד יוצרים identity חדש (UUID
טרי) + `version_number=1`. אם ותהיה פעם תכונה שכן יוצרת גרסה שנייה —
להוסיף אז את אותה תבנית catch בדיוק (`isUniqueViolation` כבר קיים
וגנרי, רק לחבר אותו בנקודת ה-insert הרלוונטית) — בדיוק כפי שכבר נעשה
עבור DNA, ר' הסעיף הבא.

**עודכן (Autonomous Unit 3, DNA Grounding Remediation) — הטענה למעלה
כבר לא נכונה עבור `dna_hypothesis_versions_dna_hypothesis_id_version_number_unique`:**
מאז commit `25fe506` (Evidence Grounding + Hypothesis Identity Hardening)
קיים נתיב קוד אמיתי שיוצר גרסה שנייה לזהות DNA קיימת —
`insertDnaHypothesisVersionWithEvidence`, מופעל מ-`dna.generate`'s
hypothesis-identity resolution — וה-catch המתאים כבר קיים בפועל
ב-`src/server/routers/dna.ts` (`isUniqueViolation(err,
"dna_hypothesis_versions_dna_hypothesis_id_version_number_unique")` →
`TRPCError({code:"BAD_REQUEST"})`). Autonomous Unit 3 הוסיף נתיב-כתיבה
שני לאותה טבלה בדיוק (`insertDnaHypothesisVersionWithGroundingChecks`,
ר' "DNA Grounding Remediation" למטה) שמכובד ע"י אותו constraint
בדיוק, מאומת ב-integration test ייעודי ומ-migration `0008` שמוחלת בפועל
(ר' שם). ה-constraint הזה, אם כך, כבר לא "הגנה תיאורטית בלבד" —
הוא constraint פעיל שכבר נבדק אמפירית מול שני נתיבי קוד אמיתיים.

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

### AI structured-output boundary — חשיפות שנותרו אחרי ההקשחה של שלושת ה-generators
**נמצא:** 2026-09-18, אגב תיקון תקרית ה-Strategy generation
(ר' "נבנה" למטה). **לא בקשת קוד פעילה, ולא נצפה בפועל באף אחד מהם.**
(1) שדות מערך **מקוננים בתוך פריט** (`evidence`, `citedAnswerIds`) שמגיעים
כ-JSON string: `validate-principles.ts`/`validate-hypotheses.ts` כבר
מוציאים פריט כזה בשקט (`!Array.isArray(...) → continue`) — fail-closed,
אבל השערה שלמה נעלמת בלי אות. התקרית הממשית הייתה ב-parameter העליון של
ה-tool call, לא בשדות מקוננים בתוך ה-JSON הפנימי, ולכן לא הורחב לכאן.
**עדכון 2026-09-19:** ה-strict tool schema (ר' "נבנה") מגביל גם את שדות
המערך המקוננים של שלושת ה-generators לסוג `array` ברמת ה-provider, כך שהחשיפה
הזו אמורה להיסגר שם — **עדיין לא אומת חי**.
(2) generators שצורכים אובייקט שלם ולא collection עליון
(`review.ts` `dimensions`, `learning.ts` `evidence`, `case.ts` מערכי
ציטוט, `decision.ts`) — אין להם גבול `Array.isArray` מפורש בכלל;
`validateReviewDimensions` על string היה זורק TypeError גולמי. לא נגעו.
(3) הוולידטורים של הדומיין **מוציאים פריט פגום ומשאירים את השאר**, הם לא
זורקים על כל התוצאה — התנהגות קיימת ומאושרת שלא שונתה. אם רוצים
all-or-nothing, זו החלטת מוצר נפרדת על שכבת הוולידציה, לא על שכבת
ה-representation.

### Evidence Strength — גרסאות שכבר נשמרו הפרו את האינווריאנט (remediation append-only — הושלם)
**נמצא:** 2026-09-20, אגב תיקון הסמנטיקה (ר' "נבנה"). שתי גרסאות אמיתיות
נשמרו תחת הכלל הישן ועדיין היו הגרסה **האחרונה** שלהן: `dna 7c3665ca v1`
(S=2,C=1, `moderate`) ו-`strategy 3653aeed v2` (S=2,C=1, `moderate`). תחת הכלל
החדש שתיהן `insufficient_evidence`. **השפעה ממשית, לא רק תווית:**
`excludeInsufficientEvidence` (cases/decisions/reviews) כלל אותן בהקשר ה-AI
של Personal Fit / הערכה בזמן-אמת. כל שאר 17 הגרסאות עם tier תואמות. **מומש
(2026-09-20):** מנגנון כללי append-only — `recalculateDnaHypothesisConfidence`/
`recalculatePrincipleConfidence`, dry-run read-only
(`planConfidenceRecalculationsForInvestor`) ו-`applyConfidenceRecalculationsForInvestor`
— עם `created_by=system_confidence_recalculation` (ערך חדש בשני ה-enums;
מיגרציה `0010`, שתי פקודות `ALTER TYPE … ADD VALUE`). grounding checks
scoped-לגרסה מועתקים קדימה במפורש כדי שהראיה האפקטיבית לא תשתנה. אומת על DB
scratch מבודד (כולל מקביליות 8-כיוונית); dry-run אמיתי: בדיוק 2 תיקונים
מתוכננים, 0 כתיבות. **בוצע בפועל (2026-09-21T18:58, אומת שוב קריאה-בלבד
2026-09-22):** מיגרציה `0010` מוחלת על ה-DB האמיתי (11 מיגרציות מוחלות סה"כ
נכון ל-2026-09-22, לפני `0011`); `applyConfidenceRecalculationsForInvestor`
רץ עבור המשקיע האמיתי — `dna 7c3665ca` קיבל `v2` ו-`strategy 3653aeed` קיבל
`v3`, שתיהן `system_confidence_recalculation`, שתיהן `insufficient_evidence`
כמתוכנן; הגרסאות הישנות (`v1`/`v2` בהתאמה) נשארות בהיסטוריה כפי שהיו
(immutable) — לא סטייה, זו בדיוק הכוונה. **תוקן במסמך הזה 2026-09-22** —
הטקסט הקודם כאן ("נכתבה ולא הופעלה") היה שגוי/מיושן: ה-apply כבר בוצע לפני
תיקון זה — נמצא ותוקן אגב Test DB Safety audit (ר' git history), בבדיקת
קריאה-בלבד ישירה על ה-DB האמיתי (מיגרציות מוחלות, ערך ה-enum, שורות הגרסה
עצמן), לא הונח.

### Decision Independence V1 — מומש והוחל, נותרו הרחבות
**מומש (2026-09-22) — ר' "נבנה".** נותר:
1. ~~אישור אנושי ← החלת מיגרציה `0011` ← apply פעם אחת~~ **בוצע (2026-09-22, תוקן במסמך
   באותו יום):** מיגרציה `0011` הוחלה על ה-DB האמיתי (12 מיגרציות; fingerprint של 7,163 שורות
   היסטוריה זהה לפני/אחרי — schema בלבד), ו-`applyIndependenceRecalculationsForInvestor` רץ
   **פעם אחת** אחרי dry-run אמיתי קריאה-בלבד: בדיוק 2 גרסאות — Strategy `a48426b1` → v2 ו-DNA
   `699cdb50` → v3 (S: 2 → 1, S_ub=2, C_ub=0, tier נשאר insufficient_evidence, `created_by=
   system_independence_recalculation`, basis דטרמיניסטי, 3 grounding checks נישאו קדימה ל-DNA);
   plan חוזר = 0 appends, 0 requires_review; 0 LinkFacts.
2. **Review UI + workflow אישור שיכתוב `TransactionLinkFact`.** כרגע אין דרך לכתוב עובדה
   (בכוונה — אין mutation procedure). זו גם הדרך היחידה להעלות `S_lb` אחרי dismissal: עלייה
   אינה נכתבת אוטומטית (`requires_review`).
3. שדה "funded by" מובנה ב-manual entry (כל 4 העסקאות הידניות בהיסטוריה הן בדיוק אירוע MP→MRVL).
4. **Claim-scoped release.** קישור מאושר קורס לכל claim שמצטט את שני הקצוות — נכון ל-2/2 claims
   אמיתיים (הקצאת הון), אך מקטין ספירה ל-claim שרואה את הקצוות כנפרדים. גלוי ב-`basis`, לא שקט.
5. **Learning Insight** — ה-key שלו `decisionId`, בלי מודעות לתלות בין החלטות. **תוקן
   2026-09-22 (אומת קריאה-בלבד):** למשקיע האמיתי יש **0** Learning Insights; ה-"2 insights על 3
   החלטות BUY מאותו יום" שהוזכרו כאן היו fixtures של טסטים (לפני Test DB Safety), לא נתון אמיתי.
   הסכמה מוכנה להרחבה (`decision_id` כעמודת endpoint נוספת — additive).
6. תלות same-ticker בין episodes שונים (מכירה וקנייה מחדש כהחלטה אחת).
7. AI reader/proposals — בטבלה נפרדת שה-resolver לא קורא; אף פעם לא משפיע על ספירה.
8. **חשיפה מתועדת:** תלות בלתי-נצפית (יום rebalance עמוס, בלי isolation ובלי הזכרת ticker) נשארת
   נספרת כעצמאית. היא נראית ב-`reviewOnly` של ה-basis, לא מוסתרת.

### `computePositionsForInvestor` לא מעביר `intra_day_order` ל-`computePositions` (נמצא 2026-09-22)
**נמצא** תוך כדי Episode Journal V1, בקריאה בלבד: ה-wrapper (`src/lib/portfolio/compute-for-investor.ts`)
ממפה את שורות ה-DB ל-`TransactionInput` בלי `intraDayOrder`/`orderUnknownReason`, ולכן קבוצת
אותו-יום עם סדר **מוצהר** נחשבת בייצור "לא פתירה" ב-`deriveEpisodeKeys` — פחות episodes מוכחים,
לעולם לא יותר (הכיוון השמרני של No Fake Certainty). זהה בכל הצרכנים (resolver, journal), ולכן
עקבי; לא תוקן כאן כי זה נוגע ב-`computePositions()` המוגן ובספירת Decision Independence הקפואה —
דורש החלטה ובדיקה נפרדות (האם להעביר את העמודות, ומה זה משנה על ההיסטוריה האמיתית).

### Evidence.description — מוצג כראיה עצמה, בלי מקור ובלי תיוג
**נמצא:** 2026-09-20 (ראיה `2ff448c6`: "למרות האמונה בחברה" — לא בתשובת המקור).
`description` נוצר ע"י ה-AI המייצר, נשמר `NOT NULL`, ומוצג ב-"View Evidence"
(dna/strategy/learning) **כשורה היחידה** — בלי טקסט התשובה המקורית ובלי סימון
"סיכום AI". **אף מסלול קוד לא קורא אותו**: grounding מקבל את `answerText`
בלבד, identity רק statements, הספירה רק `interviewAnswerId/stance/case key`,
ה-remediation כנ"ל, ו-prompts של cases/decisions/reviews מקבלים
`statementText`+tier בלבד; snapshots/bundles מצביעים על גרסאות, לא על ראיה.
לכן זו בעיית **תצוגה/provenance אנושית**, לא השפעה על חשיבה. תיקון עתידי:
להציג את קטע התשובה המקורית לצד התיאור, או לתייג כ"סיכום AI".
**עדכון 2026-09-30 (Frontend V1 יחידה 6A):** עמוד ה-DNA מתייג את התיאור כ"סיכום AI של הציטוט" ואומר
שהטקסט המקורי של תשובת ראיון אינו זמין במסך. **הפער שנשאר:** אין read path שמחזיר את `answer_text`
מאחורי ציטוט (אין procedure לתשובה לפי id או לכל התשובות של המשקיע), ולכן הצגת הקטע המקורי דורשת
procedure חדש — backend, לא frontend.

---
### ~~Decision Review — אין הגנה מפני הגשה כפולה, ו-Review+פתרון Predictions אינם טרנזקציה אחת (נמצא 2026-09-23)~~ — נבנה (Decision Review Integrity V1, 2026-09-24; ר' "נבנה")
**נמצא:** ב-architecture review של Open-Decision Monitoring V1: להחלטת LLY שני Review-ים זהים
(06.09 ו-07.09, אותו outcome) — `reviews.generate` ללא guard בצד שרת; בנוסף `insertDecisionReview`
ואז `resolvePrediction` לכל prediction רצים מחוץ לטרנזקציה אחת ובלי נעילת שורה (check-then-update),
כך ש-Review מקבילי שני יכול להשאיר Review שפתרון ה-predictions שלו נכשל. **מחוץ ל-scope של
Monitoring V1 בכוונה** (לא חסם את נכונותו). לתקן ביחידה נפרדת: טרנזקציה אחת + `FOR UPDATE` על
ה-predictions + הגנת double-submit.

### חוב זמני — החלטה עם תאריך בעבר מקפיאה מצב "עכשיו" (נמצא 2026-09-24)
`decisions.create` עם `decisionDate` בעבר: רק Prior Record נבנה PIT למועד ההחלטה. המחיר (`priceAtDecision`,
FMP טרי), `portfolioStateJson`/Portfolio Fit, Market Context, גרסאות DNA ו-Strategy — כולם מצב "עכשיו", וגם
`checkableByDate` מחושב מ-"עכשיו". לכן **אין לטעון שכל ה-DecisionSnapshot PIT-safe** רק כי התקציר כזה. תיקון
(הגבלת backdating, או שחזור PIT של כל הקלטים, או סימון מפורש) דורש דיון Product נפרד — לא נבנה.

### Roadmap אחרי Prior Record Brief V1 (נכתב 2026-09-24, overnight run)
1. ~~**Copilot משתמש ברקורד הקודם**~~ — נבנה כ-Prior Record → AI Decision Context V1 (ר' "נבנה"), בהיקף
   מצומצם בהכרעת Owner: Decision AI + Review בלבד; בלי Personal Fit; בלי מחירים/תוצאות/תוויות Review.
2. ~~**מעקב תנאי שקילה-מחדש**~~ — נבנה כחלק מ-Decision Follow-Through V1 (ר' "נבנה"): פתרון עצמאי + מקטע
   "תנאים פתוחים" בדשבורד (Pull). **לא** נוספה סיבת attention חמישית — ה-Monitoring הקפוא לא נגע (הכרעת Owner
   עדיין פתוחה אם רוצים כזו).
3. **Learning ממעבר מהסקטור בלבד** — Learning מורעב (0 insights; אין סקטור עם 2 החלטות שעברו Review):
   משפחות לפי טיקר/סוג החלטה ו-Learning מתקופות החזקה עם נימוק (Journal) — דורש הכרעת Owner מה נחשב
   ראיה עצמאית. **עדכון 2026-09-25:** "מה נחשב ראיה עצמאית" הוכרע (OD-1..OD-4, Evidence Reach V1, ר'
   "נבנה") והקשת Learning→DNA עובדת (OD-3); הקיבוץ עצמו עדיין לפי סקטור בלבד — פתוח.
4. ~~**קישור החלטה↔ביצוע מפורש**~~ — נבנה כחלק מ-Decision Follow-Through V1 (ר' "נבנה"): מועמדות מחושבות,
   אישור משקיע בלבד, append-only.
5. **Hardening:** מפתח Review ב-sessionStorage; בידוד `decision-monitoring.test.ts`; `getForCase` מחזיר undefined.

### הכרעות Owner — Evidence Reach V1 (הוכרעו 2026-09-25, OD-R1..OD-R5)
1. **OD-R1 — זהות תובנת Learning = (investor, family), זרם סינתזה אחד למשפחה ב-V1.** גרסה רק על שינוי טביעת
   מצב-הראיה האפקטיבי (`lef-v1`: החלטה/Review/stance — ר' `docs/data-model.md` §8); ניסוח בלבד = no-op מדווח.
   כמה תובנות עצמאיות באותה משפחה — **נדחה ל-Learning V2** (חוב מקובל).
2. **OD-R2 — החלטה אחת = מקרה אחד; `executed` משני episodes = איחוד labels** (רק דרך עובדות שהמשקיע אישר;
   ה-basis משחזר החלטה → עובדות → episodes → איחוד).
3. **OD-R3 — carry ל-DNA רק דרך הצהרות החלטה שעברו grounding מול ההשערה החדשה;** אין הצהרה מבוססת → fail-closed
   (בלי השערה/גרסה/ראיה/Correction).
4. **OD-R4 — `STALLED_CASE_DAYS = 14`, `REVIEW_WITHOUT_HORIZON_NUDGE_DAYS = 30`:** מדיניות דשבורד V1 בלבד,
   ניתנת לשינוי, לא אמפירית; קצה ±1 יום UTC/מקומי — חוב V1 מקובל.
5. **OD-R5 — `candidateDayTolerance = 1`** חלק מ-`independence-policy-v2`; רק UNRESOLVED, לעולם לא ראיה/מיזוג/ביטחון.
6. **OD-R6 — Grounding Semantics V3: סתירה דורשת ראיה חיובית** (הוקפא 2026-09-25 אחרי שהרגנרציה המפוקחת שמרה
   נימוק AVGO כסותר על בסיס שתיקה, `c478eba3` v1): `unsupported ≠ contradicting`, הצהרת החלטה = רשומה חלקית,
   נטייה ≠ "תמיד"; חוזים v3; remediation append-only עם provenance (ר' `docs/data-model.md` §2). **remediation
   מפוקחת (v3, AI אמיתי) עדיין לא רצה** — מועמדים: `c478eba3`/AVGO (חובה), `d5941418`/08860759 (חובה),
   `5cee68a2`/b865a5a2 (חובה), ושלוש הסתירות החיוביות (`7c3665ca`, `173720c6`, `3653aeed`) כדי ש-v3 יאשר
   אותן ולא יניח. **בוצע 2026-09-25 (v3, AI אמיתי, 14 קריאות):** `c478eba3` v2, `5cee68a2` v2, `173720c6` v2;
   `d5941418`, `7c3665ca` checked_no_change; `3653aeed` לא נכתב (קריאה #12 החזירה `contradicting` מחוץ ל-enum).
7. **OD-R7 — Grounding Semantics V3.1: תנאי-קדם מהותיים + strict tool** (הוקפא 2026-09-25): claim מותנה נתמך/נסתר
   רק כשההצהרה מבססת בעצמה את הטריגר; פעולה כש-הטריגר לא ידוע = NEITHER; citation-local; כלי grounding strict;
   כשל טכני ≠ unsupported (לא נכתב). **Revalidation מפוקחת V3.1 (AI אמיתי) עדיין לא רצה** — סט יעד מומלץ:
   `d5941418` (חובה — #4 אישר סתירה ללא טריגר), `173720c6` (חובה — v2 נשען על #11 מפוקפק; v2 נשמר כהיסטוריה),
   `3653aeed` (חובה — ניסיון חוזר **אחד** אחרי strict), `7c3665ca` (סימטריה: ציטוט SPCX תומך ב-"כל עוד
   המניה ממשיכה לעלות" בלי שהטקסט מבסס עלייה), `c478eba3` ו-`5cee68a2` (אחידות חוזה — תוצאה צפויה ללא שינוי).
   v3 v2-ים ושורות ה-check שלהם נשארים כפי שהם. **בוצע 2026-09-27 (v3-1, AI אמיתי, 14 קריאות, 0 כשלים טכניים,
   0 retries):** `d5941418` v2, `7c3665ca` v3, `3653aeed` v4; `c478eba3`, `5cee68a2`, `173720c6` = `no_op`.
   סקירה אחרי הריצה מצאה שלושה verdicts מפוקפקים על claims מורכבים — הובילה ל-V3.2 (OD-R8).
8. **OD-R8 — Grounding Semantics V3.2: claims מורכבים + שאלת הראיון כהקשר** (OD-V32-1..7, הוקפא 2026-09-27):
   התאמה חלקית = NEITHER; סמנטיקת AND / OR; מניע נדרש לתמיכה ולא לסתירה; התפקיד נקבע מניסוח ה-claim, עמום ⇒
   נדרש; atomicity ב-proposers; שאלת הראיון מגיעה לשער כ-`contextText`, הקשר בלבד. **Revalidation מפוקחת
   V3.2 (AI אמיתי) עדיין לא רצה.** סט יעד (ניתוח read-only דטרמיניסטי, 2026-09-27; 19 claims פעילים מבוססי-ראיה
   של המשקיע האמיתי: 6 atomic, 5 תנאי-קדם מורכבים לגיטימיים, 8 מורכבים-מדי/עמומים; אף אחד לא גלוי ל-AI, S מרבי 2):
   **מינימום לפי ארבעת הקריטריונים של V3.2 — 18 identities, 36 ציטוטים גולמיים** (33 תשובות ראיון, 3 הצהרות
   החלטה): DNA `01656115`, `5cee68a2`, `699cdb50`, `7c3665ca`, `ace307a1`, `afb0d5c4`, `c478eba3`, `cd9fcbe6`,
   `d5941418`, `e1239589`, `e4adb58e`; Strategy `0eb9807c`, `173720c6`, `3653aeed`, `39c061d0`, `5b64985b`,
   `646e7663`, `a48426b1`. **מומלץ לאחידות חוזה — כל ה-19, 38 ציטוטים** (33 תשובות ראיון, 5 הצהרות החלטה;
   מוסיף את `18524a79`: atomic, שתי הצהרות החלטה, נשפט רק תחת v2). אושר מחדש אחרי הבהרת ה-contrast
   (2026-09-27): 5 claims עם contrast עצמאי (`5cee68a2`, `7c3665ca`, `ace307a1`, `173720c6`, `3653aeed`), 3 עם
   contrast שמנסח-מחדש את ההתנהגות (`cd9fcbe6`, `5b64985b`, `646e7663`), 1 scope (`699cdb50`). לכל 38 הציטוטים יש טקסט מקור; לכל תשובת ראיון יש שאלה שמורה. אין לכלול תוצאות
   צפויות בשום בקשת מודל. עד שהריצה תושלם — לא להריץ `dna.generate` / `strategy.generateObserved` (ל-`ace307a1`
   ול-`3653aeed` S=2, C=0: case תומך אחד נוסף = `moderate`). **עודכן (2026-10-02, אומת קריאה-בלבד): בוצע
   2026-09-28** (v3-2, AI אמיתי, run `e5e459aa`): 19 זהויות, 38 שיפוטים ב-`grounding_judgments` (23 DNA, 15
   Strategy); 4 `new_version` (DNA `ace307a1` v2; Strategy `18524a79` v2, `3653aeed` v5, `646e7663` v2), 8
   `checked_no_change`, 7 `no_op` (כולל `173720c6`). ההגבלה "עד שהריצה תושלם" כבר לא חלה. דוח הריצה הסתיים
   ב-"C — OWNER REVIEW REQUIRED BEFORE CLOSURE"; ההמשך היה Compound Verdict Enforcement Review → SCS V2 → נדחה
   (ר' הסעיף שלו) והקפאת Backend Intelligence V1.
9. **OD-R9 — Grounding Judgment Audit Ledger (OD-V32-8; מומש 2026-09-27 — קוד + מיגרציה 0018 כתובה;
   המיגרציה **לא הוחלה** על ה-DB האמיתי):** `*_evidence_grounding_checks` שומרות `(version, evidence,
   verdict, reason, checked_at)` עם `UNIQUE(version, evidence)` ובלי חוזה; לכן `no_op` לא יכול היה להיכתב,
   ו-`checked_no_change` נכתב על גרסה שה-provenance שלה מציין חוזה ישן. **נבנה:** טבלת append-only
   `grounding_judgments` — יומן ביקורת בלבד, `UNIQUE(run_id, evidence_id)`, לעולם לא נקראת לחישוב effective
   evidence (ר' `docs/data-model.md` §2). חלופה שנדחתה: עמודת `contract` + הרחבת ה-UNIQUE בטבלאות ה-check —
   משנה את משמעות הטבלה שממנה נגזר effective evidence. **סדר פריסה בטוח:** (1) checkpoint ב-Git ל-V3.2 +
   OD-R9; (2) החלת מיגרציה 0018 על ה-DB האמיתי (תוספתית; הוכחה על clone: 34 טבלאות ו-10,117 שורות זהות
   byte-for-byte, ledger 18 → 19); (3) רק אז ה-revalidation המפוקחת של V3.2 דרך
   `applyDnaGroundingRemediation` / `applyStrategyGroundingRemediation` עם `run_id` אחד לריצה. **חוב שנשאר:**
   אין backfill לשיפוטי v2/v3/v3-1 (בכוונה); אין רשומת כשל ברמת-ריצה (כשל טכני מדווח ע"י ה-runner ולא נכתב);
   ה-runner המפוקח עצמו לא נבנה. **עודכן (2026-10-02, אומת קריאה-בלבד):** מיגרציה 0018 הוחלה על ה-DB האמיתי
   (ledger: 20 רשומות, 0000–0019; הטבלה `grounding_judgments` קיימת), וה-revalidation של V3.2 נכתבה דרכה ב-2026-09-28
   עם `run_id` יחיד (`e5e459aa`). אין בקוד המוצר runner מפוקח.
**חוב V1 מקובל (נשאר):** גרסאות Learning ישנות בלי provenance מקבלות טביעה משורות ה-identity (re-baseline
חד-פעמי, append בלבד); ריצת generate שהמודל לא הציע בה דבר לא משאירה עקבה (ה-nudge "צור מחדש" נשאר);
Learning עדיין מקובץ לפי סקטור; הצהרות החלטה נכנסות ל-DNA/Strategy רק ביצירה מחדש; שתי שורות
`source_learning_insight_id` היסטוריות (סינתטיות) נשארות; מיגרציה 0017 חייבת להיות מוחלת לפני פריסת הקוד.

### Structured Claim Semantics V2 (SCS V2) — נדחה, לא נבנה (הוכרע 2026-09-30)
**מה זה:** ניסוי מחקרי (מחוץ ל-repo, בלי שום כתיבה ל-DB או ל-Git) לפירוק claim של DNA/Strategy למבנה רכיבים
מאומת, כדי שה-AND/OR של V3.2 ייאכף בקוד. **שום חלק ממנו אינו בייצור** — אין מיגרציה `0019`, אין טבלאות, אין
חוזה AI חדש; ה-grounding נשאר V3.2 בלבד, והחוזים הניסיוניים אינם ארכיטקטורה קנונית.

**מה נמדד:** מול reference חיצוני (74 leaves, 73 נוקדו) המודל השני (Atomicity Auditor) הסכים ב-71/73, אבל
מתוך 6 leaves עם joining אמיתי נתפסו 4 בלבד. שני הפספוסים היו false accept על claims אמיתיים בעברית, גם
ה-structurer וגם ה-auditor פספסו אותם, והמבנה שלהם נשאר "אוטומטי". `UNCERTAIN` לא הוחזר אף פעם.

**הכרעות Owner (נעולות):** verdict של מודל (`ATOMIC`) לעולם אינו סמכות לרישוי מבנה; אין רישוי אוטומטי — רק
אישור Owner למבנה הקנוני השלם, קשור ל-hash של טקסט ה-claim ושל המבנה; שימוש חוזר רק בזהות מדויקת; claim בלי
רישיון תקף נשאר ב-V3.2. ה-Structured Gate תוכנן כמסנן **נוסף** אחרי V3.2, ל-support בלבד (contradiction נשאר
V3.2), בריצות revalidation מפוקחות בלבד, עם guard: אם התוכנית המובנית נותנת S גבוה יותר, C נמוך יותר או tier
גבוה יותר מתוכנית V3.2 — V3.2 גובר. ציטוט רכיב מאומת כ-substring מדויק, בלי normalization.

**למה נדחה:** החלטת ערך מוצרי, **לא** הוכחת בטיחות ולא דחיית הארכיטקטורה. בנתונים האמיתיים: 3 claims ניתנים
לרישוי, כל אחד S=1, C=0; S מרבי בכל 19 ה-claims נושאי-הראיות הוא 2; אף tier לא יכול להשתנות היום. **אין להסיק
מהדחייה שרישוי סמנטי אוטומטי הוכח בטוח** — הניסוי הראה את ההפך.

**טריגר לפתיחה מחדש (לא לפי לוח שנה):** claim רלוונטי נושא-ראיות מגיע ל-S ≥ 3, או החלטת Owner מפורשת.

**איפה הראיות:** `scratch/experiment-archive/scs-v2/` — tar אחד + `MANIFEST.sha256` + `ARCHIVE.json`, קריאה
בלבד, 315 קבצים, כולל ה-reference החיצוני וראיות Stage 3. מקומי ו-ignored: **`git clean -fdx` מוחק אותו**.
עותק disaster-recovery מוצפן/offline — פתוח. ההכרעות ותכנון ה-Structured Gate שנעשו **אחרי** הארכוב אינם
בתוך ה-tar; הסיכום כאן הוא הרישום המחייב שלהם.

### Decision Independence — "אפקט הגשר": הסרת ציטוט תומך יכולה להעלות את S (נמצא 2026-09-30)
**נמצא** בהרצה טהורה (בלי DB, בלי AI) של `assessCitations` תוך כדי תכנון ה-Structured Gate. קבוצות עצמאות
נבנות רק מה-labels של הציטוטים **שנספרים**. ציטוט שמחבר שני ציטוטים אחרים (אותו episode עם אחד, LinkFact
מאושר עם השני) מאחד את שלושתם לקבוצה אחת; כשהוא מוסר — למשל כי grounding דחה אותו — הקבוצה מתפצלת. נמדד:
שלושה ציטוטים תומכים נותנים S=1, ובלי האמצעי S=2; עם קצה סותר, S=0/C=1 הופך ל-S=1/C=1. אותו היגיון חל על
weak edges (לא נמדד).

**משמעות:** דחיית ראיה יכולה להעלות ביטחון — הפוך מ-No Fake Certainty. התלות בין שני הקצוות קיימת בעובדות גם
כשהציטוט המחבר לא נספר, אבל הספירה לא רואה אותה. קיים ב-V3.2 מאז Decision Independence V1; לא נגרם ע"י SCS.
`calculateEvidenceStrength` עצמו מונוטוני (נבדק על 115,351 זוגות, 0 הפרות).

**למה לא תוקן:** נוגע בספירה הדטרמיניסטית הקפואה (`src/lib/evidence/resolve-independence.ts`) ובגרסאות שכבר
נשמרו; דורש הכרעת Owner ויחידה נפרדת. **לא חוסם את Frontend V1.** לא נבדק אם קיים מקרה כזה בנתונים האמיתיים.

### Investment Case — תיק שהוחלט עדיין ניתן לכתיבה בצד השרת (נמצא 2026-09-30)
**נמצא** בחקירת Frontend V1 יחידה 3 (תיק מחקר). `cases.fetchMarketIntelligence`, `cases.generatePersonalFit`
ו-`cases.generateSynthesis` (`src/server/routers/cases.ts`) לא בודקים `status === "researching"` — רק בעלות.
קריאה ישירה אליהם על תיק שכבר הוחלט דורסת את השדות החיים של השורה (`updateInvestmentCase`), בניגוד ל-
`docs/data-model.md` §10 ("InvestmentCase Mutable רק while researching"). `decisions.create` כן בודק.

**מה כן מוגן:** העותק הקפוא (`investment_case_snapshot_json` ב-Snapshot) לא מושפע; ה-Snapshot, ה-Review
וה-Prior Record קוראים רק אותו. הנזק האפשרי: עמוד התיק עצמו מציג תוכן חי שנוצר אחרי ההחלטה.

**מה נעשה ביחידה 3:** ה-UI מסתיר את פעולות הרענון/היצירה בתיק שהוחלט ומפנה לרשומת ההחלטה. **לא** תוקן
ב-backend (Backend Intelligence V1 קפוא). מועמד ל-hardening: אותו guard של `decisions.create` בשלושת
ה-procedures, עם טסט. דורש יחידה נפרדת.

### Ideas — `ideas.promote` אינו idempotent ואינו טרנזקציוני (נמצא 2026-09-30)
**נמצא** בחקירת Frontend V1 יחידה 5 (מחברת רעיונות). `ideas.promote` (`src/server/routers/ideas.ts`) בודק
בעלות בלבד: יוצר Case עם `idea_id` ואז מעדכן את `promoted_to_case_id` של הרעיון, בשתי כתיבות נפרדות בלי
טרנזקציה. אין בדיקה שהרעיון כבר קודם, ואין אילוץ ייחודיות על `investment_cases.idea_id`.

**השלכה:** קריאה חוזרת (retry, שתי לשוניות) או שתי קריאות במקביל יוצרות Case נוסף לאותו רעיון, והרעיון
מצביע רק על האחרון; כשל בין שתי הכתיבות משאיר Case עם `idea_id` ורעיון בלי קישור. בנתונים האמיתיים
(2026-09-30): 0 קישורים שבורים, 0 רעיונות עם יותר מ-Case אחד.

**מה נעשה ביחידה 5:** ה-UI מציג את הפעולה רק לרעיון שלא קודם, חוסם לחיצה כפולה לכל רעיון
(`useSubmitGuard`) ומשבית בזמן ההמתנה. **לא** תוקן ב-backend (Backend Intelligence V1 קפוא).
מועמד ל-hardening: להחזיר את ה-Case הקיים כשהרעיון כבר קודם, לעטוף את יצירת ה-Case ועדכון הרעיון
בטרנזקציה אחת, והגנת ייחודיות מתאימה — באותו דפוס של `cases.createFromCondition` (אינדקס ייחודי חלקי +
fallback על unique violation). דורש יחידה נפרדת.

### DNA ו-Strategy — פערי backend שנמצאו בחקירת Frontend V1 יחידה 6 (נמצא 2026-09-30)
תיעוד בלבד, **לא תוקן** (Backend Intelligence V1 קפוא). כל פריט דורש יחידה נפרדת:
1. ~~**`dna.evidence` בלי scoping לבעלות**~~ — נבנה (Production Readiness Unit 3A, 2026-10-05; ר' "נבנה").
2. ~~**`dna.reject` בלי scoping לבעלות**~~ — נבנה (Production Readiness Unit 3A, 2026-10-05; ר' "נבנה").
3. ~~**`strategy.evidence` בלי scoping לבעלות**~~ — נבנה (Production Readiness Unit 3A, 2026-10-05; ר' "נבנה").
4. **אין read path לגרסאות Strategy היסטוריות** — `getStrategyVersionPrinciples` קיים ב-repository בלבד; אין
   procedure שמחזיר bundles קודמים או את העקרונות שבהם. עמוד ה-Strategy יכול לומר שגרסאות קודמות נשמרות,
   לא להציג אותן.
5. **`strategy.confirmDeclared` על ניסוח שכבר קיים** — **תוקן התיאור ביחידה 6B (אומת מול הקוד):**
   `slugifyPrincipleKey` מוסיף לכל key סיומת אקראית (`randomUUID().slice(0, 8)`), ולכן `UNIQUE(investor_id, key)`
   **לא** נתפס. אישור חוזר של אותו ניסוח (שתי לשוניות, retry, או הצעה חוזרת מהראיון) יוצר **בשקט עיקרון
   מוצהר שני זהה**, בלי שגיאה. עמוד ה-Strategy לא מציע אישור למועמד שהניסוח שלו זהה לעיקרון מוצהר קיים,
   וחוסם לחיצה כפולה לכל מועמד — זו ההגנה היחידה כרגע. מועמד לתיקון: בדיקת ניסוח קיים בצד השרת לפני
   insert (או key דטרמיניסטי לניסוח).
6. **עקרונות Observed מטשטשים את הגבול מול DNA** — אותו מנוע, אותם מקורות, אותה עצמאות; הם טענות על דפוס,
   לא כללים שהמשקיע בחר, אבל מוצגים תחת Strategy. דורש הכרעת Owner היכן הם שייכים.
7. **ל-`dna.list` אין סדר מוגדר** — `listActiveDnaHypothesesForInvestor` בלי `orderBy`; העמוד שומר את הסדר
   המוחזר ולא מתאר אותו כסדר כרונולוגי או כדירוג.
8. **טענות DNA שנדחו לא ניתנות לרשימה או לשחזור** — `dna.reject` חד-כיווני; אין procedure שמחזיר טענות
   `user_rejected` ואין פעולת שחזור. עמוד ה-DNA אומר זאת לפני האישור.

### Strategy — הכרעות Owner וסגירת שרשרת ה-grounding (2026-10-02)
שחזור קריאה-בלבד (2026-10-02) הוכיח את השרשרת: אבחון (2026-09-16) → החלטת ארכיטקטורה → מימוש (`856e35a` ואילך,
כלול ב-`1051d8e2`) → מיגרציות 0009 ו-0018 מוחלות → remediation אמיתי (V3, V3.1, V3.2) → הכרעת זוג ה-identities
(להשאיר נפרדים; אין שינוי נתונים) → אימות (`no_op` / replay) → הקפאת Backend Intelligence V1.

1. **Owner Decision 1 (2026-10-02): A.** בנוסח ההכרעה:
   > Accept the currently persisted `unsupported` exclusion of evidence `d29a3897` on principle `173720c6` (v2).
   > Audit trail: on 2026-09-18 the Owner ruled "retain as valid contradicting evidence". On 2026-09-25 the
   > Owner authorized V3 remediation of `173720c6`, then instructed to preserve v2 as historical truth and
   > described its unsupported verdict as conservative. V3, V3.1 and V3.2 returned `unsupported` (V3 flagged it
   > QUESTIONABLE). The exclusion is accepted as the system's conservative persisted state; it is not a finding
   > that the 2026-09-18 reading was mistaken. No data write and no Owner-override mechanism is required.
2. **Owner Decision 2 — אישור StrategyVersion חדשה: DEFERRED, עד בדיקת מסלול ה-AI של Decision Review.**
   גרסאות Strategy מאושרות 1 ו-2 (2026-08-17) מצמידות עדיין את גרסאות ה-v1 המקוריות, מלפני ה-grounding; אף גרסת
   remediation לא מוצמדת; שלוש ההחלטות האמיתיות הקפיאו את גרסה 2. **תוצאת הבדיקה (2026-10-02, קריאה-בלבד, בלי AI):**
   הצרכנים היחידים של bundle מוצמד הם `decisions.create` (bundle המאושר האחרון) ו-`reviews.generate` (ה-bundle
   שהוקפא ב-snapshot, `src/server/routers/reviews.ts:177`). שניהם מסננים ב-`excludeInsufficientEvidence` לפני
   קריאת ה-AI (`decisions.ts:155`, `reviews.ts:183`) ומעבירים למודל `statementText`, `principleType`,
   `evidenceStrength`. לשלוש ההחלטות, וגם לסט הגרסאות העדכניות, עוברות אותן 6 גרסאות בדיוק (לפי מזהה: 4
   validated + 2 declared); כל ה-observed הן `insufficient_evidence`. **כיום ה-bundle הישן לא משנה שום קלט AI
   באף מסלול.** אישור חדש לא ישנה Review של החלטה קיימת (Review קורא את ה-bundle שהוקפא ב-snapshot); הוא משנה רק
   את מזהה ה-StrategyVersion שהחלטות חדשות רושמות, את ספירת ה-drift בעמוד ה-Strategy ואת ניסוח "גרסה חדשה
   יותר אושרה" ברשומות החלטה קיימות. Learning ו-Personal Fit לא קוראים bundles.
3. **עובדה — Personal Fit קורא גרסאות עדכניות, לא את ה-bundle המאושר** (`cases.generatePersonalFit` →
   `listStrategyPrinciplesForInvestor`). `excludeInsufficientEvidence` מסנן רק `insufficient_evidence`: `weak`,
   `moderate`, `strong` ו-`null` (declared / validated) עוברים. עיקרון observed שגרסתו העדכנית מגיעה ל-`weak` ומעלה
   ייכנס ל-Personal Fit גם אם מעולם לא הוצמד ל-StrategyVersion שה-Owner אישר, וה-UI לא מציג סטטוס אישור. לא פעיל
   כיום (כל ה-observed הן `insufficient_evidence`). לבחון מחדש לפני שעיקרון observed כלשהו מגיע ל-`weak`.
4. **עובדה — אין מנגנון Owner-override / הכרעה אנושית ל-verdicts של grounding.** שורות
   `*_evidence_grounding_checks` שומרות `verdict` (`supported` / `unsupported`), `reason` ו-`checked_at` בלבד, בלי
   actor ובלי מקור; גרסת remediation נרשמת `system_grounding_revalidation`; `grounding_judgments` דורשת
   `model` / `contract` / `semantic_rule`; effective evidence נגזר מה-checks בלבד ו-`corrections` לא נקרא בגזירה.

### יומן וראיון — פערי backend שנמצאו בחקירת Frontend V1 יחידה 7 (נמצא 2026-09-30)
תיעוד בלבד, **לא תוקן** (Backend Intelligence V1 קפוא). כל פריט דורש יחידה נפרדת. ממצאי Import נדחו
ליחידה 7B.
1. **`interview.answer` אינו idempotent** — כל קריאה מוסיפה שורה. שליחה כפולה (retry, שתי לשוניות, תגובה
   שאבדה) יוצרת שתי תשובות נוכחיות לאותו anchor; שתיהן גלויות ל-AI ונספרות כמקרה עצמאי אחד. יחידה 7A חוסמת
   לחיצה כפולה בכל שורה (`useSubmitGuard`), משביתה בזמן ההמתנה ומרעננת את היומן גם אחרי כשל — הגנת UX בלבד,
   לא ערובת שלמות. מועמד לתיקון: מפתח idempotency לשליחה. בנתונים האמיתיים (2026-09-30): 0 anchors עם יותר
   מתשובה נוכחית אחת.
2. **ראיון מודרך — PIT/hindsight** — `interview.start` מעביר למודל את `describeTransactionFacts`
   (`src/lib/ai/interview.ts`), שכולל תשואה ממומשת, רווח/הפסד וימי החזקה, ו-prompt שמבקש שאלה ספציפית;
   הקטגוריות עצמן (`biggest_gain`, `biggest_loss`, `longest_hold`, `quickest_flip`) נגזרות מהתוצאה. טקסט
   השאלה נשמר verbatim ב-`interview_answers.question_text` ומועבר לשער ה-grounding כהקשר. בנתונים האמיתיים
   (2026-09-30): מתוך 6 שאלות מודרכות שמורות, 1 כוללת אחוז ומילת רווח/הפסד, 2 כוללות מילות משך החזקה.
   לכן יחידה 7A לא כללה את `/interview`. התיקון העתידי צריך לבנות עובדות **ביחס לעוגן הפעולה ההיסטורית**, לא
   "עובדות כניסה" באופן גורף: שאלה על BUY מקבלת רק מה שהיה ידוע עד ה-BUY; שאלה על SELL מקבלת רק מה שהיה
   ידוע עד ה-SELL; כלל מקביל לכל פעולה אחרת. זה שינוי חוזה AI ודורש review נפרד.
   **טופל ב-Unit 7C-B (backend):** בחירה מבנית, הקשר נקודת-זמן לפי עוגן הפעולה, `interview_question_pit_v1`
   מעל `factsLine` בלבד, validator דטרמיניסטי ו-fallback; שאלות legacy נשארות בטבלה ומוסתרות מכל צרכן AI.
   ה-UI של `/interview` עובר רק התאמה מינימלית; העיצוב ביחידה 7C-F.
3. **ראיון מודרך — session נוצר לפני יצירת השאלות ב-AI** — כשל AI ב-`interview.start` משאיר session
   `in_progress` בלי תשובות, ואין resume, רשימת sessions או ניקוי. `startTellMeWhy` פותח session גם הוא לפני
   שנכתבת תשובה; יחידה 7A משתמשת מחדש ב-session שנפתח כשהכותב נסגר ונפתח שוב. בנתונים האמיתיים
   (2026-09-30): 0 sessions בלי תשובות. **Unit 7C-B:** `interview.start` יוצר את ה-session רק אחרי שכל
   השאלות נוצרו; `startTellMeWhy` עדיין פותח session לפני התשובה (נשאר פתוח).
4. **שרשרת תשובות שהוחלפו אינה נגישה דרך router** — `getAllAnswersForInvestor` מחזיר ראשי שרשרת בלבד, ואין
   procedure שמחזיר תשובה שהוחלפה. היומן אומר שהתשובה הקודמת נשארת ברשומה ואינה ניתנת לעיון כאן; לא נבנה
   דפדפן היסטוריה.
5. **remediation של grounding נכשל סגור על ציטוט של תשובה שהוחלפה** — `planGroundingRemediation`
   (`src/lib/dna/remediate-grounding.ts`, ובמקביל `src/lib/strategy/remediate-grounding.ts`) מחזיר
   `technical_failure` כשטקסט המקור חסר ב-`answerTextById`, וכל הטוענים ברמת ה-router בונים את המפה מראשי
   שרשרת בלבד. latent: אין כיום קורא לתכנון, ובנתונים האמיתיים 0 ציטוטים של תשובה שהוחלפה. תיקון: לבנות את
   המפה מכל התשובות של המשקיע, כולל שהוחלפו.
6. **`transactions.notes` אינו מוצג ביומן** — אין שדה notes בחוזה `interview.journal`; בנתונים האמיתיים
   (2026-09-30) 138 עסקאות עם notes. הצגה תדרוש הרחבת החוזה והכרעה שהערה כללית אינה נימוק.
7. **מקור התשובה (ראיון מודרך או "ספר לי למה") אינו בחוזה היומן** — `getAllAnswersForInvestor` מחזיר
   `origin`, אבל `EpisodeAnswerInput` לא מצהיר עליו, ולכן היומן לא מציג אותו. מוצגות השאלה שעליה נענתה
   התשובה והתאריך. הצגה תדרוש הוספת השדה לחוזה. **Unit 7C-B:** `question_provenance` נשמר על כל תשובה
   ועובר ב-`EpisodeAnswerInput`; ההצגה ב-Journal שייכת ל-7C-F.

### ייבוא — פערי backend שנמצאו בחקירת Frontend V1 יחידה 7 (נמצא 2026-09-30)
תיעוד בלבד, **לא תוקן** (Backend Intelligence V1 קפוא). כל פריט דורש יחידה נפרדת.
1. **יתרות פתיחה נכתבות אחרי הטרנזקציה של הייבוא** — `import.confirmImport` מריץ את
   `confirmTransactionsWithOrdering` (טרנזקציה אחת: נעילות, התאמה, סדר, batch, הכנסה), ורק אחרי ה-commit
   מכניס את יתרות הפתיחה אחת-אחת, מחוץ לטרנזקציה. כשל באמצע משאיר עסקאות שמורות ויתרות פתיחה חלקיות, והלקוח
   מקבל שגיאה כללית (לא `BAD_REQUEST`) שלא אומרת מה נשמר. יחידה 7B מסווגת כשל כזה כ"ייתכן שחלק נשמר", מבקשת
   לרענן לפני ניסיון נוסף וחוסמת את האישור עד הרענון. תיקון: להכניס את יתרות הפתיחה לאותה טרנזקציה.
2. **אין אילוץ ייחודיות על `portfolio_opening_states`, והאחרונה לכל טיקר גוברת** — `computePositions`
   (`src/lib/portfolio/positions.ts`) מציב יתרת פתיחה לפי טיקר ב-`Map.set`, כך שיתרה שנייה לאותו טיקר מחליפה
   בשקט את הראשונה. אישור חוזר אחרי כשל חלקי (פריט 1) מכניס את יתרות הפתיחה שוב, בעוד שעסקאות זהות מדולגות
   ככפילות מדויקת. בנתונים האמיתיים (2026-09-30): 0 יתרות פתיחה.
3. **הקובץ הגולמי, המיפוי וסיכום ההתאמה אינם נשמרים** — נשמרים רק העסקאות (כולל notes מהקובץ) ושורת
   `import_batches` (שם קובץ, זמן, `row_count`). אי אפשר לשחזר אחר כך איך קובץ פורש או אילו שורות דולגו.
   עמוד הייבוא אומר זאת במפורש.
4. **הערכים `processing` ו-`failed` ב-`import_batch_status` אינם בשימוש** — ברירת המחדל של העמודה היא
   `processing`, אבל ה-batch היחיד שנכתב נוצר בתוך הטרנזקציה עם `status: "completed"`, וייבוא שנכשל לא משאיר
   batch. אין מצב ביניים או כישלון גלוי.
5. **ייבוא חוזר של קובץ שכבר יובא יוצר batch עם 0 שורות, והוא הופך ל"ייבוא האחרון"** — `row_count` הוא מה
   שנוסף בפועל, ולכן `import.history.latestBatch` מציג אחרי ייבוא חוזר קובץ עם 0 שורות שנוספו. עובדתית נכון,
   אבל מסתיר את הייבוא שהוסיף את השורות. יחידה 7B מציגה את המספר כפי שהוא.
6. **פיצול כפול** — `recordStockSplit` מתרגם את הפרת הייחודיות ל-`BAD_REQUEST` באנגלית ("A split for this ticker
   on this date is already recorded."), לא לשגיאה גולמית. העמוד מציג אותה כסירוב שלא שמר דבר; ההודעה עצמה
   נשארת באנגלית.

### Production Readiness Unit 2C — פגיעויות Next.js שנדחו ע"י upstream, וחוב תלויות dev (נמצא 2026-10-04)
- **פגיעויות שלא תוקנו ב-16.3.8:** בגרסת האבטחה של 2026-09-30 Next.js דחה שתי
  פגיעויות (אחת critical, אחת high) לתיאום upstream; הן **אינן** מתוקנות ב-`16.3.8`
  ואינן מופיעות עדיין ב-`npm audit`. **הקלה כרגע:** `dev` ו-`start` נקשרים ל-`127.0.0.1`
  בלבד (`-H 127.0.0.1` ב-`package.json`), כך שהשרת אינו נגיש מהרשת.
- **פעולה:** לשדרג `next` ו-`eslint-config-next` ברגע שמשתחררת גרסת האבטחה הבאה של
  Next.js עם התיקונים, ואז להריץ מחדש את אימות Unit 2C (typecheck, lint, build, חבילת
  הטסטים המלאה מול DB טסטים מורשה, הוכחת הקשירה ל-loopback ובדיקת עשן).
- **חוב נפרד — ממצאי `npm audit` ב-dev בלבד (14 ממצאים, 0 critical):** `undici`,
  `js-yaml`, `vitest`/`@vitest/mocker` (יש תיקון שאינו שובר), ושרשראות
  `eslint-config-next` (`brace-expansion`/`braces`/`micromatch`/`fast-glob`) ו-`drizzle-kit`
  (`esbuild`) שאין להן תיקון שמיש (npm מציע downgrade). נדרשת יחידת hygiene
  נפרדת לתלויות; לא נעשה ב-Unit 2C.

### ~~בדיקות — `getGroundingChecksForDnaHypothesisVersion` ללא ORDER BY; טסט משווה סדר (נמצא 2026-10-04)~~ — נבנה (Unit 4/B, 2026-10-05; ר' "נבנה")
- **מה:** `src/db/repositories/evidence.ts:70-77` מחזיר שורות `dna_evidence_grounding_checks` בלי `ORDER BY`, ושתי שורות שנכתבו יחד חולקות `checked_at` (transaction time) ו-`id` אקראי. `tests/integration/grounding-context-v3-2.test.ts:181,207` משווים את התוצאה ב-`toEqual` על מערך, כלומר דורשים סדר. נצפה פעם אחת בריצה סדרתית מלאה (1668/1669), עבר 10/10 בבידוד.
- **סיווג:** תלות סדר קיימת מראש, לא קשורה ל-Unit 2C (הקוד והטסט קודמים ל-`79cdaea`).
- **כיוון תיקון (יחידה נפרדת, לא בוצע):** מיון דטרמיניסטי בטסט (למשל לפי `id`) או `ORDER BY checked_at, id` ב-repository. אם הצרכנים בקוד הייצור תלויים בסדר — לבדוק לפני שינוי ה-repository.

### ~~חבילת האינטגרציה אינה בטוחה להרצה מקבילית מול DB טסטים אחד (נמצא 2026-10-04)~~ — נבנה (Unit 4/D, 2026-10-05; ר' "נבנה")
- **מה:** `vitest run` מריץ קבצים במקביל (אין `fileParallelism`/`pool` ב-`vitest.config.ts`), וכל קבצי `tests/integration/**` חולקים DB טסטים אחד בלי בידוד לכל קובץ. בהרצה מקבילית מלאה: 6 כשלים ו-20 דילוגים (timeouts של hook/טסט, והשוואות ספירת טבלה שלמה, למשל `decision-monitoring.test.ts:253`, `decision-follow-through-adversarial.test.ts:247`). בהרצה סדרתית (`--no-file-parallelism`): 1668/1669.
- **למה חשוב:** הרצה "רגילה" של `npm test` עלולה להיכשל בלי באג בקוד.
- **כיוון (יחידה נפרדת, לא בוצע):** לקבע סדרתיות לקבצי האינטגרציה (project נפרד בהגדרות Vitest או דגל ב-script), או בידוד DB/סכמה לכל קובץ; ולתעד ב-README באיזו צורה רצה ה-baseline.

### בקשת Owner — השלמה אוטומטית לטיקר בפתיחת תיק/רעיון (נמצא 2026-10-04)
- **מה:** בשדה "טיקר" (תיק חדש / רעיון) להציע טיקרים ושם חברה תוך כדי הקלדה.
- **לפני בנייה להחליט:** מקור הנתונים (חיפוש סמלים של FMP עם debounce ו-cache, מול רשימת סמלים מקומית שמתעדכנת מדי פעם), מגבלות קצב של FMP, ומה מוצג כשאין התאמה.
- **לא נבנה:** מחוץ ל-Production Readiness; יחידת פיצ'ר נפרדת אחרי סגירת Target A.

### ~~בדיקות — טסט התנגשות אישורי Strategy אינו מבטיח חפיפה (נמצא 2026-10-04)~~ — נבנה (Unit 4/C, 2026-10-05; ר' "נבנה")
- **מה:** `tests/integration/strategy-repository.test.ts:84` מצפה ששני אישורים "בו-זמניים" יתנגשו (אחד מצליח, אחד נדחה). בריצה סדרתית מלאה במסגרת Unit 2B (S2) שניהם הצליחו: נוצרו גרסאות 1 ו-2 בהפרש של 17ms, כלומר הטרנזקציות רצו ברצף. האילוץ `strategy_versions_investor_id_version_number_unique` קיים, כך שהאינווריאנט (אין מספר גרסה כפול) נשמר.
- **סיווג:** טסט תלוי-תזמון, לא באג בקוד ולא קשור לרוטציית הסיסמה.
- **כיוון (יחידה נפרדת, לא בוצע):** לכפות חפיפה דטרמיניסטית בטסט (למשל החזקת טרנזקציה פתוחה או מחסום בין שתי הקריאות), או לבדוק את האינווריאנט עצמו במקום לצפות להתנגשות.

### תצוגה — Div yield מוצג כמספר גולמי בתמונת השוק (נמצא 2026-10-04)
- **מה:** בדף תיק המחקר, בסקשן "תמונת שוק", Div yield מוצג כיחס גולמי (למשל `0.0031766` ל-AAPL) במקום אחוז (0.32%).
- **כיוון (תיקון תצוגה קטן, לא בוצע):** לעצב כאחוז דרך `<Num>`. Frontend V1 סגור, ולכן זה דורש אישור Owner כתיקון באג.

### תצוגה — שווי שוק מוצג בכל הספרות (נמצא 2026-10-04)
- **מה:** באותו סקשן, שווי שוק מוצג כ-`$4,901,023,823,640`. נכון, אבל קשה לקריאה.
- **כיוון (לא בוצע):** תצוגה מקוצרת (למשל `$4.90T`) עם הערך המלא ב-tooltip, באותו תיקון כמו Div yield.

### קריאות AI — מה שנשאר פתוח אחרי Unit 3B (נמצא 2026-10-05)
תיעוד בלבד, **לא תוקן**. כל פריט דורש יחידה נפרדת.
1. **אין ביטול של קריאת AI כשהמשתמש סוגר את העמוד** — אף קריאה לא מעבירה `signal`, וה-procedure לא מקבל
   את ה-abort של הבקשה. קריאה שהתחילה רצה עד סופה או עד ה-timeout (עד ~10 דקות עם retry אחד) וממשיכה
   לכתוב גם אם אף אחד כבר לא מחכה לתשובה. גם ב-`interview.start` (עד 6 קריאות במקביל ב-`Promise.all`)
   כשל אחת לא מבטל את השאר.
2. **אין מגבלת קצב או תקציב לקריאות AI** — אין מונה קריאות/טוקנים, אין חסימה של לחיצה חוזרת בצד השרת ואין
   תקרת עלות. `dna.generate` ו-`strategy.generateObserved` מריצים קריאת grounding לכל ציטוט וקריאת identity
   לכל השערה, ברצף, כך שמספר הקריאות גדל עם כמות הראיות.
3. **כתיבות חלקיות ב-procedures מרובי-קריאות** — `learning.generate` קורא ל-AI וכותב לכל משפחת סקטור
   בתורה; כשל באמצע משאיר את המשפחות הקודמות שמורות. `decisions.create` שומר cache של נתוני שוק ו-market
   context לפני קריאת ה-AI (ההחלטה עצמה נשמרת רק בטרנזקציה אחרי הקריאה); `cases.generateSynthesis`,
   `cases.generatePersonalFit` ו-`reviews.generate` עשויים לשמור cache של נתוני שוק לפני הקריאה. הודעת ה-timeout
   של Unit 3B אומרת זאת לכל procedure.
4. **timeout בבדיקות grounding/identity שקט** — `checkEvidenceGrounding` ו-`classifyHypothesisMatch` בולעים כל
   שגיאה (fail closed): grounding שנכשל מסומן `technicalFailure` ולא נספר; identity שנכשל נופל ל**זהות חדשה**,
   כך ש-timeout יכול לייצר השערה/עיקרון כפולים. ב-`learning.agree`, אם כל בדיקות ה-grounding נכשלו טכנית, המשתמש
   מקבל "None of the cited decisions' own statements ground this insight" — לא הודעת timeout.
5. ~~**`interview.start` מציג הודעה כללית**~~ — נבנה (Unit 4/F, 2026-10-05; ר' "נבנה"). המקור: — `interview-view.tsx` מציג `t.startFailed` ולא את הודעת השרת, כך
   שהודעת ה-timeout של Unit 3B לא מגיעה למשתמש בעמוד הזה (בשאר העמודים היא מוצגת דרך `ActionError`).

### ~~בדיקות — ניקוי DBs בטסט השומר אינו עמיד ל-timeout (נמצא 2026-10-05)~~ — נבנה (Unit 4/D, 2026-10-05; ר' "נבנה")
- **מה:** `tests/integration/test-database-guard.test.ts` יוצר DBs זמניים (`aic_test_scratch_unmarked_*`, `aic_test_drop_probe_*`) ומוחק אותם ב-`finally`. כשהטסט נקטע ב-timeout (ריצה עמוסה), הניקוי לא רץ וה-DBs נשארים. קרה פעמיים: 2026-10-04 (2C) ו-2026-10-05 (3B); בכל פעם נמחקו ידנית באישור Owner.
- **כיוון (לא בוצע):** ניקוי עמיד, למשל `afterAll` או global teardown שמוחק DBs עם הקידומות האלה שנוצרו בריצה הנוכחית.

### ~~ארכיטקטורה — `trpc.ts` מייבא את `src/lib/ai/client.ts` (נמצא 2026-10-05)~~ — נבנה (Unit 4/E, 2026-10-05; ר' "נבנה")
- **מה:** כדי לקבל את `aiTimeoutMessage`, `src/server/trpc.ts` מייבא את `client.ts`, שבזמן הייבוא בודק `ANTHROPIC_API_KEY` ובונה את הלקוח. היום אין השפעה (ה-routers ממילא טוענים את מודולי ה-AI), אבל שכבת ה-tRPC הבסיסית תלויה עכשיו בתופעות לוואי של מודול AI.
- **כיוון (לא בוצע):** להעביר את `aiTimeoutMessage`, המפה והקבועים למודול בלי תופעות לוואי, ש-`client.ts` ו-`trpc.ts` שניהם מייבאים.

### AI — `maxRetries: 1` מקצר גם ניסיונות חוזרים לעומס (נמצא 2026-10-05)
- **מה:** ה-SDK מנסה שוב גם על 429/529 ושגיאות 5xx. עם `maxRetries: 1` (Unit 3B) יש ניסיון חוזר אחד במקום שניים, כך שבזמן עומס בצד Anthropic יהיו מעט יותר כשלים שמגיעים למשתמש.
- **כיוון:** פשרה מכוונת לשימוש אינטראקטיבי. לשקול מחדש אם כשלי עומס יהפכו לבעיה בפועל.

## נבנה
- **Unit 4/F — הודעת השרת בכשל התחלת ראיון** (Unit 4/F, 2026-10-05; תיקון באג באישור Owner): כשל ב-`interview.start` הציג רק את הטקסט הכללי `t.startFailed`, ולכן הודעת ה-timeout של Unit 3B לא הגיעה למשתמש. `interview-view.tsx` שומר עכשיו את הודעת השרת ומציג אותה דרך `ActionError` (הטקסט העברי נשאר ככותרת), ובלי הודעה חוזר ל-`Notice` עם הטקסט העברי בלבד. טסטים ב-`tests/unit/interview-view.test.tsx`. ההודעה מוצגת כפי שהיא (אנגלית, LTR) כמו בשאר העמודים.
- **Unit 4/E — `trpc.ts` לא תלוי יותר בלקוח ה-AI** (Unit 4/E, 2026-10-05): `aiTimeoutMessage`, מפת "מה נשמר" והקבועים `AI_TIMEOUT_MS`/`AI_MAX_RETRIES` עברו ל-`src/lib/ai/timeout.ts` (בלי תופעות לוואי בייבוא: בלי בדיקת מפתח ובלי בניית לקוח). `src/server/trpc.ts` מייבא משם; `src/lib/ai/client.ts` מייבא את הקבועים וממשיך לייצא אותם. ההתנהגות ללא שינוי; `tests/unit/ai-timeout.test.ts` עובר כמות שהוא.
- **Unit 4/D — תשתית בדיקות: ברירת מחדל סדרתית לאינטגרציה וניקוי עמיד** (Unit 4/D, 2026-10-05): (1) `vitest.config.ts` מוגדר כשני projects — `unit` (מקבילי, בלי DB) ו-`integration` (`fileParallelism: false`) — ו-`npm test` ללא דגלים עובר במלואו (1685/1685). ה-`globalSetup` נשאר בשורש בלבד: projects עם `extends` היו מריצים אותו פעם לכל project, וההרצה השנייה הייתה דוחה את ה-URL שהוצמד כ"בסיס הנתונים של האפליקציה"; לכן ה-projects חוזרים על שאר האפשרויות. README, סעיף Testing, מתאר איך החבילה רצה. (2) `tests/integration/test-database-guard.test.ts` רושם כל DB זמני שהוא יוצר לפני היצירה ו-`afterAll` מוחק אותם לפי שם מדויק, כך שנקיטה ב-timeout כבר לא משאירה DBs. נסגרו גם הפריטים "ניקוי DBs בטסט השומר אינו עמיד ל-timeout" ו"חבילת האינטגרציה אינה בטוחה להרצה מקבילית".
- **Unit 4/C — טסט אישורי Strategy דטרמיניסטי** (Unit 4/C, 2026-10-05): `tests/integration/strategy-repository.test.ts` מפוצל לשניים. (1) טסט דטרמיניסטי שמכניס את אותו `version_number` פעמיים ומוודא שהשגיאה האמיתית של Postgres מסווגת ע"י `isUniqueViolation` כאילוץ `strategy_versions_investor_id_version_number_unique` — לא תלוי בחפיפה בין שתי קריאות. (2) טסט האישורים ה"מקבילים" מוודא את האינווריאנט שמתקיים בכל תזמון: לפחות קריאה אחת מצליחה, כל כשל הוא בדיוק הפרת האילוץ, מספרי הגרסאות שהוחזרו שונים, ואין מספר גרסה כפול ב-DB. ההגנה שהטסט נתן (סיווג שגיאה אמיתי + אין כפילות) נשמרה. אומת: 3 הרצות רצופות.
- **Unit 4/B — טסט grounding דטרמיניסטי** (Unit 4/B, 2026-10-05): `tests/integration/grounding-context-v3-2.test.ts` משווה עכשיו שורות `dna_evidence_grounding_checks` אחרי מיון לפי `id` (`checksOf`), במקום להסתמך על סדר שה-repository לא מבטיח. ה-repository לא שונה: הצרכנים בקוד הייצור (`confidence-recalculation.ts`, `independence-recalculation.ts`, `partitionEvidenceForCounting`) בונים קבוצה (`Set`) מהשורות ולכן אינם תלויים בסדר. אומת: 3 הרצות רצופות של הקובץ.
- **Production Readiness Unit 3B — timeout מפורש ו-retry חסום לקריאות AI** (Unit 3B, 2026-10-05; חריגה צרה
  מהקפאת Backend Intelligence V1 באישור Owner): לא הוגדר timeout/retry באף קריאה, ולכן חלו ברירות המחדל של
  ה-SDK (10 דקות לניסיון, 2 retries, ~30 דקות במקרה הגרוע; `dna.generate` אמיתי נתקע פעם ~37 דקות). ב-
  `src/lib/ai/client.ts`: `AI_TIMEOUT_MS = 300_000` ו-`AI_MAX_RETRIES = 1` על ה-client היחיד (~10 דקות במקרה
  הגרוע). timeout מגיע למשתמש כ-"AI call timed out (limit: 5 minutes per attempt, 1 retry); …" עם מה שכבר נשמר לכל procedure
  (`aiTimeoutMessage`, דרך `errorFormatter` ב-`src/server/trpc.ts`). טסט: `tests/unit/ai-timeout.test.ts`.
  **לא שונה:** prompts, מודל, סכמות פלט, persistence, מיגרציות. לא היה פריט פתוח קודם ל-timeout ב-backlog.
  פתוח: ר' "קריאות AI — מה שנשאר פתוח אחרי Unit 3B" למעלה.
- **Production Readiness Unit 3A — בדיקת בעלות בחמישה procedures** (2026-10-05, commit `22ede15`;
  חריגה צרה מהקפאת Backend Intelligence V1 באישור Owner): `decisions.getForCase`, `dna.evidence`, `dna.reject`,
  `strategy.evidence` ו-`learning.evidence` קראו או כתבו לפי מזהה בלי לבדוק שהשורה שייכת למשקיע המחובר (נמצא
  ב-Unit 1; שלושה מהם תועדו קודם ברשימת DNA/Strategy למעלה). כל אחד בודק עכשיו בעלות לפני קריאה/כתיבה, באותו
  דפוס ובאותה שגיאה (`NOT_FOUND`, לא חושפת אם המזהה קיים); `setDnaHypothesisStatus` מקבל `investorId` ומגביל
  את ה-`WHERE` עצמו. נוספו `getDnaHypothesis` ו-`getStrategyPrinciple` (קריאה לפי מזהה, כמו `getLearningInsight`).
  טסט: `tests/integration/procedure-ownership.test.ts` (שני משקיעים לכל procedure). **לא שונה:** סכמה,
  מיגרציות, AI, ה-DB האמיתי.
- **Frontend V1, יחידה 1 — Design system + App shell + RTL foundation** (2026-09-30): `dir="rtl"`/`lang="he"` פעם
  אחת ב-`src/app/layout.tsx`, והעמודים לא עוטפים את עצמם יותר; shell משותף (`src/components/shell/`: סרגל צד בקצה
  ההתחלה בדסקטופ, drawer ב-`<dialog>` במובייל, מצב פעיל מ-`nav-config.ts`, שם משתמש והתנתקות); טוקנים ב-`globals.css`
  (paper/surface/ink/accent, סטטוסים, שכבות Evidence Strength; ה-aliases `journal-*` נשמרו כדי שששת העמודים שעוצבו
  קודם לא ישתנו); רכיבי בסיס ב-`src/components/ui/` (PageHeader/PageShell, Section, Card, Button, Badge +
  EvidenceTierBadge, Status/Notice, Field/Input/Textarea/Select, Table/KeyValues, Empty/Skeleton/Error/HelpText);
  `/styleguide` לפיתוח בלבד (404 בייצור, נתוני דוגמה); עמוד הכניסה נבנה על הרכיבים החדשים. **לא שונה:** backend,
  סכמה, חוזי AI, סמנטיקת ראיות. **פשרות זמניות:** העמודים הקיימים רק הסירו את עטיפת ה-RTL (וה-Dashboard את
  הניווט וההתנתקות הכפולים) ושומרים עמודה צרה `max-w-2xl` ומופעי גופן מקומיים עד ליחידת העיצוב של כל עמוד.
- **Grounding Semantics V3.2 — claims מורכבים + atomicity + שאלת הראיון כהקשר** (2026-09-27, OD-R8;
  `src/lib/ai/stance-rules.ts`, `src/lib/ai/dna-grounding.ts`, `src/lib/ai/investor-statements.ts`,
  `docs/data-model.md` §2): הכלל הקנוני מרחיב ל-COMPOUND CLAIMS (התאמה חלקית = NEITHER, AND / OR, מניע,
  תפקיד לפי ניסוח, scope) ול-INTERVIEW QUESTION — CONTEXT, NEVER EVIDENCE; `CLAIM_ATOMICITY_RULES` לשני
  ה-proposers; חוזים `*-v3-2-statements`; בקשת השער מתויגת בחמישה סעיפים (`buildGroundingUserMessage`);
  `contextText` עובר דרך שני שערי היצירה, שני ה-planners ושני ה-routers (`buildStatementContextById`), לעולם לא
  להצהרת החלטה ולא ל-carry; כלי ה-grounding נשאר strict. טסטים: מקרי-תקיפה AND / OR / מניע / עמום / חלקי,
  מקרי-תקיפה A–G להקשר השאלה, fixtures מנוקים בצורת קריאות 8 ו-13, atomicity, planners, carry, ואינטגרציה דרך
  ה-routers האמיתיים ו-remediation על DB (כלום לא נכתב בכשל טכני; גרסאות ישנות זהות byte-for-byte). תוקנה גם
  הערת-כותרת מיושנת בשני ה-planners. הבהרת contrast (`without` / `rather than`) הוקפאה והוטמעה בכלל הקנוני
  עם טסטים דטרמיניסטיים. **לא בוצע:** revalidation V3.2 אמיתית (שער מפוקח נפרד); אין שינוי ספי ביטחון, אין
  rewrite. provenance ל-`no_op` — ר' OD-R9 מיד למטה. **עודכן (2026-10-02):** ה-revalidation האמיתית של V3.2 בוצעה
  ב-2026-09-28 (ר' OD-R8).
- **OD-R9 — Grounding Judgment Audit Ledger** (2026-09-27; `src/db/schema/grounding-judgments.ts`,
  `src/db/repositories/grounding-judgments.ts`, `src/lib/evidence/grounding-run.ts`, מיגרציה
  `0018_grounding_judgments`, `docs/data-model.md` §2): טבלת append-only `grounding_judgments` + enum
  `grounding_planner_action`; שני ה-planners מחזירים `judgments` בכל תוצאה שנשפטה (כולל `no_op`);
  `applyDnaGroundingRemediation` / `applyStrategyGroundingRemediation` כותבים את הכתיבה הסמנטית ואת שורות
  הביקורת בטרנזקציה אחת לזהות, עם replay / conflict / stale / run-mismatch; ארבע פונקציות ה-insert הקיימות
  מקבלות `DbOrTx`. טסטים: צורת המיגרציה וכל constraint בשמו, `no_op`, `checked_no_change`, `new_version`,
  replay ו-conflict, כשל טכני (אפס כתיבות), rollback, stale, ריצה על כמה זהויות, ובידוד קריאה (שורת ביקורת
  עוינת לא משנה שום קריאה סמנטית; טסט ארכיטקטורה על מי רשאי לקרוא לטבלה). מיגרציה: fresh chain 0000 → 0018
  ו-upgrade 0017 → 0018 על clone של ה-DB האמיתי. **לא בוצע:** החלת 0018 על ה-DB האמיתי; ה-runner המפוקח.
  **עודכן (2026-10-02):** 0018 הוחלה מאז על ה-DB האמיתי (ר' OD-R9).
- **Grounding Semantics V3.1 — תנאי-קדם מהותיים + strict grounding tool + כשל טכני** (2026-09-25, OD-R7;
  `src/lib/ai/stance-rules.ts`, `src/lib/ai/dna-grounding.ts`, `docs/data-model.md` §2): הכלל הקנוני מרחיב ל-MATERIAL
  PRECONDITIONS (ארבעה שלבים, מקורות פסולים, שתי דוגמאות, citation-local) וסימטריה ל-supporting; ה-proposers לא ממלאים
  טריגר חסר; חוזים `*-v3-1-statements`; כלי ה-grounding `strict: true` + `additionalProperties: false`; `parseGroundingResponse`
  מסמן `technicalFailure` (כולל כלי שגוי) ושני ה-remediation planners מחזירים `technical_failure` בלי checks/גרסה;
  שערי היצירה וה-carry מדווחים החרגה טכנית. טסטים: מקרי-תקיפה A–H + קצוות + fixture בצורת d5941418 דרך ה-pipeline
  האמיתי, strict tool, parser, כשל טכני ב-planners ובאינטגרציה (כלום לא נכתב). **לא בוצע:** revalidation V3.1
  אמיתית (שער מפוקח נפרד); אין מיגרציה, אין שינוי ספי ביטחון, אין rewrite. **עודכן (2026-10-02):** ה-revalidation
  האמיתית של V3.1 בוצעה (ר' OD-R7).
- **Grounding Semantics V3 — סתירה דורשת ראיה חיובית** (2026-09-25, OD-R6; `src/lib/ai/stance-rules.ts`,
  `docs/data-model.md` §2, `docs/architecture.md` §2.11): כלל stance אחד משותף לשני ה-proposers ולשער ה-grounding;
  חוזים `*-v3-statements`; שני ה-remediation planners מעבירים `sourceKind` נכון (הצהרת החלטה לא מתויגת כתשובה);
  מסלולי ה-insert של remediation שומרים `provenance_json` (generator `*.remediateGrounding`, חוזה v3, model או
  `null`, `revalidatedVersionId`, `remediationReason`, `semanticRule`); טסטים: מקרי-תקיפה A–E + קצוות דרך ה-pipeline
  האמיתי עם שער ייחוס דטרמיניסטי, remediation append-only end-to-end ל-DNA ול-Strategy. **לא בוצע:** remediation
  אמיתית (AI) על הנתונים האמיתיים — שער מפוקח נפרד; אין מיגרציה, אין שינוי ספי ביטחון, אין rewrite. **עודכן
  (2026-10-02):** ה-remediation האמיתית של V3 בוצעה ב-2026-09-25 (ר' OD-R6).
- **Evidence Reach V1 — הצהרות מזמן החלטה כראיה, עצמאות החלטה (OD-2), Learning→DNA (OD-3), provenance,
  שקיפות ראיות ו"מה הצעד הבא"** (2026-09-25, autonomous run; `docs/architecture.md` §2.11, `docs/data-model.md`
  §2/§3/§8): נמצא בריצה חיה (קריאה בלבד) — DNA reach = 0 (10/10 השערות ו-6/6 עקרונות נצפים insufficient; ה-AI
  ראה 2 מוצהרים + 4 מאומתים בלבד), 9 הצהרות החלטה (~2,300 תווים) שמעולם לא הוזנו, הסכמה ל-Learning יצרה השערה
  S=1 שמיד הוחרגה, `learning.generate` חוזר ייצר כפילויות. **נבנה:** Statement IDs + `evidence.decision_id/
  decision_statement_kind` + `provenance_json` (מיגרציה `0017`, **scratch בלבד — לא הוחלה על ה-DB האמיתי**; עודכן 2026-10-02: הוחלה מאז, אומת קריאה-בלבד);
  `decision-cases.ts` (OD-2) + `independence-policy-v2` (`unresolvedDecisionIds` review-only); prompts/tool-schemas
  של DNA/Strategy נצפית מצטטים Statement ID עם תוויות מקור וכללי OD-1; grounding מול הטקסט של המשקיע; `learning.agree`
  נושא החלטות-מקור (replay, advisory lock) ו-`learning.generate` מזהה לפי (investor, family); `evidence.reach` +
  שורות reach בעמודי DNA/Strategy; `evidence.nextActions` + מקטע "מה הצעד הבא" בדשבורד (Monitoring לא נגע).
  **replay על הנתונים האמיתיים (קריאה בלבד):** 19 הצהרות (10 תשובות + 9 הצהרות החלטה); LLY/SNDK/AVGO כולן
  "own" תחת OD-2 (אין מועמדות ביצוע — הקניות באותו טיקר קדמו להחלטה); גבול עליון היפותטי אם 3 הנימוקים היו
  מצוטטים כתומכים ועוברים grounding: 2 claims היו מגיעים ל-strong (S=5), השאר ל-moderate — **לא טענה, גבול
  עליון**; 5 צעדים הבאים (תאריך Review ל-AVGO, Case MU שנתקע, 60 אפיזודות ללא נימוק, יצירה מחדש ב-DNA
  וב-Strategy). **לא נבנה בכוונה / חוב:** (א) גרסאות קיימות לא נכתבות מחדש — הצהרות החלטה נכנסות רק ביצירה
  מחדש (הצעד הבא בדשבורד); (ב) **פריסה: מיגרציה 0017 חייבת להיות מוחלת לפני שהקוד רץ** — ה-ORM בוחר את
  העמודות החדשות בכל קריאת `evidence`/גרסאות (נבדק: clone של הסכמה האמיתית + ledger, upgrade רק 0017, תקין);
  (ג) קטלוג הצעדים עם שני קבועים (30 יום ל-Review מוצע, 14 יום ל-Case שנתקע) — לא הגדרות משתמש; (ד) Learning
  עדיין מקובץ לפי סקטור; (ה) הצהרת החלטה נספרת רק כשהמשקיע מסווג מועמדות ביצוע (UNRESOLVED אחרת) — על
  הנתונים האמיתיים כרגע 0 כאלה; (ו) שתי שורות `source_learning_insight_id` היסטוריות (סינתטיות) נשארות.
- **Decision Follow-Through V1 — ביצוע בפועל, מחזור חיי תנאי שקילה-מחדש, Case משקילה מחדש** (2026-09-24,
  autonomous run; `docs/architecture.md` §2.10): נמצא על הנתונים האמיתיים — AVGO BUY $500 (09-08) ליד קניית $670
  מ-09-02 בלי שום קשר רשום; SNDK PASS (08-20) ואחריה קנייה ב-08-24 — תנאי ה-pullback התקיים והמשקיע פעל בלי החלטה
  רשומה; 3 תנאי שקילה-מחדש של AVGO ללא תאריך שאפשר היה לפתור רק דרך Review מלא. **נבנה:** `decision_execution_facts`
  (מיגרציה `0016`, scratch בלבד), `executions.candidates/assert`, מקטע "ביצוע בפועל" בעמוד ההחלטה, Review מקבל
  `executionFacts` (ציטוט רק כשיש עובדה); `predictions.resolveReentryCondition/openReentryConditions`, פתרון בעמוד
  ההחלטה, מקטע "תנאי שקילה-מחדש פתוחים" בדשבורד; `cases.createFromCondition/originCondition` +
  `investment_cases.origin_prediction_id`, שורת מקור בעמוד ה-Case. Monitoring, Prior Record (v1), Decision AI,
  Learning/DNA/Strategy — ללא שינוי. **לא נבנה בכוונה / חוב:** (א) ה-Monitoring עדיין מסמן עסקה שסומנה "ביצעה
  את ההחלטה" כ-NEW_EXECUTION_AFTER_DECISION עד ל-Review הבא (baseline) — לא נגענו בסמנטיקה הקפואה; (ב) Prior
  Record לא מציג אילו עסקאות ביצעו החלטה קודמת (דורש `version: 2` של התקציר + ההטלה ל-AI); (ג) ה-Decision AI
  לא יודע שה-Case נפתח מתנאי שהתקיים (סטטוס פתרון מוחרג מהחוזה — הכרעת Owner); (ד) Outcome ב-Review עדיין
  מחושב מ-`size` × תנועת מחיר, לא מהביצוע המאושר (שינוי סמנטיקת Outcome = הכרעת Owner); (ה) אין UI להערה
  חופשית בסימון ביצוע (ה-API תומך).
- **Prior Record → AI Decision Context V1** (2026-09-24): ה-AI של ההחלטה מקבל הטלה מוגבלת ומסומנת-מקור של
  הרקורד הקודם (`src/lib/prior-record/ai-context.ts`), מאותו תקציר PIT שמוקפא ב-Snapshot (טעינה אחת, לפני
  ה-AI); ה-Review מקבל רק את העותק הקפוא (NULL → NOT CAPTURED; `priorRecord` ציטוט רק כשקיים). מחירים,
  תוצאות ממומשות, Predictions שנפתרו ותוויות Review מוחרגים מבנית. בלי מיגרציה. בנוסף: שומר AI גלובלי
  בטסטים (`tests/setup.ts`) — המפתח האמיתי מוחלף ו-SDK מוחלף בלקוח שכל קריאה שלו נכשלת; טסט שצריך
  פלט AI מבצע mock מפורש לגבול. **לא נבנה בכוונה:** dedupe סמנטי (DNA/Strategy/רקורד) — כלל prompt בלבד
  ("ספור פעם אחת"); שמירת prompt/model version — לא נשמרים בשום נתיב AI כיום (קיים, לא חדש).
  **טקסט משקיע עם מספרים — הוכרע ע"י Owner (final review):** טקסט היסטורי של המשקיע נשמר מילה במילה גם כשהוא מזכיר
  מחיר/תוצאה (בפועל: Later Context של SNDK מצטט `$1598.37`, התיקון של LLY מצטט `$1278.83` ו-"~$500"). לא מושמט,
  לא נערך; `QUOTED_HISTORY_RULES` בשני ה-prompts מגביל את הפרשנות. שדות מובנים של מחיר/ביצועים/תוצאה — לא קיימים בחוזה.
  **חוב V1 מקובל (לא לתקן ביחידה זו):** (1) anchoring ו-double counting ברמת האמונה נשענים חלקית על כללי prompt;
  (2) החלטה עם תאריך בעבר עדיין מקפיאה מצב "עכשיו" מחוץ ל-Prior Record (ר' "חוב זמני" למעלה); (3) גרסת prompt/model
  לא נשמרת בשום נתיב AI.
- **Prior Record Brief V1 — "הרקורד שלך בטיקר הזה" לפני החלטה, קפוא ב-Snapshot** (2026-09-24):
  כל Case במחקר אצל המשקיע האמיתי כבר היה עם היסטוריה בטיקר (LLY 2, SNDK 3, MU 4, AVGO 3 עסקאות;
  החלטות קודמות עם תנאי שקילה-מחדש), אבל מסך המחקר וההחלטה לא הציגו אותה. **נבנה:** `derivePriorRecordBrief`
  (טהור) + `loadPriorRecordBrief` (wrapper יחיד, בעלות + טיקר), `cases.priorRecord`, הקפאה ב-`decisions.create`
  ל-`decision_snapshots.prior_record_json` (מיגרציה `0015`, NULL, בלי backfill — scratch בלבד), תצוגה בעמוד
  ה-Case ובעמוד ההחלטה, loader משותף ל-Journal. בלי AI, בלי מחירים, בלי שינוי ב-Monitoring/Review/Learning.
- **Decision Review Integrity V1 — מפתח הגשה, טביעות אצבע, שמירה אטומית** (2026-09-24):
  ה-architecture review שחזר על DB scratch דרך `reviews.generate` האמיתי (AI mocked): (1) Prediction
  שנפתר בזמן קריאת ה-AI → Review נשמר, רק חלק מה-Predictions נפתרו ממנו, והבקשה החזירה שגיאה;
  (2) שתי הגשות מקבילות → שני Reviews; (3) בלי Predictions ממתינים כל הגשה חוזרת יוצרת Review.
  **הוחלט:** Review חוזר מכוון חוקי גם בלי Predictions ממתינים; שינוי מצב → fail closed בלי AI חוזר;
  UUID מהלקוח לכל הגשה + `request_fingerprint` + `input_state_fingerprint` על ה-Review, unique חלקי
  כסמכות סופית. **נבנה:** מיגרציה `0014` (שלוש עמודות NULL + unique חלקי, בלי backfill — scratch
  בלבד, לא ה-DB האמיתי); `persistDecisionReviewAtomic` (נעילות החלטה → Predictions לפי id, אימות
  מחדש, Review + ממדים + resolutions בטרנזקציה אחת; unique violation → replay/CONFLICT);
  `review-fingerprint.ts`; `reviews.generate` עם replay לפני AI; מפתח הגשה בעמוד ההחלטה. שני
  ה-Reviews הקיימים של LLY לא נגעו ולא סווגו (אין ראיה אם השני היה מכוון).
- **Open-Decision Monitoring V1 — "החלטות שדורשות תשומת לב", נגזר בקריאה** (2026-09-23):
  שכבת תשומת-לב דטרמיניסטית מעל ההחלטות הקפואות (ר' `docs/architecture.md` §2.9,
  `docs/data-model.md` §5 "Decision Monitoring"). **הוחלט (3 הכרעות אנושיות):** `review_by_date`
  אופציונלי אך בחירה מפורשת בהחלטה חדשה, כתיבה פעם אחת להחלטה ישנה; `HISTORY_BACKFILLED` היא
  סיבת V1 (מנוסחת ניטרלית); עסקה ביום ההחלטה מוצגת ולעולם לא נספרת כ"אחרי". **נבנה:** מיגרציה
  `0013` (`decisions.review_by_date` NULL, בלי backfill — **הוחלה על DB scratch בלבד, לא על
  ה-DB האמיתי**); `src/lib/monitoring/decision-attention.ts` (טהור) + `load-decision-attention.ts`
  (ה-wrapper היחיד) + `review-horizon.ts`; `decisions.attention`, `decisions.create` עם
  `reviewHorizon` מפורש, `decisions.setReviewByDate` (UPDATE אטומי `IS NULL` + בעלות);
  מקטע אחד בדשבורד; שורת אופק ב-Decision Snapshot; בחירת אופק בטופס ההחלטה. ללא AI, ללא מחירי
  שוק, ללא טבלת attention, ללא קישור החלטה↔עסקה. **replay קריאה-בלבד על הנתונים האמיתיים:** SNDK
  PASS 20.08 → `NEW_EXECUTION_AFTER_DECISION` (3 עסקאות שנוספו 23.09 אחרי ה-Review מ-06.09); AVGO
  BUY 08.09 → `HISTORY_BACKFILLED` (מכירה 05.08 וקנייה 02.09 שנוספו 23.09 אחרי הקפאת ה-Snapshot;
  4 predictions ללא תאריך → לא due); LLY BUY 19.08 → settled (נסקרה, ללא עובדה חדשה). MU = case
  במחקר, לא החלטה. **final review (2026-09-23):** נמצא ותוקן — הימים חושבו לפי UTC, כך שהחלטה
  שנרשמה ב-00:00–03:00 שעון ישראל נפלה ליום ה-UTC הקודם ועסקה מאותו יום מקומי הייתה נספרת
  כ"אחרי" (סיבת attention כוזבת), ו-Review ב-00:30 ביום האופק לא סיפק אותו; עכשיו רגעים ממוקמים
  על לוח השנה של המשקיע לפי אזור הזמן שהלקוח שולח (`decisions.attention({ timeZone })`, מאומת,
  ללא ברירת מחדל), ותאריכי-בלבד נקראים לפי רכיבי UTC. בדיקות גבול סביב חצות ירושלים נוספו.
- **Import Blockers V1 — `tax_refund` + פיצולי מניה כאירוע הון בלתי ניתן לשינוי** (2026-09-23):
  ה-dry run של הרענון האמיתי הראשון (211 תנועות מקובץ ברוקר מותאם) נחסם על שניים: (1) שורת
  "זיכוי מס אוגוסט" (+$26.65, 01.09) נדחתה כ-`unrecognized transaction type` — ואסור היה למפות
  אותה ל-deposit/dividend/fee; (2) CRWD: קנייה 17.04 של 0.7383 ומכירה 13.07 של 2.9532 (בדיוק ×4)
  — פיצול 4:1 שלא מיוצג בהיסטוריה, ולכן oversell/אזהרת opening state ו-P&L שגוי. **הוחלט
  (2026-09-23):** `tax_refund` כסוג ראשון-מעלה (חיובי מס נשארים `fee`); פיצולים כ-CorporateAction
  מבוסס-יחס, immutable, רק `stock_split` (הפוך = numerator<denominator); כלל תאריך קפוא
  (פעולה → opening state → עסקאות; `effective_date <= asOfDate`); snapshots קפואים לא מחושבים
  מחדש. **נבנה:** מיגרציה `0012_import_blockers` (`ALTER TYPE transaction_type ADD VALUE
  'tax_refund'`; enums `corporate_action_kind`/`corporate_action_source`; טבלת
  `corporate_actions` עם CHECK יחס חיובי ו-UNIQUE (investor, ticker, effective_date)) — **נוצרה,
  הוחלה על DB scratch בלבד, לא על ה-DB האמיתי**; parser (`TYPE_SYNONYMS` כולל "זיכוי מס",
  `CASH_DIRECTION +1`); `computePositions(..., corporateActions)` + `deriveEpisodeKeys` על אותו
  ציר-זמן; `computePositionsForInvestor` טוען את הפעולות, ו-`interview.start` מעביר אותן לבחירת העסקאות לראיון (ה-final review מצא
  שהבורר קרא ל-`computePositions()` ישירות בלי פיצולים — מכירת CRWD אחרי הפיצול, רווח +77.2%, הייתה מושמטת בשקט; תוקן); תצוגת הייבוא מריצה את
  ה-dry run עם הפיצולים; repository insert-only; `import.recordStockSplit` (אישור מפורש, 1:1
  נדחה, כפילות → BAD_REQUEST) + `import.corporateActions`; מקטע "פיצולי מניה" ב-`/import`.
  **העובדה האמיתית של CRWD** (פיצול 4:1, מסחר מותאם מ-2026-07-02, לפי דיווח החברה; דוח הברוקר:
  30.06 0.7383 @ $763.14, 13.07 2.9532 @ $187.84) **לא נכתבה** — כתיבה אמיתית נפרדת ומאושרת
  אחרי הרצת המיגרציה. **אומת:** unit (fixture CRWD: 0.7383@423.90 → 2.9532@105.975, סך עלות
  ללא שינוי, סגירה מדויקת, sufficientHoldings=true, P&L +77.2%; פיצול הפוך, עסקה בתאריך
  התחילה, opening state לפני/ב/אחרי, asOfDate לפני/ב/אחרי, פיצול אחרי העסקה האחרונה, פיצולים
  מרובים, אין החזקה → no-op, יחס לא חיובי → שגיאה, 300 ניסויים: סך עלות אינווריאנטי ופיצול+הפוך
  משחזרים; episodes: CRWD-like, oversell → סגירה מדויקת, ללא פעולות → מפה זהה ב-300 היסטוריות
  אקראיות; tax_refund: פרסור כולל עברית, סימן, amount חובה, ticker לא נדרש, מזומן בלבד, זהות
  ואידמפוטנטיות) + integration על DB scratch מסומן (מיגרציה, insert/list, בעלות, יחסים לא
  תקינים ב-zod וב-CHECK, כפילות, ה-wrapper מעביר פעולות, תצוגת ייבוא מכבדת פיצול, ייבוא
  `tax_refund` חוזר = 0). replay קריאה-בלבד על הנתונים האמיתיים + הזרקת CRWD בזיכרון: ר' דוח
  היחידה.
- **History Refresh V1 — זהות עסקה דטרמיניסטית, ייבוא חופף אידמפוטנטי, טריות היסטוריה**
  (2026-09-22): ה-architecture review אחרי Episode Journal מצא שהבסיס העובדתי קפוא — קובץ
  ה-CSV היחיד (153 שורות, הועלה 2026-08-16) מכסה **2026-01-07 → 2026-06-30 בלבד**, 4 שורות
  ידניות באוגוסט, ו-3 החלטות אמיתיות (LLY/SNDK/AVGO) נרשמו על תיק שההיסטוריה שלו נגמרת
  ב-06-30/08-28 — והדרך היחידה להרחיב אותה (ייבוא CSV חופף מהברוקר) הייתה **fail-open**:
  שוחזר על DB scratch לפני הבנייה — אותה שורה בדיוק ב-`confirmTransactionsWithOrdering` פעמיים
  → 2 שורות, שתיהן מסומנות בשקט `never_recorded`. **נבנה:** (1) `src/lib/import/reconcile.ts`
  — מנוע טהור: זהות `(ticker, type, date, quantity, price, amount)` בצורה קנונית (עיגול ל-8
  ספרות מסיר רק רעש IEEE-754, למשל `-999.9901229999999` האמיתי של MRVL), **multiset** (N
  קיימים בולעים ≤ N נכנסים; שתי קניות זהות באותו יום נשארות אמיתיות; לכן **אין** UNIQUE),
  התאמה-אפשרית ידני↔CSV רק כשצד אחד ידני ורק כשכמות **וגם** מחיר מסכימים בדיוק הגס מבין
  השניים (עיגול חצי-למעלה על ספרות, לא float; `amount` לא נבדק — עמלה), `ambiguous` כשיש
  יותר ממועמדת אחת או מועמדת משותפת, ו-`planInsertions` שנכשל-סגור על חוסר הכרעה/הכרעה
  stale/שתי שורות על אותה קיימת. (2) `confirmTransactionsWithOrdering` מריץ את המנוע **בתוך
  אותם advisory locks** על השורות הקיימות שנשלפו שם (כולל שורות בלי ticker — מפתח נעילה
  ריק), ורק מה שהתוכנית משאירה ממשיך לסדר-היומי; `ImportBatch` נוצר באותה טרנזקציה,
  `row_count` = מה שנוסף (0 לקובץ שכבר יובא), ייבוא שנדחה לא משאיר batch יתום (תוקן אגב —
  קודם ה-batch נוצר לפני ה-confirm). (3) `import.validate`/`checkManualEntry` מחזירים את
  הסיווג לתצוגה; `confirmImport`/`confirmManualEntry` מקבלים `resolutions` (same+id/separate)
  ומאמתים אותן מחדש — כל הכרעה קשורה ל-`identityKey` של השורה שהוצגה, לא רק למיקומה (נמצא
  בסקירה האדברסרית: קובץ שונה באותו מיקום היה יורש הכרעה; עכשיו stale). CSV: כפילות מדויקת
  מדולגת תמיד, בלי override; ידני: שורה זהה (לקיימת או לשורה קודמת בטופס) חסומה עד "זהה
  בכוונה". (4) `/import`: פאנל התאמה (ספירות, שורות שדורשות
  הכרעה עם עובדות המועמדת, כפתור אישור נעול עד להכרעה, ספירת "ייכנסו להיסטוריה"), ובסיום
  כמה דולגו ולמה; `import.history` + בלוק טריות ב-`/import` ובכרטיס הדשבורד ("מעודכנת עד
  … · לפני N ימים · הייבוא האחרון וחלונו · הזנה ידנית"), עם הצהרה שאין סנכרון ברוקר. ללא
  migration, ללא AI, ללא מחיקה/מיזוג/החלפה, ללא שינוי ב-`computePositions`/episodes/DI.
  **אומת:** 23 unit (זהות, קנוניזציה, עיגול, גבולות ה-near rule, multiset, כל סוג עסקה,
  הכרעות, fail-closed, 200 היסטוריות אקראיות: `import(X);import(X)` = 0 בשנייה, ריבויים
  נשמרים, אינווריאנטיות לתמורה) + 11 integration דרך `importRouter.createCaller` על DB
  scratch מסומן (אותו קובץ פעמיים → 0, חופף → רק החדש, שני confirm-ים מקבילים של אותו קובץ
  → סט אחד, 4 השורות של אוגוסט מול קובץ ברוקר → 4 probable, סירוב בלי הכרעה בלי batch יתום,
  stale/זר → BAD_REQUEST, same×3 + separate×1, הגנת הזנה ידנית + override, בידוד משקיעים,
  טריות, positions+journal רואים בדיוק את מה שנשמר); replay קריאה-בלבד על הנתונים האמיתיים:
  ה-batch המקורי (153) מול ה-DB הנוכחי → 153 exact / 0 new / תוכנית 0, כפילויות בהיסטוריה
  היום = 0, 4 השורות הידניות של אוגוסט כקובץ ברוקר (עם עמלה) → 4 probable עם המועמדת
  הידנית שלהן בדיוק, גם בכמויות 2-ספרות; מחיר שונה → 4 new; הזנה חוזרת ידנית → 4 exact
  חסומות; דפדפן (Playwright על DB scratch): 19/19. **ייבוא אמיתי לא בוצע** — נשאר פעולה
  מפורשת של המשתמש.
- **Episode Journal V1 — רציונל לכל episode פוזיציה** (2026-09-22): הפער שנמצא ב-architecture
  review — למשקיע האמיתי 157 עסקאות ב-51 episodes (46 tickers, 42 סגורים, 9 פתוחים) אבל רק **8**
  episodes עם רציונל כלשהו (10 תשובות ראיון), ולכן כל 10 השערות ה-DNA וכל 6 העקרונות ה-observed
  ב-`insufficient_evidence` (S<3) ו-`excludeInsufficientEvidence` מסנן את כולם מ-Personal Fit /
  Decision / Review — הבטחת "לומד איך אני משקיע" לא נראית בשום מקום. שני מסלולי התיעוד לא יכלו
  להגיע להיסטוריה: הראיון המודרך בוחר 6 עסקאות-קיצון לסשן בלי dedup בין סשנים, ו-"Tell me why"
  היה מוגבל ל-`source="manual_entry"` (4 מ-157) ומוצג רק אחרי submit. **נבנה:** (1)
  `src/lib/portfolio/episodes.ts` — `deriveEpisodeJournal()` טהור מעל
  `computePositions().episodeKeyByTransactionId` (אותה מפה של ה-Decision Independence resolver — לא
  מנוע episodes שני; כל P&L מ-`sellTrace`), anchor = קניית הכניסה (תאריך → `intra_day_order` → id),
  `entry=null` = אין קנייה → נדחה (fail closed), כיסוי = episode עם ≥1 תשובה **אפקטיבית**
  (superseded לא נספר; כמה תשובות לאותו episode = מכוסה אחד), סדר דטרמיניסטי (לא-מכוסים קודם,
  כניסה חדשה קודם). (2) `src/lib/interview/journal.ts` — projection hindsight-safe: `later=null`
  לכל episode בלי רציונל, **server-side**. (3) `interview.startTellMeWhy` הורחב לכל buy/sell עם
  ticker בבעלות המשקיע (dividend/fee/deposit/withdrawal/ללא ticker/זר/לא קיים נדחים), מחזיר את
  ה-anchor; `interview.answer` מקבל `supersedesAnswerId` (אותו משקיע, פעם אחת) ובודק בעלות על
  ה-session (גם `complete`/`answersForSession`); `interview.journal` + `journalCoverage` חדשים.
  (4) `buildTellMeWhyQuestion` — אותו builder, עם context של episode: רק עובדות כניסה (ticker,
  מספר, תאריך dd/mm/yyyy, כמות, מחיר), ניסוח לפוזיציה פתוחה בלי "למה יצאת"; אין input ל-P&L
  בכלל. (5) `/journal` (עברית/RTL, `<Num>`) + כרטיס בדשבורד עם "תועדו X מתוך Y" (נגזר, לא
  hard-coded). ללא migration, ללא AI, ללא שינוי בספים/resolver/grounding/identity; שמירה לא
  מריצה generation. **אומת:** 21 unit + 12 integration (router אמיתי דרך createCaller על DB
  scratch מסומן: חוזה, anchor למכירה, דחיות, בעלות, append-only + supersession (כולל 6 עדכונים
  מקבילים לאותה תשובה — בדיוק אחד מצליח, יורש אחד; נמצא ותוקן בסקירה האדברסרית: הבדיקה
  "יש יורש?" לא הייתה אטומית ופיצלה שרשרת 8/8 — עכשיו תחת `FOR UPDATE`), hindsight,
  downstream — התשובה מגיעה ל-`getAllAnswersForInvestor` וה-resolver סופר 3 תשובות על MP#1 כמקרה
  אחד ו-MP/MRVL כשניים); replay קריאה-בלבד על הנתונים האמיתיים: 51/8 בדיוק, 9 פתוחים, 0 ללא
  anchor, MRVL#1–#3 שלושה episodes אמיתיים, שאלת MP#1 ללא P&L. `/import`'s panel מעגן עכשיו גם
  הוא ל-anchor שהשרת מחזיר. **תצפית (לא שונה):** `computePositionsForInvestor` לא מעביר
  `intra_day_order` ל-`computePositions`, כך שסדר-יום מוצהר לא משפיע על episodes בייצור — כיוון
  שמרני (פחות episodes מוכחים), זהה ב-resolver ובאיומן, מתועד כפער פתוח למטה.
- **Decision Independence V1 — עצמאות חוצת-tickers** (2026-09-22; מיגרציה `0011` **הוחלה** על
  ה-DB האמיתי ו-apply רץ פעם אחת באותו יום — ר' "פתוח" למעלה לפרטים; הטקסט המקורי כאן אמר
  "נכתבה ולא הופעלה" נכון לזמנו): החלטה אחת שנפרשת על שני tickers (MP נמכר כדי לממן MRVL) נספרה
  כשני מקרים. `resolve-independence.ts` — resolver טהור יחיד ל-DNA ו-Strategy (validation,
  grounding, remediation, identity, recalculation): קבוצות חזקות (episode + `TransactionLinkFact`
  מאושר) וקשתות **חלשות** רק כשזוג cross-ticker בצדדים הפוכים ב-≤14 ימים מקורבר ע"י
  *exclusive counterpart* (אין פעילות אחרת בחשבון ±3 ימים) או *named counterpart* (המשקיע הזכיר
  את ה-ticker של הצד השני בתשובה שלו). קרבה זמנית לבדה = review-only ואינה נספרת (על ההיסטוריה
  האמיתית ל-84% מהעסקאות יש שותף באותו יום — closure טרנזיטיבי קורס את כל 140 העסקאות לרכיב
  אחד). `calculateEvidenceStrength(S_lb, C_ub)` = ה-tier המינימלי המדויק (הוכח + brute-force
  oracle, 40,000/40,000; **תיקון להערכה קודמת** שטענה שה-envelope עלול להיות פסימי מכל עולם
  אמיתי). נשמר `independence_basis_json` דטרמיניסטי (`NULL` = legacy). **אימות:** DB scratch
  ממיגרר מאפס (743 טסטים, 0 skipped), ו-clone של הנתונים האמיתיים: dry-run = בדיוק 2 גרסאות
  (Strategy `a48426b1`, DNA `699cdb50`), `apply` על ה-clone לא שינה אף אחת מ-7,163 שורות
  ההיסטוריה, וריצה שנייה = no-op; ה-DB האמיתי לא נכתב. פירוט: `docs/data-model.md` §2.
  **הקשחה (2026-09-22, לפני commit):** זיהוי identity ב-`generate` סופר עכשיו מול ה-effective
  של הגרסה הנוכחית, לא ה-raw — ראיה ש-remediation דחה לא מעלה S/C/S_ub/C_ub ולא יוצרת
  גרסה; דחיה מפורשת דביקה; גרסה שנוספת ל-identity עם checks נושאת אותם קדימה
  (`expectedBaseVersionId` + `expectedBaseCheckCount` מגנים מפני base מיושן, כולל remediation שהוסיף
  checks לגרסה קיימת בלי גרסה חדשה). אומת על ה-routers האמיתיים (AI ממוקאפ),
  DNA ו-Strategy.
- **Evidence Strength — אינווריאנט מונוטוני: סתירה לעולם לא מעלה ביטחון** (2026-09-20): ריצת
  ה-Strategy החיה הראשונה העלתה את `3653aeed` מ-insufficient ל-moderate כשהמקרה
  החדש היחיד היה **סותר** (S=2,C=0 → S=2,C=1). שורש: `calculateEvidenceStrength`
  השתמש ב-`total=S+C` בשני שערי הגודל (`total<3`, `total>=5`), כך שסתירה נחשבה
  "נפח". תיקון בפונקציה המשותפת היחידה (DNA, Strategy, Learning, שני ה-remediation
  ושני ה-resolvers): שערים לפי **S בלבד**; שער ה-ratio (0.6/0.8) ללא שינוי, כך
  שסתירה עדיין מורידה tier. אומת בכוח-גס: הכלל הישן הפר מונוטוניות ב-4 תאים
  (0,3),(1,2),(2,1),(4,1); החדש הוא ה-repair המונוטוני הגדול ביותר (רק מוריד, רק
  במקום הנדרש, עמודת C=0 זהה). הטסטים נכשלים 22× על הכלל הישן. **לא נכתבה מחדש
  היסטוריה** — ר' "פתוח" למעלה.
- **Strict tool contract — הבעיה נמנעת ברמת ה-request, לא רק נתפסת אחריו** (2026-09-19): שני ריצות
  Strategy אמיתיות (2026-09-18) החזירו `principles` כ-JSON string — בשנייה גם
  JSON לא תקין (מרכאות ASCII לא מוברחות בתוך טקסט). ה-normalizer נכשל סגור
  נכון, אבל תיקון parser אינו פתרון ל"מחרוזת שאינה JSON". `strict: true` על שלוש
  הכלים (`propose_observed_principles`, `propose_declared_principles`,
  `propose_hypotheses`) גורם ל-provider לאכוף את ה-schema **בזמן הייצור** ("guarantees
  schema validation on tool names and inputs" — `Tool.strict` ב-`@anthropic-ai/sdk`
  0.116.0; המודל `claude-sonnet-5` ברשימת המודלים הנתמכים בתיעוד הרשמי). הדרישה
  המחייבת: `additionalProperties: false` על **כל** אובייקט; אין מילות-מפתח לא
  נתמכות (`minLength`, `pattern`, `anyOf`...) — מפרה מחזירה HTTP 400. כל שלושת
  ה-schemas כבר הכריזו כל שדה כ-`required` ולא השתמשו ב-union/constraint, ולכן
  הוסף רק `strict` ו-`additionalProperties`. **לא נוספה** אפשרות string לאף
  collection. `tool_choice` הכפוי נשאר. ה-normalizer נשאר כהגנה בעומק, ללא שינוי.
  `tests/unit/ai-strict-tool-contract.test.ts` בודק את ה-request האמיתי שנשלח
  (mock ל-SDK בלבד): strict נשלח, כל אובייקט strict, ה-collection בדיוק `array`,
  ורשימת מילות-מפתח מותרות סגורה. **לא אומת חי** — שילוב strict + `tool_choice`
  כפוי מול המודל הזה, וקבלת ה-schema ע"י ה-API (בקשה שנדחית = 400 לפני כל כתיבה).
- **AI structured-output boundary hardening — `normalizeStructuredCollection`** (2026-09-18): ב-strategy generation
  האמיתי הראשון המודל החזיר HTTP 200 עם `principles` כ-**JSON string** שעוטף
  `{"principles":[...]}` במקום מערך; ה-`Array.isArray(input.principles)` המחמיר
  זרק לפני grounding/identity/persistence (אומת: 30 טבלאות זהות בית-לבית,
  שום דבר לא נכתב). `src/lib/ai/structured-output.ts` חדש — helper יחיד,
  דטרמיניסטי, ללא AI/DB, בשימוש שלושת המקומות עם אותו גבול בדיוק
  (Strategy observed, Strategy declared, DNA). מקבל רק ייצוגים שקולים של
  collection תחת המפתח הצפוי: מערך ישיר, wrapper, מחרוזת JSON של כל אחד
  מהם, ושדה wrapper שהוא עצמו מחרוזת (מחלקת התקרית). **גבול מפורש:** עד שני
  `JSON.parse` ושני unwrap, בקו ישר בלי רקורסיה; עומק מעבר לכך → `depth_exceeded`.
  נדחים: JSON פגום, פרוזה, גדר Markdown, מפתח שגוי/חסר, wrapper דו-משמעי
  (המפתח הצפוי + שדה מערך נוסף), null/boolean/number, אובייקט במקום מערך.
  אין חילוץ regex, אין תיקון JSON, אין ניחוש שמות שדות, אין salvage
  חלקי. **הוא לא שופט את הפריטים** — הוולידציה הדומיינית (ציטוטים, stance,
  answer ids) רצה אחריו ללא שינוי. שגיאות נושאות קוד + תווית סטטית בלבד,
  לעולם לא ערך גולמי או ציטוט של `JSON.parse`. 98 טסטים חדשים
  (`tests/unit/structured-output.test.ts`, `ai-structured-output-callers.test.ts`).
- **Strategy Grounding + Identity Hardening — generate-time פעיל, remediation infrastructure בלבד** (2026-09-16, המשך ישיר לחקירת האבחון
  (Strategy Grounding Diagnostic, read-only) ולעיצוב הארכיטקטורה
  (Strategy Hardening Architecture, read-only) שקדמו לה): מיישם את שני
  הפערים שנמצאו באופן ממשי בקוד — Evidence Grounding מעולם לא הופעל
  עבור Strategy (`generateObserved` אישר כל ציטוט ללא בדיקה מול
  `InterviewAnswer.answerText` האמיתי), ו-`insertObservedPrincipleWithEvidence`
  יצר תמיד identity+version 1 חדשים ללא תנאי, ללא שום matching מול
  עקרונות `observed` קיימים או בין proposals באותו batch — בדיוק המצב
  שבו DNA היה לפני `25fe506`.

  **Generate-time (פעיל מרגע שה-migration תאושר):** `checkEvidenceGrounding`
  ו-`classifyHypothesisMatch` (`src/lib/ai/dna-grounding.ts`/`dna-identity.ts`)
  נעשה בהם **reuse ללא שינוי** — נבדק במפורש שהם גנריים (אין טיפוס/פרומפט
  ספציפי ל-DNA) לפני החיווט. `groundValidatedObservedPrinciples`
  (`src/lib/strategy/ground-evidence.ts`) ו-`resolveObservedPrincipleIdentities`
  (`src/lib/strategy/resolve-principle-identity.ts`) הם port כמעט-מכני
  של המקבילות ב-DNA — `ValidatedObservedPrinciple` כבר זהה במבנה ל-
  `ValidatedHypothesis`. **הבדל אמיתי אחד, לא מכני:** `strategyPrinciples`
  היא טבלת identity הטרוגנית (declared/observed/validated יחד) —
  `filterToObservedCandidates` מסנן ל-`observed` בלבד **לפני** ההתאמה,
  אחרת דפוס observed טרי היה יכול "להתאים" ולגרום לגרסה חדשה על הצהרה
  מילולית של המשתמש או ברירת מחדל קבועה.

  **Remediation infrastructure (המיגרציה מוחלת; אין עדיין remediation אמיתי
  על 4 העקרונות ה-observed הקיימים בהחלטה זו — תוקן 2026-09-22, אומת קריאה-בלבד:
  טבלה `strategy_evidence_grounding_checks` קיימת בפועל על ה-DB האמיתי
  [`migration 0009_large_jackpot.sql` מוחלת, יש בה שורות אמיתיות מהרצות אחרות —
  אבל אפס שורות על ה-4 עקרונות observed של המשקיע האמיתי עצמו, כלומר עליהם עצמם
  עדיין לא רץ remediation אמיתי]):** טבלה חדשה `strategy_evidence_grounding_checks`
  — מקבילה סמנטית מדויקת ל-`dna_evidence_grounding_checks`
  אך **טבלה נפרדת** (לא reuse — `Evidence.strategy_principle_id`/
  `Evidence.dna_hypothesis_id` הן שתי עמודות subject שונות); `verdict`
  כן עושה reuse ל-enum `grounding_verdict` הקיים (סמנטית גנרי, לא
  ספציפי ל-DNA). ערך enum רביעי על `principle_created_by`:
  `system_grounding_revalidation` — enum **נפרד** מ-`dna_created_by`,
  אותו שם מחרוזת בלבד. `getEffectiveEvidenceForStrategyPrincipleVersion`
  ו-`planPrincipleGroundingRemediation` (`src/lib/strategy/remediate-grounding.ts`)
  הם ports מדויקים של המקבילות ב-DNA, כולל תיקוני ה-independent-review
  שנמצאו שם (`assertEvidenceBelongsToPrinciple` cross-identity guard,
  ו-completeness invariant על non-InterviewAnswer citations) **מיושמים
  מראש הפעם**, לא מתגלים בדיעבד.

  **נבדק ואומת:** typecheck ✓, lint ✓, 53/53 קבצי טסט, 420 עוברים +
  6 skipped בכוונה (migration 0009 לא הורצה — מזוהה אוטומטית בזמן ריצה,
  כמו ב-DNA). 2 טסטי אינטגרציה אמיתיים (`insertObservedPrincipleVersionWithEvidence`,
  כולל race אמיתי על 15 קריאות מקבילות) **רצו בפועל נגד Postgres אמיתי**
  ואישרו אמפירית את שם ה-constraint המקוצר
  (`strategy_principle_versions_strategy_principle_id_version_numbe`,
  63 תווים) — לא רק חושב.

  **מפורשות לא בוצע ביחידה הזו:** remediation אמיתי של 4 העקרונות
  ה-observed הקיימים (כולל אי-ההסכמה שנמצאה על `d29a3897`); הרצת
  migration 0009; קריאות AI אמיתיות; שינוי ל-`dna.generate` הרגיל;
  Strategy UI; Decision Review; Behavioral/Decision Independence.

  **עודכן (2026-10-02, אומת קריאה-בלבד):** ה-remediation האמיתי על עקרונות ה-observed רץ מאז בשלושה שערים
  מפוקחים: V3 (2026-09-25, `173720c6` v2), V3.1 (`3653aeed` v4) ו-V3.2 (2026-09-28, run `e5e459aa`). לכל 8
  עקרונות ה-observed של המשקיע האמיתי יש היום שורות grounding-check. `d29a3897` מוחרג כ-`unsupported`
  ב-`173720c6` v2 — ר' "Strategy — הכרעות Owner וסגירת שרשרת ה-grounding (2026-10-02)".
- **DNA Grounding Remediation — תשתית (2026-09-16); המיגרציה מוחלת וה-remediation
  האמיתי רץ בפועל על שתי ההשערות (תוקן במסמך 2026-09-22, אומת קריאה-בלבד)**
  (2026-09-16, Autonomous Unit 3, בהמשך ל-Autonomous Unit 1 [Evidence Grounding
  Audit, read-only] ו-Autonomous Unit 2 [architecture design, read-only]): בונה
  את המנגנון האחיד, ניתן-לשימוש-חוזר, שנדרש כדי לתקן גרסאות DNA
  שהראיה שלהן כבר לא עומדת ב-Evidence Grounding (commit `25fe506`) —
  **ביחידה הזו עצמה, בלי לבצע את התיקון בפועל** על שתי ההשערות שכבר אובחנו
  (`699cdb50`, `e1239589`, ר' Unit 1); זו הייתה במפורש **יחידת תשתית**, לא
  remediation אמיתי. **מאז (עדיין ב-2026-09-16, לפי timestamp על ה-DB
  האמיתי):** migration `0008` הוחלה וה-remediation האמיתי רץ בפועל —
  `699cdb50` קיבל `v2` (`system_grounding_revalidation`, 3 checks אמיתיים,
  ציטוט אחד `unsupported` בנימוק אמיתי מצוטט מהתשובה), `e1239589` קיבל `v2`
  (4 checks, 3 מתוכם `unsupported`) — בדיוק כפי שתואר כ"נדרש" בשורות למטה.
  התיעוד כאן לא עודכן בזמן אמת; זה תוקן עכשיו בקריאה-בלבד ישירה על ה-DB
  האמיתי, לא בהנחה.

  **סכימה חדשה (migration `0008_numerous_lily_hollister.sql`, מוחלת על
  ה-DB האמיתי — ר' Migration rule):** טבלה חדשה
  `dna_evidence_grounding_checks` (`id, dna_hypothesis_version_id FK,
  evidence_id FK, verdict(supported|unsupported), reason, checked_at`,
  `UNIQUE(dna_hypothesis_version_id, evidence_id)` בשם מפורש — לא
  auto-generated, כדי לא לחזור על הבאג המתועד למעלה של שמות constraint
  שנחתכים ב-63 תווים). ערך enum נוסף על `dna_created_by` הקיים:
  `system_grounding_revalidation` — לא `ai_generated` (לא הצעת AI
  טרייה) ולא `user_correction` (לא יזמת משתמש) — המערכת בודקת מחדש
  ראיה קיימת-שלה-עצמה. שני השינויים אדיטיביים בלבד — אין DROP/ALTER על
  נתונים קיימים.

  **הבעיה הארכיטקטונית שהתשתית פותרת (Unit 2):** Evidence שייך תמיד
  ל-identity, **לא** לגרסה ספציפית (`evidence.dna_hypothesis_id`) —
  `getEvidenceForDnaHypothesis` תמיד החזירה את כל הראיה, בלי סינון לפי
  גרסה. זה עבד תמיד כי כל מעבר-גרסה קודם רק **הוסיף** ראיה. Remediation
  הוא המקרה הראשון שבו לגרסה יש set קטן יותר מכלל הראיה של ה-identity —
  בלי תשתית חדשה, "View Evidence" היה ממשיך להציג ציטוט שהגרסה כבר לא
  סופרת, בלי שום דרך להסביר למה.

  **פתרון (`src/lib/dna/effective-evidence.ts` + `getEffectiveEvidenceForDnaHypothesisVersion`,
  `src/db/repositories/evidence.ts`):** הבחנה מפורשת בין raw/historical
  evidence (`getEvidenceForDnaHypothesis`, ללא שינוי, עדיין בשימוש
  ב-`dna.generate`'s identity matching) לבין effective evidence לגרסה
  ספציפית — נופל אוטומטית ל-behavior הישן (כל הראיה) כשלגרסה אין שורות
  grounding-check בכלל (כל גרסה שקיימת היום, וכל `new_version` רגיל
  מ-`dna.generate`, שלא כותב לטבלה החדשה בכוונה — ר' "מפורשות לא
  נבנה" למטה). `dna.evidence` (ה-query שמזין את "View Evidence" בעמוד)
  חובר ל-effective evidence של הגרסה העדכנית — שינוי מינימלי, ללא שינוי
  UI, שסוגר את הפער הזה מראש ברגע ש-remediation אמיתי יקרה.

  **Orchestrator ניתן-לשימוש-חוזר (`src/lib/dna/remediate-grounding.ts`,
  `planGroundingRemediation`):** מקבל hypothesis/version id (לא ids
  מקודדים), טוען ראיה גולמית + גרסה נוכחית, מריץ grounding אמיתי
  (מוזרק, `checkGrounding: RemediationGroundingFn` — לא AI אמיתי בטסטים)
  על כל ציטוט, וגוזר plan טהור (`no_op` / `checked_no_change` /
  `new_version`) בלי לכתוב ל-DB בעצמו — הכתיבה בפועל
  (`insertGroundingChecksForVersion`/`insertDnaHypothesisVersionWithGroundingChecks`,
  `src/db/repositories/dna.ts`) נשארת שכבה נפרדת. Idempotency: השוואת
  **סט מזהי-ראיה אפקטיביים** (לא flag/timestamp) בין הבסיס (מה שכבר
  נבדק לגרסה, או "כל הראיה" אם מעולם לא נבדקה) לתוצאה הטרייה — הרצה
  חוזרת על מצב שכבר תוקן ולא השתנה מחזירה `no_op` אמיתי (אפס כתיבות).
  כלל "same-tier evidence change" (שסוכם ב-Unit 2) ממומש במפורש: שינוי
  בסט הראיה יוצר גרסה חדשה גם כש-evidenceStrength לא חוצה tier (מקרה
  `e1239589`) — נבדק ישירות, לא רק tier-crossing (מקרה `699cdb50`).

  **תיעוד DNA schema:** ר' `docs/data-model.md` §2 לפירוט המלא.

  **מפורשות לא נבנה/לא בוצע ביחידה הזו (בוצע מאוחר יותר, ר' העדכון למעלה):**
  התיקון האמיתי על `699cdb50` ו-`e1239589`; הרצת ה-migration עצמה על ה-DB
  האמיתי. **עדיין מחוץ ל-scope גם היום:** שינוי כלשהו ל-grounding
  הרגיל בתוך `dna.generate` (ממשיך לא לכתוב ל-`dna_evidence_grounding_checks`
  בכוונה — אינטגרציה עתידית נפרדת, לא "כבר שיש טבלה"); Strategy
  Grounding Hardening; UI redesign ל-DNA page.

  **נבדק ואומת:** typecheck ✓, lint ✓ (0 warnings/errors בקוד
  הפרויקט — 94 warnings קיימים-מראש ולא-קשורים ב-`.claude/skills/impeccable/scripts/*.js`
  שהם קבצי skill חיצוניים, לא קוד הפרויקט), build ✓, 48/48 קבצי טסט
  (389 עוברים + 3 skipped בכוונה — ר' למטה). 15 טסטים חדשים ב-
  `tests/unit/remediate-grounding.test.ts`/`tests/unit/effective-evidence.test.ts`
  (כולם דרך production helpers אמיתיים — `countIndependentCases`,
  `calculateEvidenceStrength`, `selectEffectiveEvidence` — עם AI מוזרק,
  אף פעם לא קריאה אמיתית; שניים מהתרחישים משכפלים בכוונה את המספרים
  האמיתיים שנמצאו ב-Unit 1 עבור `699cdb50`/`e1239589`, כ-regression
  ישיר על הממצא המאובחן). 3 טסטים אינטגרציה חדשים
  (`tests/integration/dna-grounding-remediation.test.ts`) **מדווחים
  כ-skipped בכוונה** — דורשים את הטבלה החדשה שעדיין לא קיימת ב-DB
  האמיתי (אין DB מבודד לטסטים בפרויקט הזה); מזוהה אוטומטית בזמן ריצה
  (`42P01`), לא מוסתר/מזויף כ-pass. יופעלו אוטומטית ברגע שה-migration
  תאושר ותרוץ.
- **Investment Episode Independence — Evidence Strength ל-DNA/Strategy**
  (2026-09-14): תוקן gap אמיתי שנמצא תוך כדי חקירה חיה על נתוני MP
  אמיתיים — לא נבנה כ-backlog item נפרד קודם (investigation→design→
  implementation ברצף אחד, ר' "עודכן" למעלה תחת Manual Historical
  Entry לאיפה שהפער תועד בפועל בזמנו).

  **הבעיה:** `answerCaseKeys` (ב-`dna.ts`/`strategy.ts`, זהה בשני
  הקבצים) מיפה case key לפי `transactionId ?? answerId` גולמי — פוזיציה
  אחת רציפה עם כמה transactions (BUY + partial SELL + final SELL, כמו
  MP האמיתי) הייתה יכולה להיספר כ-2-3 independent cases נפרדים ב-
  Evidence Strength, במקום case אחד — סיכון ממשי לחצות סף
  Insufficient→Moderate על בסיס פוזיציה בודדת.

  **הפתרון:** `deriveEpisodeKeys()` (בתוך `computePositions()`,
  `src/lib/portfolio/positions.ts`) — חישוב נפרד, in-memory, לא
  persisted, שמזהה אילו transactions שייכים לאותו "investment episode"
  רציף (פתוח→שטוח). מודל של שני מספרים בלבד לכל טיקר: `ceiling` (חסם
  עליון מוכח, אף פעם לא מוכיח פתיחה) ו-`exactKnown` (הערך המדויק,
  כשאין אי-ודאות). episode חדש מוכח **רק** מ-exact crossing מעל epsilon
  — לעולם לא מ-`ceiling` בלבד. שיוך מפתח הוא retrospective/run-based:
  transactions אחרי סגירה מצטברים ב-buffer עד שמוכחת פתיחה (כל ה-buffer
  מקבל מפתח חדש אחד) או סגירה נוספת/סוף הכרונולוגיה (הכל ממוזג אחורה).
  `buildAnswerCaseKeys` (`src/lib/evidence/build-answer-case-keys.ts`)
  הוא ה-helper המשותף היחיד ש-`dna.ts`/`strategy.ts` קוראים לו — לא
  מימוש כפול. `transactionId===null` ממשיך ל-`answer.id`, ומיפוי חסר
  קורס ל-sentinel קבוע אחד (`__unmapped__`), אף פעם לא ל-transactionId
  הגולמי. כולל migration תוסף (`0007_wild_unus.sql`): `intra_day_order`/
  `order_unknown_reason` על `transactions` (ordering contract ליום
  התנגשות) + backfill ממוקד + partial unique index, ו-contract אטומי
  ב-`confirmTransactionsWithOrdering` (advisory lock per investor+ticker+
  date) עבור Import/Manual Entry.

  **Scope boundary, נאכף בקוד:** ה-derivation החדש חולק עם ה-accumulator
  הקיים אך ורק את `applyTransactionToQuantity()` — לא נוגע ולא נקרא
  ע"י quantity/totalCostBasis/avg cost/sellTrace/warnings/positions
  המוצגים. אומת ב-raw-diff review נפרד לפני commit.

  **מאומת חי, read-only, על MP האמיתי (לא סינתטי):** שלוש ה-
  InterviewAnswer המקושרות לשלוש עסקאות ה-MP (BUY, partial SELL, final
  SELL) — כולן resolve ל-case key אחד, `MP#1`, דרך `buildAnswerCaseKeys`
  האמיתי. `dna.generate` **לא** הורץ במהלך העבודה הזו.

  **נבדק ואומת:** typecheck ✓, lint ✓, build ✓, 338/338 טסטים (40/40
  קבצים) — כולל property/oracle suite (N=2..6 permutations דרך אותו
  `applyTransactionToQuantity` production, לא re-implementation),
  integration test אמיתי על concurrent confirms (advisory lock מול
  Postgres אמיתי).

- **Sector + Industry Exposure — Portfolio Fit / Case / Personal Fit / Decision** (2026-09-08): חישוב
  deterministic של חשיפה מצטברת לפי sector+industry, current+projected, ב-`computePortfolioFit`, מוזן כ-structured
  context ל-Case Synthesis, Personal Fit, ו-Decision. Option A מצומצם, כפי שאושר — לא theme/risk-driver (נשאר פתוח
  ונפרד, ר' למטה), לא AI classification, לא persistence/schema change.

  **Contract:**
  - Percentages תמיד מול `totalPortfolioValueUsd` **כולל cash** — "כמה מהתיק חשוף לסקטור X". **אין** דרישה
    ש-`Σ(sectorExposure.weightPercent)=100%` — cash לא נכנס לשום bucket. במקום זאת:
    `cashWeightPercent + Σ(sectorExposure.weightPercent) ≈ 100%` (ובנפרד לאותו דבר על industry) — invariant
    שנבדק ישירות בטסטים ברמת דיוק גבוהה (`toBeCloseTo(100, 8)`), לא display-rounded.
  - `cashValueUsd`/`cashWeightPercent` נחשפים בנפרד על `PortfolioFit`. Cash **לעולם לא** sector/industry, **לעולם
    לא** נכנס ל-null bucket.
  - `sector: null`/`industry: null` = **Unclassified Holding בלבד** — holding אמיתי בלי נתון סיווג (מ-FMP או חסר
    ב-classification map), לא cash, לא "נזרק" מה-breakdown.
  - Projected ממשיך את הסמנטיקה הקיימת ("`sizeDollars` = הקצאה מתוך cash קיים, total קבוע") — לא סמנטיקה מקבילה
    חדשה: `projectedCashValueUsd = cash − sizeDollars` (**בלי clamp** — יכול לצאת שלילי כש-`sizeDollars > cash`,
    עקבי עם ה-warning הקיים), `projectedSectorExposure`/`projectedIndustryExposure` = current buckets + sizeDollars
    ל-bucket של ה-candidate. כל בדיקת `sizeDollars` חדשה משתמשת ב-`!== undefined`, לא truthiness —
    **`sizeDollars=0` הוא projected state מוגדר** (שווה סמנטית ל-current), לא `null`; מכוסה בטסט ייעודי.
  - `null` כש-`sizeDollars` לא הוגדר בכלל (אותו pattern כמו `projectedPositionValueUsd` הקיים).

  **Data shapes** (`src/lib/portfolio/portfolio-fit.ts`): `PortfolioFitCandidate` מקבל `sector: string | null`,
  `industry: string | null` **חובה**, לא optional. `TickerClassification { sector, industry }` — מפה משותפת אחת
  (לא שתי מפות נפרדות), כי שני הנתונים תמיד מגיעים מאותו `MarketIntelligence`. `SectorExposureEntry`/
  `IndustryExposureEntry` — `{ sector/industry, valueUsd, weightPercent }`. `computePortfolioFit` מקבל ארגומנט
  רביעי חדש, `classificationByTicker`.

  **Candidate classification precedence** (נפרד מ-candidate **price** precedence שנסגר קודם ב-`fb7e48f`): כש-
  `position.ticker === candidate.ticker`, `candidate.sector`/`candidate.industry` גוברים תמיד על
  `classificationByTicker[ticker]` — invariant דטרמיניסטי על הפונקציה הטהורה עצמה, לא הסתמכות על משמעת caller
  (שני ה-callers האמיתיים כבר מסננים את ה-candidate מהמפה, בדיוק כמו ב-price). נבדק גם עם קונפליקט מכוון
  (`classificationByTicker` עם sector שונה מ-`candidate.sector`) וגם ב-projected (אותו classification משמש גם
  ל-holding קיים וגם לתוספת `sizeDollars` — לא מתפצל לשני buckets).

  **Reuse, אין fetch נוסף:** classification נאסף **תמיד** מאותו `MarketIntelligence` שכבר נשלף לצורך price —
  `portfolio-fit-for-investor.ts`'s לולאת `otherTickers` (שולפת `intelligence.sector`/`.industry` לצד `.price`),
  `decisions.ts`'s לולאה מקבילה (אותו דבר, שינוי צר — הכפילות בין השתיים **לא** אוחדה, נשארת follow-up נפרד),
  ו-`cases.ts`'s שני ה-call sites הקיימים (`intelligence` כבר בזיכרון מ-`marketIntelligenceJson`).

  **Personal Fit — precondition חדש:** `generatePersonalFit` (`cases.ts`) לא היה תלוי ב-Market Intelligence
  בכלל; עכשיו דורש אותו (`BAD_REQUEST` אם חסר), עקבי עם שתי המוטציות האחיות. קורא ל-`computePortfolioFitForInvestor`
  **בלי** `sizeDollars` (Personal Fit הוא current-only, אין projected, אין sizeDollars חדש) ומעביר ל-
  `synthesizePersonalFit` גם `candidateSector`/`candidateIndustry` (ה-classification של המניה הנבדקת עצמה, מאותו
  `intelligence` שכבר בזיכרון — לא רק חשיפת התיק) וגם `sectorExposure`/`industryExposure` (לא cash) — שני סוגי
  הנתונים ביחד, לא רק חשיפת התיק לבדה (ר' "תוקן בפועל" למטה: זה נמצא כ-blocker נפרד ב-review לפני commit).
  `PERSONAL_FIT_SYSTEM_PROMPT` הורחב: מותר לחבר בין ה-classification של ה-candidate לבין חשיפת התיק — **אסור**
  ל-AI לסווג candidate בעצמו, **אסור** threshold מומצא.

  **Formatting — מקור אמת אחד:** `src/lib/ai/format-portfolio-fit.ts` חדש (`formatCashLine`/
  `formatSectorExposureLine`/`formatIndustryExposureLine`) — בשימוש ב-`case.ts`'s `formatPortfolioFit` **וגם**
  `formatPersonalFitContext`, **וגם** `decision.ts`'s `formatContext` — לא שלושה מימושי-רינדור נפרדים לאותו
  concept.

  **תוקן בפועל (2026-09-09, לפני commit, external review על ה-raw diff):** ה-projected sector/industry
  aggregation יצר "phantom bucket" בעל `valueUsd=0` (למשל "Unclassified 0.0%") כש-candidate **חדש (לא מוחזק)**
  קיבל `sizeDollars=0` — `addToBucket()` מוסיף unconditionally גם `amount=0` למפתח שלא היה קיים ב-map עדיין. הטסט
  היחיד שכיסה `sizeDollars=0` נבחר במכוון עם candidate **שכבר מוחזק** (כדי "לא ליצור bucket חדש-ריק") — כלומר
  המקרה הבעייתי היה סיכון ידוע שלא נבדק, לא רק התגלה בהפתעה. **תיקון:** הפרדה בין שתי שאלות שהיו ממוזגות לאחת —
  "האם קיים projected state בכלל" נשאר `sizeDollars !== undefined` (ללא שינוי, עדיין לא truthiness), אבל "האם יש
  ערך אמיתי להוסיף ל-bucket" הוא `sizeDollars !== 0` — guard חדש סביב שתי קריאות ה-`addToBucket` בלבד (לא סביב
  ה-`if` הראשי). `sizeDollars=0` עדיין מייצר projected state **לא-null**, פשוט זהה ל-current — לא "absent". נוספו 3
  regression tests ב-`portfolio-fit.test.ts` (candidate חדש לא-מסווג עם `sizeDollars=0`; candidate חדש מסווג עם
  `sizeDollars=0`; holding קיים בלי entry כלל ב-`classificationByTicker` → null bucket, פער coverage נוסף שה-review
  ציין) וקובץ טסט חדש `tests/unit/format-portfolio-fit.test.ts` (5 טסטים, אותו pattern כמו
  `format-price-size.test.ts` — פונקציית פורמט טהורה בלי Anthropic/DB) שמוכיח **גם ברמת הטקסט ה-AI-facing בפועל**
  (לא רק ה-array הגולמי) שלא מוצגת שורת "Unclassified 0.0%" פנטומית.

  **תוקן בפועל #2 (2026-09-09, לפני commit, אותו external review, blocker נוסף):** Personal Fit קיבל את חשיפת
  ה-**תיק** (`sectorExposure`/`industryExposure`) אבל לא את ה-classification של ה-**candidate עצמו** — כדי לחבר
  "הרעיון הזה נמצא בסקטור שהתיק כבר חשוף אליו ב-45%" ה-AI היה צריך לסווג את הטיקר בעצמו מידע כללי, בדיוק ה-
  AI-classification non-goal שהפיצ'ר הזה קיים כדי למנוע (`case.ts`/`decision.ts` לא נפגעו — שניהם כבר מקבלים את
  `intelligence` המלא של ה-candidate, כולל sector/industry, כחלק מה-context שלהם). **תיקון:** `PersonalFitInput`
  קיבל `candidateSector: string | null` / `candidateIndustry: string | null` חדשים (חובה, לא optional);
  `generatePersonalFit` (`cases.ts`) מעביר אותם מאותו `intelligence` שכבר בזיכרון (אין fetch נוסף);
  `formatPersonalFitContext` **הפכה ל-exported** (אותו pattern כמו `decision.ts`'s `formatContext`) ומרנדרת
  `Candidate sector: X` / `Candidate industry: Y` במפורש, `Unclassified` כש-null (לא מוסתר). נוסף
  `tests/unit/case-format-personal-fit-context.test.ts` חדש (6 טסטים) שבודק את ה-formatter האמיתי ישירות.

  **נבדק ואומת (אחרי שני התיקונים):** typecheck ✓, lint ✓, 293/293 טסטים (36/36 קבצים) — 39 חדשים לכל הפיצ'ר: 27
  ב-`tests/unit/portfolio-fit.test.ts` (24 מהבנייה המקורית + 3 מתיקון #1), 1 ב-`tests/unit/decision-format-context.test.ts`
  (Unclassified מוצג, לא נעלם), 5 ב-`tests/unit/format-portfolio-fit.test.ts` (חדש, מתיקון #1), 6 ב-
  `tests/unit/case-format-personal-fit-context.test.ts` (חדש, מתיקון #2). 18 הטסטים הקיימים ב-`portfolio-fit.test.ts`
  (כולל 7 candidate-price-precedence מ-`fb7e48f`) עודכנו בעיקר להתאמת החתימה החדשה (sector/industry/classification
  map); assertions קיימים לא שוכתבו, ובמקומות רלוונטיים נוספו assertions לשדות ה-exposure/projected החדשים (למשל
  "leaves projected fields null when no hypothetical size is given" קיבל assertions נוספים לארבעת שדות ה-projected
  החדשים, לצד ה-assertions המקוריים שנשארו כפי שהיו).

  **`case.ts`'s `formatPortfolioFit` — עדיין לא נוסף לו טסט ייעודי:** לא exported, אין pattern קיים לבדיקת
  פונקציות פרטיות בקובץ הזה — עקבי עם ההנחיה לא לבנות test infrastructure חדשה רק לצורך זה; מדווח כאן במפורש, לא
  הוחלט בשקט. **שונה מ-`formatPersonalFitContext`:** זו כבר exported ונבדקת (ר' תיקון #2 למעלה) — אותו pattern
  כמו `decision.ts`'s `formatContext`.

  **מפורשות לא נבנה כאן:** theme/risk-driver (ר' "Concentration מעבר ל-sector" למטה — נשאר פתוח ונפרד, לא סגור),
  AI classification, threshold ריכוזיות שרירותי, איחוד הכפילות `decisions.ts`/`computePortfolioFitForInvestor`
  (follow-up נפרד), שינוי `computePositions`, migration/persistence.
- **`computePortfolioFit` — candidate price precedence כשה-candidate
  כבר מוחזק** (2026-09-08, נמצא תוך כדי חקירת Sector/Industry Exposure
  — תוקן כתיקון מבודד, לפני עבודת ה-sector עצמה): `PortfolioFitCandidate.price`
  הוא `required` ושני ה-production callers (`portfolio-fit-for-investor.ts`,
  `decisions.ts`) כבר מעבירים אותו — אבל **לפני** התיקון, כשה-candidate
  ticker כבר היה מוחזק, שני ה-callers האלה גם מסננים אותו החוצה מ-
  `currentPricesByTicker` (ההערה הקיימת ב-`portfolio-fit-for-investor.ts`
  מנמקת זאת במפורש: "כבר נשלף פעם אחת בשביל ה-candidate עצמו, אין סיבה
  לשלוף פעמיים"). **`computePortfolioFit` לא השתמש ב-`candidate.price`
  בכלל** — אז ה-valuation של הפוזיציה הקיימת נפל ל-`costBasisPerShare`
  במקום למחיר החי שכבר היה בזיכרון.

  **ההשפעה** הייתה על שדות שכבר מוצגים בפרודקשן, לא רק תיאורטית:
  `existingPositionValueUsd`, `existingWeightPercent`,
  `totalPortfolioValueUsd`, `totalPortfolioValueApproximate`,
  `warnings` (אזהרת "no live price" שקרית), `largestCurrentPositionTicker`/
  `largestCurrentPositionWeightPercent`, ו-`projectedPositionValueUsd`/
  `projectedWeightPercent` (יורש את אותה שגיאה — מאומת מספרית: תיק עם
  cash=$1,000, holding קיים 10 מניות @ cost-basis $100, candidate.price
  אמיתי $150 — לפני התיקון `existingPositionValueUsd=$1,000`/50%,
  אחרי התיקון $1,500/60%, פער של $500 ו-10 נקודות אחוז; עם `sizeDollars=$500`
  נוסף — `projectedWeightPercent` יצא 75% במקום 80% הנכון). רלוונטי לכל
  תרחיש ADD/REDUCE/HOLD/SELL על טיקר שכבר מוחזק, לא רק BUY על טיקר חדש.

  **התיקון** (`src/lib/portfolio/portfolio-fit.ts`): עבור
  `position.ticker === candidate.ticker`, `candidate.price` הוא מקור
  ה-live-price — לא `currentPricesByTicker[position.ticker]`. לכל טיקר
  אחר, precedence זהה-בית לקודם (`currentPricesByTicker` → `costBasisPerShare`
  → 0). שינוי שורה אחת (עם הערה), אין שינוי ל-source-of-funds semantics
  (`sizeDollars`), אין שינוי ל-`portfolio-fit-for-investor.ts`/
  `decisions.ts`/`cases.ts` (כבר מעבירים `candidate.price` נכון —
  הבעיה הייתה רק בפונקציה המקבלת).

  **Regression coverage חדש, מדמה תנאי production אמיתיים — לא רק
  שהפונקציה רצה:** `tests/unit/portfolio-fit.test.ts` — 7 טסטים חדשים
  (18/18 בקובץ), כולל תרחיש שבו `candidate.ticker` **נעדר** מ-
  `currentPricesByTicker` (תואם את שני ה-callers האמיתיים) וכולל
  תרחיש-קונפליקט מפורש (`candidate.price=150` מול
  `currentPricesByTicker.AAPL=120` — ערכים שונים בכוונה, ההוכחה
  היחידה למי-מנצח). **ההערה נוספה גם לטסטים הקיימים** שמזל-בלבד
  השתמשו באותו ערך בשני המקורות — מתועד שהם לא הוכיחו precedence,
  לא נמחקו (עדיין תקפים לתרחישים שהם כן בודקים).

  **נבדק ואומת:** typecheck ✓, lint ✓, 254/254 טסטים (34/34 קבצים).
  **בדיקת snapshot אמיתית, read-only, על שתי ההחלטות הקיימות** — LLY
  (`00501224-a28b-4b6c-855c-ad72f76946b4`) ו-SNDK
  (`3fd5b614-daa0-493e-bd3a-1bb8d82f86f3`): ב-`portfolio_state_json`
  הקפוא של שתיהן, ה-ticker הנחקר **לא** מופיע ב-`positions[]` —
  **אף אחת מהן לא הושפעה** מהבאג (שתיהן היו candidate-לא-מוחזק בזמן
  ההחלטה: LLY היה BUY ראשון, SNDK היה PASS על טיקר שלא הוחזק). ראיה
  מהנתון הקפוא עצמו, לא ממצב התיק היום.

  **אין קשר ל-Sector/Industry Exposure** — נמצא תוך כדי אותה חקירה, אבל
  זה תיקון עצמאי לגמרי ל-`computePortfolioFit` הקיימת; sector/industry
  עדיין לא נבנה, ר' "פתוח" למעלה.
- **Manual Historical Entry + "Tell me why"** (2026-09-08): מאפשר להזין
  ידנית עסקאות היסטוריות **אמיתיות** (Actual בלבד — Hypothetical מפורשות
  מחוץ ל-scope) בלי לחכות לקובץ broker, ולתעד רציונל של עסקה דרך flow
  נפרד ביוזמת המשתמש.

  **Manual entry עצמה:** `import.confirmManualEntry` mutation חדש
  (`src/server/routers/import.ts`) — batch של שורות (ticker/type buy-sell
  בלבד/quantity/price/date/notes אופציונלי), נכתב לאותה טבלת
  `transactions` שה-CSV import כותב אליה, עם `source: "manual_entry"`
  (ערך enum שכבר היה קיים בסכימה, לא היה בשימוש) ו-`importBatchId: null`
  (nullable כבר בסכימה — תואם בדיוק את מה שאומת בחקירה). `amount` אף
  פעם לא מתקבל מה-client — מחושב server-side דרך
  `computeAmountFromQuantityPrice` (`src/lib/import/validate.ts`, מיוצא
  ומשומש-מחדש **גם** ע"י ה-CSV import path עצמו אחרי refactor — אותה
  נוסחה קנונית אחת, לא שני מימושים). כל ה-batch עטוף ב-`db.transaction`
  יחיד (`insertTransactions` שונה מ-`db: typeof Db` ל-`db: DbOrTx`, אותה
  תבנית שכבר נבנתה ב-decision creation atomicity) — כשל באמצע ה-batch
  משאיר אפס שורות, לא batch חלקי (מאומת ב-integration test עם FK
  violation אמיתי, לא simulated).

  **`/import` UI:** טאב "הזנה ידנית" לצד "ייבוא מקובץ" הקיים
  (`src/app/import/page.tsx`) — טופס multi-row (הוסף/הסר שורה, submit
  אחד ל-batch שלם, `useSubmitGuard` עם key נפרד מ-CSV path). Provenance
  מוצג ניטרלית ("הוזן ידנית" + הסבר) — **לא** "פחות אמין/מדויק", לפי
  החלטת Product מפורשת. שדה `notes` (אם ממולא) מנוסח בבירור בטופס
  שהוא הערה כללית, לא רציונל — `transactions.notes` עדיין לא נקרא בשום
  מקום בצינור ה-Evidence.

  **"Tell me why" — flow נפרד לגמרי מהראיון האלגוריתמי:** **Contract
  (עודכן 2026-09-08 — מחליף במפורש החלטה קודמת שהגבילה את ה-flow
  ל-"אותו batch בלבד"):** זמין על **כל** transaction בבעלות המשקיע עם
  `source="manual_entry"` — בלי הגבלת זמן, בלי batch identifier, בלי
  entity/token חדשים. נאכף ב-server בלבד (`interview.startTellMeWhy`,
  `src/server/routers/interview.ts`): שני תנאים — בעלות (`investorId`)
  ו-`source === "manual_entry"`. **לא נדרש שינוי לוגי במוטציה עצמה** —
  היא כבר תאמה לחוזה הרחב הזה מלכתחילה; רק ניסוח ההערות/התיעוד/הודעת
  השגיאה תוקן כדי לא לטעון ל-"אותו batch"/"just entered" יותר. **ה-UI
  עדיין חושף את הכפתור רק ישירות אחרי submit של הזנה ידנית** — סיבה
  נפרדת ונקייה מה-contract: אין עדיין מסך "כל העסקאות הידניות שלי"
  שיציג את הכפתור במקום אחר, לא מגבלה בחוזה עצמו. בניית מסך כזה היא
  future work, לא נדרש כאן. אינו נוגע ב-`selectInterestingTransactions`,
  ב-`maxCount=6`, ואינו slot נוסף בתוך `interview.start` — session חדש
  משלו, `origin: "user_initiated"`. השאלה נבנית **בקוד, לא AI**:
  `buildTellMeWhyQuestion` (`src/lib/interview/tell-me-why-question.ts`)
  — פונקציה סינכרונית, ללא import של Anthropic client בקובץ כלל,
  מייצאת string ישירות; ה-Hebrew template עצמו ב-`src/lib/i18n/strings.ts`
  (`tellMeWhy.questionTemplate`). התשובה נשמרת דרך `insertInterviewAnswer`
  ו-`interview.answer`/`interview.complete` הקיימים **ללא כל שינוי** —
  reuse מלא, לא entity חדשה.

  **Provenance של InterviewAnswer — migration מינימלית אחת:** נבדק
  לפני edit: לא היה שום field/concept קיים (`interview_answers` ו-
  `interview_sessions` — שניהם ללא עמודת source/origin/type). נוסף
  `interview_sessions.origin` (עמודה יחידה ברמת ה-session, לא ברמת
  התשובה — "Tell me why" תמיד יוצר session חדש עם תשובה אחת, אז זה
  מספיק) — enum חדש `interview_session_origin(guided_interview|
  user_initiated)`, migration `0006_cooing_rawhide_kid.sql`. `getAllAnswersForInvestor`
  (`src/db/repositories/interview.ts`) עודכן להחזיר גם `origin`, כדי
  שזה ייבדק בפועל דרך אותה פונקציה ש-`dna.generate`/`strategy.ts`'s
  observed-principles מפעילים — לא רק theoretically joinable. **Traceability
  בלבד, כפי שסוכם:** provenance **לא** משנה Evidence Strength/weighting;
  `answerCaseKeys`/`countIndependentCases` לא נגעו כלל.

  **עודכן (2026-09-14) — הטענה למעלה נכונה נכון לזמנה, לא יותר:**
  `answerCaseKeys` עצמו **כן** נגע מאז — ר' "Investment Episode
  Independence" למטה. `countIndependentCases` עצמו עדיין לא נגע (השינוי
  היה ב-case **key** שמוזן אליו, לא בפונקציה עצמה).

  **InterviewAnswer — יחס ל-transaction:** נשאר עמודה יחידה (`transaction_id`),
  לא junction table/מערך — מאומת בחקירה נפרדת שאין בעיה אמיתית: `answerText`
  הוא טקסט חופשי לחלוטין, לא נאכף מבנית שהוא "מדבר רק על" ה-anchor
  transaction. MP מקושר ל-BUY כ-anchor; הסיפור המלא (buy→partial
  sell→full sell→capital rotation) נכתב כטקסט חופשי אחד, מאומת
  ב-integration test שהוא מגיע במלואו ל-`getAllAnswersForInvestor`.

  **מפורשות לא נבנה, לפי scope מאושר:** forced-include ב-`interview.start`,
  שינוי `maxCount`, שינוי ל-`selectInterestingTransactions`, confidence
  scale חדש לעסקה ידנית (`source="manual_entry"` הבינארי מספיק כרגע),
  Evidence weighting לפי provenance, DNA ingestion ישירות מ-`transaction.notes`,
  שינוי ל-`computePositions()` (נבדק כ-black box בלבד), sector exposure,
  Later Context, שינויי Strategy, ו-**מנגנון deduplication חוצה-source**
  (ר' "פתוח" מעל — נמצא: **אין שום מנגנון dedup כרגע, לא רק cross-source**,
  כולל תיקון סטייה מתועדת ב-`docs/architecture.md` §2.1 שטענה אחרת).

  **נבדק ואומת:** typecheck ✓, lint ✓, 247/247 טסטים (34/34 קבצים, 33
  טסטים חדשים — **אושר בפועל עם `vitest run --reporter=verbose`, לא
  רק חושב**: 24 unit ב-`tests/unit/manual-entry.test.ts`
  (`computeAmountFromQuantityPrice`/`manualTransactionRowSchema`/
  `manualEntryBatchSchema`/`buildManualTransactionValues`, כולל
  הרחבות `it.each`), 5 unit ב-`tests/unit/tell-me-why-question.test.ts`,
  4 integration ב-`tests/integration/manual-entry.test.ts` — MP
  acceptance מקצה-לקצה דרך `computePositions` האמיתי (position סגורה
  ל-0, שני `sellTrace` עם P&L חיובי), atomicity עם FK violation אמיתי,
  provenance + reader function, `getTransaction`).

  **דיוק חשוב על "provenance + reader function" — לא לתאר כ-"DNA
  pipeline end-to-end":** ה-integration test מוכיח ש-InterviewAnswer
  ה-user-initiated נשמר, וחוזר נכון (עם `answerText`/`transactionId`/
  `origin` תקינים) דרך `getAllAnswersForInvestor` — **אותה פונקציית
  reader** ש-`dna.generate`/`strategy.ts`'s observed-principles קוראים
  לה בפועל. **הטסט אינו מריץ את `dna.generate` עצמו** (זה ידרוש קריאת
  Anthropic אמיתית). נבדק במפורש אם קיים helper/consumer מתחת ל-
  `dna.generate` שניתן היה לבדוק בלי AI call/mocking/שכפול/ארכיטקטורת
  טסטים חדשה — התשובה: לא בלי לגעת גם ב-`dna.ts` וגם ב-`strategy.ts`
  (שני הראוטרים בונים `answerCaseKeys`/את קלט ה-AI inline, לא דרך
  helper מיוצא משותף) — חריגה מ-scope המשימה הזו, לא "מינימלי ונקי".
  לכן לא נוסף test infrastructure חדש; התיעוד דויק במקום זאת.

  **עודכן (2026-09-14) — הפער הזה נסגר:** `buildAnswerCaseKeys`
  (`src/lib/evidence/build-answer-case-keys.ts`) הוא עכשיו בדיוק ה-helper
  המיוצא-המשותף שחסר כאן — שני הראוטרים קוראים לו, לא בונים
  `answerCaseKeys` inline יותר. ר' "Investment Episode Independence"
  למטה.

  **לא מוכח (נשען על code-review ידני, כמו בכל הסבבים הקודמים):**
  ש-`confirmManualEntry`/`startTellMeWhy` עצמם (שכבת ה-router — Zod
  validation, ownership checks) מחוברים נכון ל-production — אין תקדים
  ל-tRPC caller בטסטים בפרויקט הזה כולו, לא נוסף כאן.
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

### פתוח — ניקוי משקיעים סינתטיים מה-DB האמיתי (נמצא 2026-09-22)
- **מה:** לפני ה-guard ב-`tests/support/` (Test DB Safety), `vitest run` רץ מול
  ה-`DATABASE_URL` מ-`.env` — כלומר ה-DB האמיתי. נמדד (קריאה בלבד): 623 שורות
  `investors`, מהן ~605 fixtures סינתטיים של טסטים (2026-08-13 ואילך, ~100 ב-2026-09-19
  לבדו) עם כל ההיסטוריה הכבדה שכתבו. המשקיע האמיתי (`0dc4b076…`) לא מושפע —
  כל הניתוחים מסוננים לפי `investor_id`.
- **למה לא נוקה:** הטבלאות immutable (insert-only) ו-DELETE ישיר הוא פעולה הרסנית
  לפי AGENTS.md — נדרש אישור מפורש + גיבוי; לא בוצע.
- **החלטה נדרשת:** האם למחוק (ואיך, ב-tx אחד לפי `investor_id` של ה-fixtures בלבד) או להשאיר.
  ה-guard מונע הצטברות נוספת.
