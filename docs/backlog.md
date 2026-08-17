# Backlog — Gaps Found, Deferred On Purpose

רשימה מצטברת של פערים אמיתיים שנתקלנו בהם תוך כדי המעבר בלולאה
המלאה (לא באגים — התנהגות חסרה או לא-אינטואיטיבית שהתגלתה, ותוקנה
במודע *לא* להיבנות מיד). המטרה: לצבור כמה פערים לפני שמחליטים ביחד
מה שווה לבנות, במקום אחד-אחד. כשמשהו מכאן נבנה בפועל — מעביר את
השורה לקטגוריית "נבנה" (או מוחק) ומצטט את המשימה/commit הרלוונטי,
לא משאיר את זה תלוי.

---

## פתוח

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

---

## נבנה
- **Systematic double-submit fix** (2026-08-17, commit `4c91bd6`
  ואילך): `useSubmitGuard` בכל כפתורי ה-mutation + 5 constraints
  ברמת ה-DB. `decisions` ו-`strategy_versions` גם מטפלים בהתנגשות
  אמיתית בהודעה ברורה (לא 500 גולמי) — ר' פירוט מעל למה 3 האחרים
  עדיין לא.
