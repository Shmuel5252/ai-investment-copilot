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

### Transactions — אין שום מנגנון deduplication, לא cross-source ולא בכלל
**נמצא:** 2026-09-08, תוך כדי חקירת Manual Historical Entry — נבדק
במפורש כי המשתמש מתכנן לייבא בעתיד CSV אמיתי מהברוקר שעשוי לכלול
עסקאות שכבר הוזנו ידנית (או ייבוא חוזר). נבדק בקוד, לא הונח מהתיעוד:

- **אין UNIQUE constraint על `transactions`** בשום migration
  (`src/db/migrations/*.sql`) — רק שני FK (`investor_id`,
  `import_batch_id`), שום אילוץ ייחודיות על ticker/date/quantity/price
  או כל שילוב שלהם.
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
ר' "DNA Grounding Remediation — תשתית" למטה) שמכובד ע"י אותו constraint
בדיוק, מאומת ב-integration test ייעודי (עדיין ממתין להרצת migration
0008, ר' שם). ה-constraint הזה, אם כך, כבר לא "הגנה תיאורטית בלבד" —
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

### Evidence Strength — גרסאות שכבר נשמרו מפרות את האינווריאנט (דורש remediation append-only נפרד)
**נמצא:** 2026-09-20, אגב תיקון הסמנטיקה (ר' "נבנה"). שתי גרסאות אמיתיות
נשמרו תחת הכלל הישן ועדיין הגרסה **האחרונה** שלהן: `dna 7c3665ca v1`
(S=2,C=1, `moderate`) ו-`strategy 3653aeed v2` (S=2,C=1, `moderate`). תחת הכלל
החדש שתיהן `insufficient_evidence`. **השפעה ממשית, לא רק תווית:**
`excludeInsufficientEvidence` (cases/decisions/reviews) כולל אותן עכשיו
בהקשר ה-AI של Personal Fit / הערכה בזמן-אמת. כל שאר 17 הגרסאות עם tier
תואמות. **לא בוצע** — היסטוריה immutable; הפתרון הוא גרסה חדשה append-only
עם tier מחושב מחדש (דטרמיניסטי, ללא AI). פתוח לפני שמימוש: ל-`created_by`
אין ערך שמתאים ("recompute") — `system_grounding_revalidation` מטעה, ערך חדש
דורש enum migration; החלטה נפרדת.

### Behavioral/Decision Independence חוצה-tickers — עכשיו מהותי (`a48426b1`)
**נמצא:** 2026-09-20. `deriveEpisodeKeys` (`positions.ts`) הוא per-ticker מהגדרתו
("no state crosses tickers"), ולטבלת `transactions` אין שום עמודת קישור בין
עסקאות (רק `ticker, quantity, price, amount, notes` חופשי, `intra_day_order`).
במציאות: המכירה הסופית של MP (MP#1) והקנייה של MRVL#3 — שתיהן ב-2026-08-28,
פדיון MP ≈$506 מול קנייה ≈$1,000 ("חלק מההון") — הן **החלטת הקצאה אחת**, ונספרו
כשני מקרים (S=2 במקום 1) ב-`a48426b1`. נשאר insufficient כי S<3 (שער ה-tier
סופר supporting cases בלבד).
**כיוון אפשרי לבחינה (לא אושר, לא מומשה):** לעגן קישור ב-**transaction ids**
(immutable), לא ב-episode keys (נגזרים מחדש בכל קריאה): עובדת קישור
`from_txn/to_txn/kind/origin`; שני episodes מקושרים אם כל עסקה שלהם מקושרת;
פונקציית ה-case-key ממוטטת רכיבי קשירות. מקור הקישור: מועמדים דטרמיניסטיים בקוד
(SELL→BUY חוצה-tickers באותו יום או למחרת, עלות ≥ פדיון, ו/או שתי תשובות
שמזכירות זו את הטיקר של זו) + **אישור משתמש** (AI לא קובע עובדות). נדחו:
`decision_episode_id` מאוחסן (episodes נגזרים בכוונה, לא מאוחסנים), ו-
`capital_reallocation_event_id` (צר מדי — עצמאות היא תכונה של ה-*אירוע*, לא של
סוג ה-claim).
**מדיניות למקרה שהקישור לא ידוע — לא הוכרעה בכוונה.** ההתנהגות הנוכחית (מקרים
חוצי-tickers נספרים כעצמאיים) מנפחת S, ולכן היחידה העתידית חייבת להעריך אותה
במפורש מול האינווריאנט "אי-ודאות / קישור לא ידוע לעולם לא מעלה ביטחון" לפני
שנקבעת ברירת-מחדל כלשהי.

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

---

## נבנה
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

  **Remediation infrastructure (טרם הופעל בפועל — אין remediation אמיתי
  על 4 העקרונות ה-observed הקיימים בהחלטה זו):** טבלה חדשה
  `strategy_evidence_grounding_checks` (migration `0009_large_jackpot.sql`,
  **נכתבה בלבד, לא הורצה**) — מקבילה סמנטית מדויקת ל-`dna_evidence_grounding_checks`
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
- **DNA Grounding Remediation — תשתית בלבד, לא הופעלה** (2026-09-16,
  Autonomous Unit 3, בהמשך ל-Autonomous Unit 1 [Evidence Grounding Audit,
  read-only] ו-Autonomous Unit 2 [architecture design, read-only]): בונה
  את המנגנון האחיד, ניתן-לשימוש-חוזר, שנדרש כדי לתקן גרסאות DNA
  שהראיה שלהן כבר לא עומדת ב-Evidence Grounding (commit `25fe506`) —
  **בלי לבצע את התיקון בפועל על שתי ההשערות שכבר אובחנו** (`699cdb50`,
  `e1239589`, ר' Unit 1). זו במפורש **יחידת תשתית**, לא remediation
  אמיתי — migration טרם הורצה, אין דאטה אמיתי שהשתנה.

  **סכימה חדשה (migration `0008_numerous_lily_hollister.sql`, נכתבה
  בלבד, לא הורצה — ר' Migration rule):** טבלה חדשה
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

  **מפורשות לא נבנה/לא בוצע ביחידה הזו:** התיקון האמיתי על `699cdb50`
  ו-`e1239589` (ממתין ל-unit נפרד, מאושר בנפרד, אחרי הרצת migration
  0008); הרצת ה-migration עצמה על ה-DB האמיתי; שינוי כלשהו ל-grounding
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
