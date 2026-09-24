# Architecture — Slice 1

מסמך זה הוא ה-Reference המלא של ההחלטות שאושרו בשלב 1 (Scope + High-Level
Architecture). `CLAUDE.md` מצביע לכאן לפרטים; המקור הרעיוני העליון נשאר
`investment_ai_product_concept_he_v2.md`.

---

## 1. מה מוכיח ה-Slice הזה

לא "האם AI יודע לבחור מניות" — אלא: **האם ניתן לבנות זיכרון אמין של תהליך
ההשקעה שלי, לשפוט החלטות בעקביות וב-Traceability, ולהחזיר תובנה אמיתית
עליי כמשקיע**, בלי לבלבל מזל במיומנות ובלי לשכתב עבר.

---

## 2. Scope מדויק לכל חלק

### 2.1 Trade History Upload
- **משתמש:** מעלה CSV של עסקאות בחלון חלקי (למשל 6–12 חודשים, לא נדרשת
  היסטוריה מלאה), ממפה עמודות (מיפוי גנרי, לא broker-specific), סוקר
  ומאשר. **או:** מזין ידנית batch של עסקאות היסטוריות **אמיתיות**
  (Manual Historical Entry, 2026-09-08, ר' `docs/backlog.md`) — אותה
  טבלת `transactions`, `source="manual_entry"` — כשאין עדיין קובץ
  broker עדכני. Actual בלבד; hypothetical/"מה הייתי עושה" מפורשות מחוץ
  ל-scope.
- **מערכת:** פרסור/ולידציה דטרמיניסטיים. שחזור Position ו-cost basis
  מתוך מה שיובא/הוזן בלבד, דרך `computePositions()` — זהה לחלוטין בין
  שני המקורות, `computePositions()` עצמו עיוור-source.
- **התאמה מול ההיסטוריה הקיימת (History Refresh V1, 2026-09-22 —
  מחליף את "אין dedup" מ-2026-09-08):** לפני שכל שורה (CSV או ידנית)
  מגיעה לשלב הסדר-היומי ולהוספה, היא עוברת reconciliation דטרמיניסטי
  מול העסקאות שכבר במערכת (`src/lib/import/reconcile.ts`, קוד טהור,
  בלי AI) — בתצוגה המקדימה **וגם שוב, סמכותית, בזמן ה-confirm תחת אותם
  advisory locks** (`confirmTransactionsWithOrdering`), אף פעם לא לפי
  סיווג שהלקוח שלח. זהות = `(ticker, type, date, quantity, price,
  amount)` בצורה קנונית, **multiset**: N מופעים קיימים בולעים לכל היותר
  N מופעים נכנסים, העודף חדש (שתי קניות זהות באותו יום הן אמיתיות; לכן
  אין UNIQUE ב-DB). ייבוא חוזר של אותו קובץ מוסיף 0 שורות. שורת CSV
  שאולי היא אותה עסקה שהוזנה ידנית (אותו ticker/type/date, כמות ומחיר
  מסכימים בדיוק הגס מבין השניים — ר' `docs/data-model.md` §6) היא
  "התאמה אפשרית" ש**עוצרת** את הייבוא עד שהמשקיע מכריע (אותה עסקה →
  הידנית נשארת והשורה מדולגת; נפרדת → נוספת); יותר ממועמדת אחת →
  "לא חד-משמעי", אותה הכרעה. הכרעה שכבר לא תואמת את הסיווג הטרי → הייבוא
  כולו נדחה (stale, fail closed). אין מחיקה/מיזוג/החלפה של שורה קיימת
  ב-V1. הזנה ידנית של שורה זהה לקיימת נחסמת עד אישור מפורש "עסקה זהה
  נפרדת בכוונה". ה-`ImportBatch` נוצר באותה טרנזקציה עם השורות,
  `row_count` = מה שנוסף בפועל (0 לקובץ שכבר יובא). **ייבוא אמיתי נשאר
  פעולה שהמשתמש מבצע במפורש** — אין סנכרון ברוקר.
- **סוגי תנועה ואירועי הון (Import Blockers V1, 2026-09-23):** `tax_refund`
  (זיכוי מס) הוא סוג תנועה ראשון-מעלה — מזומן נכנס, בלי ticker/כמות/מחיר
  — כדי שקובץ ברוקר ייובא **ללא אובדן** ובלי מיפוי סמנטי שגוי (לא
  deposit/dividend/fee); חיובי מס היסטוריים נשארים `fee`. פיצולי מניה
  (וגם הפוכים) נרשמים כ-**אירוע הון בלתי ניתן לשינוי מבוסס-יחס**
  (`corporate_actions`, ר' `docs/data-model.md` §6) עם מקור וראיה
  מפורשים, מאושר ידנית ב-`/import`; עסקאות BUY/SELL מקוריות לא נערכות
  לעולם, ו-`computePositions()` מיישם את היחס לפי כלל תאריך דטרמיניסטי
  קפוא (פעולה → opening state → עסקאות). רק פיצולים — לא פלטפורמת אירועי
  הון, לא זיהוי אוטומטי, לא שליפה מספק.
- **טריות ההיסטוריה (History Refresh V1):** `/import` והדשבורד מציגים
  עד איזה תאריך ההיסטוריה מעודכנת, לפני כמה ימים, הייבוא האחרון וחלון
  התאריכים שלו, והיקף ההזנה הידנית (`import.history`, נגזר, לא נשמר).
- **מעקב החלטות פתוחות (Open-Decision Monitoring V1, 2026-09-23; §2.9):**
  הדשבורד מציג מקטע אחד "החלטות שדורשות תשומת לב" — **נגזר בקריאה, לא
  נשמר** (`decisions.attention` → `loadDecisionAttention()` →
  `deriveDecisionAttention()`, `src/lib/monitoring/`). בדיוק ארבע סיבות:
  `REVIEW_DUE` (הגיע `review_by_date` ואין Review מאז), `PREDICTION_DUE`
  (Prediction ממתין עם `checkable_by_date` שהגיע; NULL לעולם לא),
  `NEW_EXECUTION_AFTER_DECISION` (BUY/SELL באותו ticker **אחרי** יום
  ההחלטה שנכנס למערכת אחרי ה-baseline), `HISTORY_BACKFILLED` (BUY/SELL
  מ**לפני** יום ההחלטה שנכנס למערכת אחרי שה-Snapshot הוקפא ואחרי
  ה-baseline — "מידע היסטורי נוסף אחרי ההחלטה", לא שיפוט; AVGO 2026-09-08
  הוא המקרה האמיתי). baseline = תאריך ה-Review האחרון, אחרת תאריך ההחלטה
  — Review "בולע" כל עובדה שכבר הייתה ידועה. עסקאות ביום ההחלטה מוצגות
  ולעולם לא נספרות כ"אחרי" (הסדר התוך-יומי לא ניתן להוכחה). **ימים:** ערכי
  תאריך-בלבד (`transaction_date`, `review_by_date`) הם תאריכים קלנדריים
  המקודדים ב-00:00Z ונקראים לפי רכיבי התאריך ב-UTC; רגעים (`decision_date`,
  `review_date`, `checkable_by_date`, `created_at`, "היום") ממוקמים על לוח
  השנה של המשקיע לפי אזור הזמן (IANA) שהלקוח מרנדר בו כל תאריך ושולח עם
  השאילתה — לא UTC ולא אזור קבוע (נמצא ותוקן ב-final review: החלטה ב-00:30
  בירושלים שייכת ליום הירושלמי, אחרת עסקה מאותו יום הייתה "אחרי"). מצב נגזר:
  attention / monitoring / settled — אין CLOSED, אין ציון חומרה, אין דירוג
  AI, אין מחירי שוק, אין קישור זהות החלטה↔עסקה ("עסקאות ב-SNDK אחרי
  ההחלטה", לעולם לא "ביצעו את ההחלטה"). fail-closed: היסטוריה שלא מגיעה
  ליום ההחלטה → אין סיבות ביצוע; אזהרות חישוב/כשל → מצב הפוזיציה מסומן
  לא זמין. `review_by_date` אופציונלי אך **בחירה מפורשת** בהחלטה חדשה
  (תאריך או "ללא"); להחלטה ישנה ניתן לקבוע פעם אחת (NULL→תאריך בלבד,
  UPDATE אטומי לפי בעלות). ה-Snapshot הקפוא לעולם לא משתנה.
  עובדות בלבד — לא טענה שהתיק עדכני מעבר לתאריך העסקה האחרונה.
- **הפער הקריטי (פוזיציות פתוחות לפני החלון):** נפתר ע"י ישות נפרדת
  `PortfolioOpeningState` — אחזקות + cost basis + תאריך, נכון לתחילת
  החלון, מוזנת ידנית, מסומנת UI כ-**self-reported** (לא נגזרת מהיסטוריית
  עסקאות ולכן ברמת Traceability נמוכה יותר). המערכת מזהה SELL בלי BUY
  מספק בהיסטוריה שיובאה ומתריעה על Opening State חסר, במקום לשבור בשקט.
  **לא נדרשת היסטוריה מלאה.**
- **AI:** רק סיוע אופציונלי במיפוי עמודות. חשבון positions/cost-basis —
  קוד טהור.
- **Done:** קובץ אמיתי → positions נכונים, פער מטופל במפורש, שגיאות
  מוצגות לא נבלעות.

### 2.2 Onboarding Interview
- **משתמש:** ראיון על מדגם עסקאות ("למה קנית/מכרת"), חופשי, ניתן לדלג.
- **מערכת:** בחירת המדגם — קוד (רווח/הפסד קיצוני, holding ארוך/קצר,
  quickest flip, largest buy). ניסוח שאלות — AI, מעל עובדות שכבר חושבו
  בקוד (P/L%, ימי החזקה) ולא מומצאות על ידו.
- **נשמר:** `InterviewAnswer` (append-only, תיקון = שורה חדשה עם
  `supersedes_answer_id`). **תיקון דיוק (התגלה במימוש, ר' Docs Sync
  Rule):** יצירת Evidence **לא** קורית כאן — `Evidence` דורש הצבעה על
  DNAHypothesis/StrategyPrinciple/LearningInsight קיים (CHECK constraint,
  ר' `data-model.md` §2), ואלה עוד לא קיימים בזמן הראיון. פירוש התשובות
  ל-Evidence מובנה קורה ב-§2.3 (DNA Hypothesis Engine), שקורא את
  ה-InterviewAnswer הגולמי ויוצר גם את ההשערה וגם את ה-Evidence יחד.
- **Done:** ראיון הושלם על מדגם אמיתי, `InterviewAnswer` נשמר ומקושר
  לעסקה שנדונה.
- **"Tell me why" (2026-09-08, ר' `docs/backlog.md`) — flow נפרד, לא
  חלק מהראיון האלגוריתמי הזה:** המשקיע יוזם בעצמו תיעוד רציונל על
  עסקה ספציפית. **Contract (עודכן 2026-09-22, Episode Journal V1 —
  מחליף את ההחלטה מ-2026-09-08 שהגבילה ל-`source="manual_entry"`):**
  כל transaction מסוג buy/sell עם ticker בבעלות המשקיע, מכל source,
  איזו עסקה של ה-episode שנבחרה — לא נבחר ע"י
  `selectInterestingTransactions`, לא slot נוסף בתוך אותו ראיון.
  ה-**episode** (lifecycle רציף פתוח→שטוח של ticker) הוא **נגזר**, לא
  ישות: בדיוק `computePositions().episodeKeyByTransactionId` — אותה מפה
  שה-Decision Independence resolver סופר לפיה (`src/lib/portfolio/episodes.ts`
  רק מקבץ אותה, לא מממש episodes מחדש). הרציונל נשמר כ-`InterviewAnswer`
  רגיל עם **anchor דטרמיניסטי אחד** — קניית הכניסה של ה-episode (לפי
  תאריך, `intra_day_order` מוצהר, id) — גם אם המשקיע בחר במכירה; episode
  ללא קנייה בהיסטוריה (נפתח לפני חלון הייבוא) נדחה, לא מנוחש. השאלה
  דטרמיניסטית-בקוד (`buildTellMeWhyQuestion`, לא AI) ונושאת **רק עובדות
  מזמן הכניסה** — ticker, מספר episode, פתוח/סגור, תאריך/כמות/מחיר
  הקנייה — לעולם לא P&L, יציאה או מחירים מאוחרים (הגנת hindsight, החלטת
  Product): ה-API (`interview.journal`) משמיט server-side כל עובדה
  מאוחרת ל-episode בלי רציונל, ומציג אותה (מסומנת כ"מה קרה אחר כך") רק
  אחרי שהתשובה נשמרה. עדכון = תשובה חדשה עם `supersedes_answer_id`
  (שרשרת, לא fork; רק תשובה של אותו משקיע), לעולם לא עריכה. **ה-UI:**
  `/journal` (יומן פוזיציות — כל ה-episodes, ממתינים-לרציונל קודם, כיסוי
  "X מתוך Y"), בנוסף לכפתור אחרי submit של הזנה ידנית. נשמר מסומן
  `InterviewSession.origin=user_initiated` (traceability בלבד, לא
  משנה Evidence Strength) לעומת `guided_interview` של הראיון הזה. שמירה
  **לא** מריצה יצירת DNA/Strategy — המשתמש מפעיל אותה כרגיל.

### 2.3 Investor DNA ראשוני
- **משתמש:** רואה השערות, View Evidence, מסכים/חולק/מוסיף הקשר.
- **מערכת:** AI קורא `InterviewAnswer`+דפוסי עסקאות ומציע השערות **יחד
  עם** ה-Evidence שתומך בהן (מקושר ל-`InterviewAnswer`/`Transaction`
  הספציפיים); **קוד** מחשב Evidence Strength (טבלת סף — ר'
  `data-model.md`). לעולם לא מספר שה-LLM ממציא.
- **Done:** 2–3 השערות אמיתיות, Evidence traceable, כולל מקרה אמיתי של
  Insufficient Evidence.

### 2.4 Baseline Strategy
- **משתמש:** רואה עקרונות Declared/Observed/Validated, מאשר שינוי →
  גרסה חדשה.
- **מערכת:** Declared מהצהרות ראיון (AI מחלץ, משתמש מאשר). Observed מאותו
  מנוע Evidence כמו DNA. סט קבוע של עקרונות סיכון בסיסיים — קוד, מסומן
  ככזה.
- **Done:** אסטרטגיה בסיסית עם ≥1 עיקרון מכל סוג, versioned, source
  מיוחס.

### 2.5 Idea → Investment Case
- **משתמש:** יוצר Idea קצר או Case ישירות.
- **מערכת:** Market Intelligence מצומצם ל-Slice 1: מחיר/valuation בסיסי
  מ-API אמיתי אחד (FMP) — בלי news/sentiment אוטומטיים. AI מסנתז
  Bull/Bear/Catalysts/Invalidation/Devil's Advocate. Personal Fit (מול
  DNA+Strategy) ו-Portfolio Fit (מחושב חי, לא מאוחסן — ר' §5) מוצגים
  בנפרד, לא ממוצעים.
- **Done:** Case לטיקר אמיתי, נתונים אמיתיים (לא בדויים), סינתזה
  traceable.

### 2.5a Prior Record Brief (V1, 2026-09-24)
- **משתמש:** בעמוד ה-Case, לפני רישום החלטה, רואה "הרקורד שלך בטיקר הזה":
  ההחלטות הקודמות שלו בטיקר (הנימוק, הסיכונים ותנאי היציאה כפי שהוקפאו,
  התחזיות/תנאי השקילה-מחדש כפי שהם עומדים, תוויות ה-Review עצמן), תקופות
  ההחזקה הקודמות מה-Journal (תאריכים, תוצאה ממומשת רק למכירה שמגובה
  בהחזקה ידועה) והנימוקים שהוא עצמו תיעד, ומצב ההחזקה הנוכחי. תנאי
  שקילה-מחדש שעדיין ממתינים מודגשים.
- **מערכת:** נגזר בקריאה (`cases.priorRecord` → `loadPriorRecordBrief()` →
  `derivePriorRecordBrief()`, `src/lib/prior-record/`), קוד בלבד — בלי AI,
  בלי מחירי שוק. **אין** שינוי מחיר מאז החלטה קודמת (ל-PASS זה בדיוק
  ה-Counterfactual — Pull בלבד, §2.7), אין ציון, אין הסקת כוונה. ברגע
  רישום החלטה השרת מחשב את התקציר מחדש ו**מקפיא** אותו ב-Snapshot
  (`prior_record_json`) — "מה היה ידוע למערכת במועד ההחלטה"; החלטה ישנה:
  NULL, לא משוחזר. **Point-in-time:** התקציר נבנה מול חיתוך מידע מפורש
  (`asOf` = מועד ההחלטה, גם כשהוא בעבר; "עכשיו" בעמוד המחקר): החלטה
  קודמת רק אם הוחלטה ונרשמה לפניו, Review/Later Context/נימוק רק אם נכתבו
  עד אליו, Prediction שנפתר אחריו מוצג כממתין בלי הערה, ועסקה רק אם תאריכה
  עד אליו **וגם** נרשמה במערכת עד אליו או שכל יום המסחר שלה הסתיים לפניו בכל
  אזור זמן (עסקה מאותו יום שנרשמה מאוחר יותר → בחוץ, fail closed); פוזיציה,
  תקופות החזקה, פיצולים ותוצאות ממומשות — אותו חישוב חשבונאי קנוני על אותן
  שורות. אי-אמינות חשבונאית לטיקר → מצב הפוזיציה "לא זמין",
  לעולם לא ניחוש. **V1 לא מזין את התקציר ל-AI** של ההחלטה/ה-Review (יחידה
  הבאה, עם כללי anti-hindsight משלה).

### 2.6 Decision Snapshot
- **משתמש:** רושם החלטה (BUY/PASS/HOLD/ADD/REDUCE/SELL) מתוך Case.
- **מערכת:** מקפיאה את הכול: תאריך/מחיר/גודל/נימוק/הערכת AI/סיכונים/יציאה/
  מצב תיק כרגע (`computePositions()` בזמן ההחלטה)/Market Context/גרסאות
  DNA+Strategy+Case בתוקף/predictions.
- **Immutable לחלוטין — אין UPDATE.**
- **Done:** יצירת החלטה מייצרת snapshot מלא, בלתי ניתן לעריכה.

### 2.7 Decision Review
- **משתמש:** פותח החלטה ישנה, מפעיל Review, נרטיב קצר → drill-down ל-7
  ממדים, יכול לערער (Correction, לא דורס).
- **מערכת:** Outcome — קוד טהור. Thesis Accuracy + 7 הממדים — AI, כל
  שיפוט מצביע על שדה קונקרטי מה-Snapshot או Insufficient Evidence.
  decision_quality_overall — rollup דטרמיניסטי (ר' `data-model.md`).
  Counterfactual — **רק לפי דרישה מפורשת** במסך זה, לא Push, לא משנה
  Decision Quality לבדו.
  **תיקון דיוק (הוחלט בזמן המימוש):** מי בפועל קובע אם Prediction
  התממש — Slice 1 אין לו מקור נתונים עצמאי לבדוק טענות עסקיות שרירותיות
  (רק market data מ-FMP). לכן resolution של כל Prediction הוא דיווח
  מפורש של המשתמש עצמו (confirmed/refuted/inconclusive + הערה) לפני
  הרצת ה-Review; ה-AI **לא** קובע בעצמו אם טענה התממשה — הוא רק מסנתז
  את `thesis_accuracy` הכולל **מתוך** ה-resolutions שכבר נקבעו. אם אין
  Predictions או אף אחד לא נפתר — `thesis_accuracy=insufficient_evidence`,
  תוצאה תקינה. Outcome עצמו מחושב תמיד (קוד, לא Push כשלעצמו); ה-UI הוא
  שמסתיר אותו מאחורי לחיצה מפורשת ("הצג מה קרה מאז") ספציפית עבור
  PASS — כי שם המספר הזה *הוא* בדיוק ה-Counterfactual; לשאר סוגי
  ההחלטה (BUY/ADD/HOLD/REDUCE/SELL) זו תוצאה עובדתית ישירה של פעולה
  שבוצעה בפועל, לא קאונטרפקטואל, ומוצגת ללא הסתרה.
  **שלמות (Decision Review Integrity V1, 2026-09-24):** שלושה שלבים — (1)
  קריאה/אימות מחוץ לטרנזקציה, כולל replay לפי מפתח ההגשה לפני AI; (2) AI
  מחוץ לכל טרנזקציה; (3) טרנזקציה קצרה אחת עם נעילות (החלטה → Predictions
  לפי id) שמאמתת מחדש את מצב ה-Predictions ושומרת Review + ממדים + כל
  ה-resolutions יחד. שינוי מצב בין (1) ל-(3) → נכשל סגור, בלי הרצת AI
  חוזרת. Review חוזר מכוון נשאר חוקי (מפתח חדש), גם בלי Predictions
  ממתינים. אין יצירת Learning/DNA/Strategy מ-Review.
- **Done:** מחזור Review מלא, Quality/Accuracy/Outcome מופרדים,
  traceable.

### 2.8 Learning Insight
- **משתמש:** רואה תובנה, Evidence, מסכים/חולק.
- **מערכת:** קיבוץ החלטות — קוד. סינתזת משמעות — AI. סף ראיות מינימלי —
  קוד.
  **תיקון דיוק (הוחלט בזמן המימוש):** קיבוץ בפועל לפי **סקטור** (מ-
  Market Intelligence הקפוא ב-snapshot של ההחלטה) — עובדה אמיתית וקיימת,
  לא taxonomy מומצא, ותואם ישירות לדוגמת "סקטורים מסוימים" ממסמך
  הקונספט §11. `decisionType` או "סוג הזדמנות" עשירים יותר (כמו
  "quality-dip-buys") נשארים הרחבה עתידית סבירה, לא Slice 1. סף מינימלי
  בקוד = 2 החלטות-עם-Review באותה משפחה לפני שמנסים סינתזה בכלל (מעבר
  לטבלת Evidence Strength שמתייגת בפועל את החוזק ברגע שיש ראיות — שני
  הסינונים משלימים זה את זה, לא כפולים). "מסכים" יוצר תמיד DNAHypothesis
  **חדשה** (לא עדכון של קיימת — אין דרך חד-משמעית לבחור לאיזו קיימת
  לצרף), עם evidence_strength כן/insufficient_evidence כמו כל השערה
  חדשה עם ראיה בודדת — לא ודאות מזויפת רק כי המשתמש הסכים.
- **Done:** תובנה אמיתית אחת לפחות, traceable, תגובת המשתמש משפיעה על
  גרסה עתידית של DNA (דרך Evidence שמצטט את ה-Insight).

---

## 3. מחוץ ל-Slice 1
Market Scanner · חיבור ברוקר/סנכרון אוטומטי · agents כתהליכים נפרדים ·
כל push/alert (כולל counterfactual) · streaming נתוני שוק · news/sentiment
aggregation אוטומטי · דרישת היסטוריה מלאה · אופציות/נגזרים/קריפטו/ריבוי
מטבעות · Strategy שמשתנה לבד · multi-tenant · מובייל · Evidence Strength
סטטיסטי מתוחכם.

---

## 4. High-Level Architecture

- **Frontend** — Next.js (App Router), כל הזרימות (Interview, DNA/Strategy
  views, Case builder, Decision Snapshot, Review דו-שכבתי, Learning feed,
  Portfolio view — **דיוק 2026-09-22:** אין עמוד portfolio analytics
  נפרד; ה-surface הקיים להיסטוריית הפוזיציות הוא `/journal` (Episode
  Journal, §2.2), ו-positions/exposure מוצגים בתוך Case/Decision).
- **Backend/API** — אותו repo; tRPC routers מארחים לוגיקה דטרמיניסטית
  (positions, exposure, evidence strength, outcome) + AI orchestration.
- **AI Orchestration** — שכבה דקה: פונקציות טיפוסות לכל "role" (לא agents
  נפרדים), מעל Anthropic SDK ישיר. כל קריאת AI ששולפת Evidence כקלט שומרת
  pointer חזרה אליו — זה מנגנון ה-Traceability בפועל.
- **Investment Memory** — PostgreSQL, מקור אמת יחיד; ר' `data-model.md`
  למיפוי מלא של מי-כותב/מי-קורא לכל ישות.
- **Historical/Event layer** — טבלאות Immutable History ממוקדות (לא Event
  Sourcing מלא — ר' §5).
- **Market Data layer** — adapter סביב Financial Modeling Prep; fetch
  דטרמיניסטי לפי דרישה, נשמר כמספרים גולמיים.
- **Background Jobs** — אין ב-Slice 1; fetch synchronous + caching TTL
  פשוט.
- **Auth** — session-cookie קליל, single-user.

**זרימת מידע:** Interview→Evidence→DNA ⟶ Baseline Strategy ⟶ Investment
Case (קורא MarketData+DNA+Strategy+Portfolio) ⟶ Decision Snapshot (מקפיא
הכול, כתיבה חד-פעמית) ⟶ Decision Review (קורא Snapshot קפוא + נתונים
עדכניים, כותב append-only) ⟶ Learning Insight ⟶ מזין בחזרה DNA/Strategy
כ-Evidence חדש (לא עריכת ישן).

**איך מונעים מ-AI לשכתב עבר:** (א) immutability ברמת אפליקציה — repository
layer חושף רק `insert` על טבלאות היסטוריות; (ב) FK מ-Snapshot לגרסאות
(`strategy_version_id`, `dna_hypothesis_version_id` וכו') הם
`ON DELETE RESTRICT`; (ג) ל-AI אין הרשאת כתיבה על טבלאות היסטוריות, רק
יצירת רשומות חדשות.

---

## 5. החלטת מודל היסטוריה

הושוו שלוש אפשרויות: Event Sourcing מלא, Immutable History Tables,
Hybrid. **הוחלט: Immutable History Tables** (בפועל Transaction כבר מתפקד
כ-ledger מוסף-בלבד, כך ש-Hybrid מתמזג ל-Option B).

**נימוק:** הדרישה האמיתית אינה replay גנרי של כל המערכת, אלא: החלטות/
ביקורות/אסטרטגיה/DNA/ראיות לא נדרסים בשקט, ומצב תיק ניתן לשחזור לתאריך
נתון. שני אלה מושגים במלואם עם טבלאות יחסיות רגילות + טבלאות-גרסה ממוקדות
+ ledger עסקאות — בלי מורכבות של event replay/projections/schema
versioning גנרי. תואם Simple → Correct → Extensible; אם יתעורר צורך אמיתי
ב-ES נקודתי בעתיד, ניתן להוסיף אותו לתת-מערכת ספציפית בלי לשבור את
הארכיטקטורה הקיימת.

---

## 6. שאלות פתוחות שהוכרעו (ברירות מחדל, ניתנות לשינוי)
- חלון ייבוא: מוצע 6–12 חודשים, ניתן להגדרה ע"י המשתמש, לא דרישה קשיחה.
- פורמט CSV: מיפוי עמודות גנרי (לא parser ייעודי לברוקר) — אם ידוע ברוקר
  ספציפי, ניתן להוסיף preset בהמשך.
- Market Context בכל Snapshot: רמת/שינוי מדד רלוונטי + ביצועי סקטור +
  מדד תנודתיות, מ-FMP.
- תזמון Review: יזום ע"י המשתמש, עם רמז לא-פולשני בתוך האפליקציה (לא
  push).
- Auth: session-cookie single-user קליל.
