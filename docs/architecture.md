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
  ומאשר.
- **מערכת:** פרסור/ולידציה/דה-דופליקציה דטרמיניסטיים. שחזור Position
  ו-cost basis מתוך מה שיובא בלבד, דרך `computePositions()`.
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
  Portfolio view).
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
