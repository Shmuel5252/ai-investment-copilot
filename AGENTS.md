# AGENTS.md — AI Investment Copilot

Operating manual קבוע לכל session עתידי. אם משהו כאן לא ברור — קרא קודם
את `investment_ai_product_concept_he_v2.md` (Source of Truth הרעיוני),
`docs/architecture.md` (Scope + Architecture מלא), ו-`docs/data-model.md`
(מודל נתונים מלא). אל תנחש — הכול כבר תוכנן.

## Repo Map
- `investment_ai_product_concept_he_v2.md` — מסמך קונספט המוצר, לא ליצור
  מחדש/לסתור בלי אישור מפורש.
- `docs/architecture.md` — Scope מדויק ל-Slice 1, High-Level Architecture,
  החלטת מודל היסטוריה.
- `docs/data-model.md` — כל הישויות, שדות, immutability rules, טבלאות
  Rollup/Evidence Strength.
- `docs/backlog.md` — פערים אמיתיים שנמצאו תוך כדי מעבר בלולאה (לא
  באגים) ונדחו במכוון לדיון משותף לפני בנייה — לא תיקון-אחד-אחד. בדוק
  שם לפני שמציעים פיצ'ר "קטן" חדש שלא התבקש.
- `docs/` — כל doc עתידי נוסף (למשל ADRs) שייך לכאן, לא לשורש.

### Docs Sync Rule (מחייב)
`investment_ai_product_concept_he_v2.md`, `docs/architecture.md`,
`docs/data-model.md` ו-`AGENTS.md` (הקובץ הזה) חייבים להישאר מסונכרנים
**תמיד**, לא רק בזמן התכנון הראשוני. אם החלטה כלשהי בזמן הבנייה סוטה
ממה שכתוב ב-`docs/architecture.md` או `docs/data-model.md` (שינוי שדה,
שינוי כלל, פישוט נוסף, גילוי שהנחה לא נכונה) — **עדכן את המסמך הרלוונטי
באותו רגע**, כחלק מאותה משימה, לא כ-TODO נפרד ולא רק בקוד. אם הסטייה
משמעותית (architecture/scope/data model שכבר אושר) — זו נקודת עצירה
לפי Autonomous Working Rules, לא עדכון שקט.

**AGENTS.md מול CLAUDE.md — מקור אמת יחיד, לא שני עותקים:** `AGENTS.md`
(הקובץ הזה) הוא ה-source of truth היחיד לכל הכללים כאן. `CLAUDE.md`
הוא **stub ייבוא בלבד** — התוכן שלו חייב להיות בדיוק שורה אחת,
`@AGENTS.md`, אף פעם לא עותק מקביל. זו לא בחירת עיצוב שלנו — זו בדיוק
ההתנהגות שמנוע ה-agent-rules של Next.js עצמו מצפה לה (`next dev`, ר'
`node_modules/next/dist/server/lib/generate-agent-files.js`,
`CLAUDE_MD_CONTENT = "@AGENTS.md\n"`): ברגע ש-`AGENTS.md` קיים,
ה-tooling מפסיק לתחזק את הבלוק המנוהל
(`<!-- BEGIN/END:nextjs-agent-rules -->`) בתוך `CLAUDE.md` לגמרי —
מעדכן אותו רק ב-`AGENTS.md` מכאן והלאה. נמצא בפועל 2026-09-06: שני
הקבצים היו עותקים מלאים זהים חוץ משם-עצמי, כולל שני "Docs Sync Rule"
נפרדים שכל אחד מתייחס לעצמו — בדיוק בעיית "שני מקורות אמת" (כמו
CANONICAL_FIELDS/P&L כפול בעבר) שהייתה יכולה להתפצל בשקט אם לא היה
נתפס, הפעם ברמת התיעוד עצמו. **אף פעם אל תוסיף תוכן ל-`CLAUDE.md`
ישירות** — כל עדכון עתידי לכללים הולך ל-`AGENTS.md` בלבד.

---

## Product Context

AI Investment Copilot אישי. לא ממליץ מניות — לומד איך אני חושב כמשקיע,
בונה זיכרון מובנה של תהליך ההחלטה שלי (Investment Memory), ומחזיר תובנות
אמינות, ניתנות למעקב, על עצמי. הליבה ההנדסית היא הזיכרון המשותף, לא
הסוכנים — כל "role" (Researcher, Risk Analyst, Devil's Advocate,
Investor Coach וכו') קורא/כותב לאותו מקור אמת ולא מחזיק אמת נפרדת.

## Current Scope — Slice 1

**בונים עכשיו** (פירוט מלא ב-`docs/architecture.md` §2): Trade History
Upload (חלון חלקי + `PortfolioOpeningState` לפוזיציות ישנות) → Onboarding
Interview → Investor DNA ראשוני (Evidence + Traceability) → Baseline
Strategy (Declared/Observed/Validated) → Idea → Investment Case → Decision
Snapshot (immutable) → Decision Review (נרטיב + drill-down ל-7 ממדים,
Counterfactual לפי דרישה בלבד) → Learning Insight.

**לא בונים עכשיו** (פירוט מלא ב-`docs/architecture.md` §3): Market
Scanner, חיבור ברוקר, agents כתהליכים נפרדים, כל push/alert, streaming
נתוני שוק, news/sentiment aggregation אוטומטי, דרישת היסטוריה מלאה,
אופציות/נגזרים/קריפטו, Strategy שמשתנה לבד, multi-tenant, מובייל.

## Architecture Snapshot

Next.js (App Router, TS) + tRPC + Drizzle ORM + PostgreSQL (Neon) +
Anthropic SDK (ישיר, ללא LangChain) + Financial Modeling Prep (Market
Data) + Vercel (deploy) + session-cookie auth (single-user). מודל היסטוריה:
**Immutable History Tables** (לא Event Sourcing מלא — נימוק מלא ב-
`docs/architecture.md` §5). `Portfolio`/`Position` תמיד מחושבים
(`computePositions()`), אף פעם לא מאוחסנים.

### Required Accounts / .env
```
ANTHROPIC_API_KEY=       # קריאות AI
DATABASE_URL=            # Neon Postgres connection string
FMP_API_KEY=             # Financial Modeling Prep
SESSION_SECRET=          # חתימת cookie session
```
לעולם לא ב-commit. `.env.example` עם placeholders ריקים בלבד.

---

## Product Principles (שישה — בלתי ניתנים לפשרה)

1. **No Fake Certainty** — אין ודאות שאין לה כיסוי; מעט דוגמאות לא הופכות
   לדפוס מוכח; "Insufficient Evidence" היא תשובה תקינה ורצויה.
2. **Traceable Judgments** — כל מסקנה משמעותית מצביעה על הראיות שמאחוריה,
   כולל דירוגי איכות החלטה.
3. **Immutable Historical Decisions** — מה שנשמר בזמן ההחלטה לא נכתב מחדש
   בדיעבד; אפשר להוסיף הקשר, לא לשנות היסטוריה.
4. **Interpretations Can Change, History Cannot** — הפרשנות משתפרת עם
   הזמן; העובדות והגרסאות ההיסטוריות נשארות כפי שהיו.
5. **Separate Skill From Luck** — רווח ≠ החלטה טובה, הפסד ≠ החלטה רעה;
   מפרידים תהליך, דיוק תזה ותוצאה.
6. **Counterfactuals Are for Reflection, Not Regret** — קאונטרפקטואלים
   מוצגים רק לפי דרישה (Pull), אף פעם לא כ-Push/FOMO; לא משנים Decision
   Quality לבדם.

---

## Engineering Principles

- Deterministic facts (ספירות, יחסים, טווחי זמן, חשיפה, P/L, בחירת
  גרסה/snapshot, timestamps, state reconstruction) — **בקוד, לא ב-LLM**.
- LLM לא ממציא מספרי Confidence/Evidence Strength/Decision Quality — אלו
  תמיד rollup דטרמיניסטי (טבלאות מלאות ב-`docs/data-model.md`).
- AI מפרש ומנתח (נרטיב, חילוץ Thesis, השערות, שאלות המשך, זיהוי דפוסים,
  Devil's Advocate) — **לא ממציא facts**.
- Judgment משמעותי חייב Evidence מקושר; בלי זה → Insufficient Evidence.
- Historical records (ר' `docs/data-model.md` §10 לרשימה המדויקת) לא
  נדרסים לעולם — repository layer חושף רק `insert` עליהם. עקיפה ב-SQL
  ישיר כפופה לכלל הצר ב-Autonomous Working Rules (גישת SQL ישירה
  לטבלאות Immutable).
- אין Feature עתידי בלי צורך ממשי מה-Slice הנוכחי.
- אין Over-engineering: לא Event Sourcing מלא, לא multi-agent processes,
  לא DB ענק לתמיכה תיאורטית.
- אין Dependency חדשה בלי הצדקה (למשל: לא LangChain — Anthropic SDK ישיר
  מספיק ופחות magic).
- Prefer simple explicit code over clever abstractions.
- אין refactor גדול בלי צורך ממשי.
- אין hidden magic כש-implementation מפורש יהיה ברור יותר.
- מפתחות/סודות תמיד ב-`.env`, לעולם לא ב-commit.
- **חישובי Position/Portfolio/P&L תמיד דרך `computePositions()`
  (`src/lib/portfolio/positions.ts`) — לעולם לא ממומשים מחדש במקום אחר.**
  צריך context נוסף לצרכן ספציפי (למשל P&L לכל SELL בנפרד, כמו
  ב-Onboarding Interview)? מרחיבים את מה ש-`computePositions()` מחזיר
  (למשל `sellTrace`), לא כותבים לולאת avg-cost מקבילה. תוקן בפועל אחרי
  שגרסה מוקדמת של `select-transactions.ts` מימשה חישוב מקביל וסטתה
  ממנו — נתפס ע"י קריאת AI חיה, ר' git history.
- **Test DB Safety (מחייב):** טסטים מבוססי-DB (`tests/integration/**`) יוצרים
  משקיעים סינתטיים וכותבים לטבלאות history שאי אפשר לנקות — לכן הם רצים
  **רק** מול DB שהוסמך במפורש לטסטים: `TEST_DATABASE_URL` (לעולם לא
  `DATABASE_URL` של האפליקציה; `.env` לבדו לא מסמיך כלום), שונה ממנו, ונושא
  marker בתוך ה-DB עצמו (`COMMENT ON DATABASE`, נכתב רק ע"י
  `npm run db:test:create`; **השם לא קובע**, ולכן "test"/"scratch" בשם לא
  מסמיכים). אין הרשאה → נכשל **לפני כתיבה**, בלי warning-and-continue ובלי
  fallback ל-`DATABASE_URL` (`tests/support/test-database.ts`,
  `tests/support/global-setup.ts`, `tests/setup.ts`; ההודעות לא חושפות
  connection string). טסטים טהורים בלי DB: `npm run test:unit`. תוקן בפועל
  אחרי שנמצאו ב-DB האמיתי ~600 משקיעים סינתטיים מהרצות `vitest` ללא הגנה
  (2026-08-13 ואילך) — ר' `docs/backlog.md`.

---

## Autonomous Working Rules

Workflow: **חקור → תכנן → בצע → בדוק → תקן → המשך**. אל תעצור לאישור על
כל פעולה. עצור רק על: שינוי Scope מהותי, שינוי עיקרון מוצר, שינוי
ארכיטקטורה מרכזי, החלפת DB/Framework/Stack, שינוי מודל נתונים שכבר אושר,
פעולה הרסנית שעלולה למחוק מידע, החלטת UX/Product עם כמה אפשרויות שונות
מהותית, או דרישה לא ברורה שעלולה להוביל לשני מוצרים שונים.

אם אותה שגיאה חוזרת אחרי 2 ניסיונות תיקון שונים — ציין זאת בשורה אחת
בסיכום המשימה והמשך, בלי לעצור לאישור; זה בד"כ סימן שהנחה בסיסית שגויה,
לא רק תקלה טכנית.

**גישת SQL ישירה לטבלאות Immutable — כלל צר:** שכבת ה-repository חושפת
insert-only על טבלאות ההיסטוריה בכוונה (ר' Engineering Principles); SQL
ישיר שעוקף אותה הוא **תמיד** בגדר "פעולה הרסנית שעלולה למחוק מידע"
מרשימת נקודות העצירה למעלה — גם כשמדובר בטבלה immutable, וגם כשהכוונה
היא רק "ניקוי". מותר **רק** במקרה צר אחד: ניקוי נתוני-אימות שיצרת בעצמך
**באותו session**, לפני שהיה עליהם כל שימוש אמיתי, ושאתה יכול לזהות
בוודאות מלאה כסינתטיים (למשל: investor שהיה ריק באותן טבלאות ממש לפני
שהרצת את בדיקת האימות — מתועד בבדיקה, לא בהנחה). גם במקרה הצר הזה —
**מדווח ומבקש אישור לפני הביצוע, לא מבצע ואז מדווח בסיכום המשימה.** ברגע
שיש שימוש אמיתי בטבלה (משתמש אמיתי, נתונים שלא נוצרו על ידך באותו
session) — אין "ניקוי" עצמאי בכלל; זו נקודת עצירה רגילה כמו כל פעולה
הרסנית אחרת, בלי יוצא מן הכלל. תוקן בפועל אחרי שניקוי נתוני-אימות של
Baseline Strategy בוצע ב-SQL ישיר על טבלאות immutable בלי לעצור לאישור
קודם — המקרה עצמו היה תקין (נתונים סינתטיים, אין עדיין משתמשים אמיתיים),
אבל התהליך לא: ר' git history.

---

## Definition of Done

- הקוד עובד; Typecheck עובר; Tests רלוונטיים עוברים; Build עובר כשרלוונטי.
- **Unit test coverage מפורש (לא smoke test) על שכבת החישובים
  הדטרמיניסטית**: Evidence Strength scoring, decision_quality_overall
  rollup, Portfolio/Position Fit (`computePositions`/`computePortfolioFit`),
  Outcome/P&L, שחזור cost-basis. זו בדיוק השכבה ש-No Fake Certainty נשען
  עליה — לא מספיק "יש בדיקות כלליות".
- אין שגיאות ידועות שהתעלמו מהן; אין Placeholder/TODO קריטי מוסתר; אין
  mock המוצג כ-production data.
- נשמרו ששת עקרונות המוצר.
- שינוי משמעותי מתועד (ב-`docs/` המתאים) אם נדרש.

---

## AI vs Code — כלל מרכזי

**בקוד:** Evidence counts, supporting/contradicting counts, time ranges,
portfolio exposure, P/L, version selection, snapshot selection,
deterministic scoring rules (Evidence Strength, decision_quality_overall),
calculations, timestamps, history lookup, state reconstruction.

**ל-AI:** ניתוח נימוק חופשי, חילוץ Thesis, הצעת Hypotheses, follow-up
questions, זיהוי דפוסים אפשריים, Decision Review narrative, research
synthesis, ניסוח Insight, Devil's Advocate.

Conclusion של AI בלי Evidence אינו מספיק — Insufficient Evidence היא
תשובה תקינה.

## נתוני השקעות — כלל מחייב

לעולם לא מוצג mock data / fabricated market data / AI-generated financial
facts כאילו הם מידע אמיתי. אין Data Provider מחובר לנתון מסוים → מסומן
בבירור **Demo / Test Data**. כל נתון שוק שמשפיע על ניתוח אמיתי מגיע
מ-Financial Modeling Prep (או ספק מוגדר אחר), לא מומצא.

## שפת תוכן — עברית (כלל מחייב, UI + AI-generated content)

חל על שתי שכבות נפרדות שחייבות להישאר עקביות זו עם זו — UI chrome
(`src/app/**/page.tsx`) **וגם** טקסט חופשי שה-AI מייצר
(`src/lib/ai/*.ts` system prompts). אותה רשימת מונחים, אותו כלל
Strategy, מתועדים **פעם אחת כאן**, לא בשתי גרסאות נפרדות שעלולות
להתפצל — אם עורכים ניסוח באחד הקבצים, לוודא שהשני עדיין תואם לכלל
הזה, לא רק "דומה".

### UI — עברית + RTL אמיתי
כל ממשק המשתמש בעברית, RTL אמיתי (`dir="rtl"`/`lang="he"` בפועל, לא רק
טקסט עברי בתוך layout שנבנה ל-LTR).

### תוכן חופשי שה-AI מייצר — עברית (כלל חדש, לא מההתחלה)
עד לשלב זה תוכן AI חופשי (thesis interpretation, Personal Fit,
Bull/Bear Case, Catalysts, Invalidation, Market Blindspot, Devil's
Advocate, ניסוח השערות DNA/Strategy, שאלות ראיון) יצא באנגלית —
נשאר כך כי אף system prompt לא הנחה שפה. **מכאן והלאה עברית טבעית**,
לא תרגום מאולץ — ר' ההנחיה המדויקת שכל system prompt נותן, למשל
`CASE_SYSTEM_PROMPT`/`PERSONAL_FIT_SYSTEM_PROMPT` ב-`src/lib/ai/case.ts`.
**לא חל** על `review.ts`/`learning.ts` — נשארים אנגלית, עקבי עם
Decision Review/Learning Insight שנשארים מחוץ ל-UI redesign (אותה
סיבה: פערים פתוחים ב-`docs/backlog.md`).

**Rollout:** הושלם — `case.ts`, `decision.ts`, `dna.ts`, `strategy.ts`,
`interview.ts` כולם מנחים עברית. תוך כדי הרולאאוט נמצא ותוקן גם overclaim
אמיתי (השערת DNA/Observed-Strategy שהסיקה preference/goal מוצהר
מ-tendency בודדת, מעבר למה שהראיה תמכה בו) — **מקום אחד בכל קובץ, לא
שניים** (וודא ב-2026-09-06, לא רק תועד): ב-`dna.ts` בתוך ה-`SYSTEM_PROMPT`
היחיד שלו (שורה ~27); ב-`strategy.ts` רק בתוך `OBSERVE_SYSTEM_PROMPT`
(שורה ~140) — לא `DECLARE_SYSTEM_PROMPT`, שנבדק בנפרד בבדיקה חיה ולא
נמצאה בו אותה בעיה, לא רק הונח שהיא לא שם. הכלל המתקן חי בתוך
ה-ground rules של ה-prompts האלה עצמם, לא כאן; ר' git history וההערה
העקרונית ב-`docs/backlog.md` (Market Scanner עתידי — אותה הגזמה, אם
תוזן פעם למנגנון הצעה אוטומטי, עלולה ליצור feedback loop).

### מונחים שנשארים באנגלית — בשתי השכבות, ללא יוצא מן הכלל
DNA, Evidence Strength, Personal Fit, Portfolio Fit — לעולם לא
מתורגמים, לא ב-UI ולא בתוכן AI. **Strategy** מתורגם ("אסטרטגיה")
במשפטים תיאוריים מלאים, אבל נשאר באנגלית באזכור טכני קצר לצד DNA —
ב-UI (תגיות ציטוט כמו `[DNA]`/`[Strategy]`, שורות כמו "DNA + Strategy"
ברשימות שלמות-מחקר) **וגם** בתוכן AI (אזכור ישיר של Strategy principle
ספציפי בתוך משפט, למשל "in tension with your Strategy principle
about position sizing") — כדי להישאר עקבי עם DNA שלא ניתן לתרגום
בכלל, בשני המקומות.

טיקרים, שמות חברות/מוצרים/תרופות, ומונחים טכניים מבוססים (P/E, margin
of safety וכו') תמיד לועזיים — גם ב-UI וגם בתוכן AI, בדיוק כפי שהמשקיע
עצמו כותב (עברית טבעית מעורבת, לא תרגום כפוי). מטבע תמיד `$`.

### מה עדיין אף פעם לא מתורגם
תוכן שנכתב ע"י המשתמש עצמו (thesis text מילה במילה, הערות אישיות,
תשובות ראיון) או מיוצר בקוד חישוב (`computePortfolioFit()`/`warnings`
וכיו"ב) — **לעולם לא מתורגם**, נשאר בשפה שבה נוצר בפועל. תרגום של
הודעות שמיוצרות במודול חישוב מוגן (למשל
`src/lib/portfolio/portfolio-fit.ts`) נחשב שינוי מחוץ ל-scope, לא רק
ניסוח. **החלטות קיימות (למשל LLY, SNDK) נשארות באנגלית לצמיתות** —
immutable, לא נכתבות מחדש בדיעבד; רק ניתוחים/החלטות חדשים מפיקים
עברית.

### מספרים/מטבע/תאריכים בתוך טקסט עברי (UI בלבד)
תמיד דרך `<Num>` (`src/components/num.tsx`), אף פעם לא `<bdi>` גולמי או
auto-detection — הקומפוננטה מתעדת את כלל השימוש המדויק (מתי לעטוף רק
את הערך מול מתי לעטוף את כל הצירוף "תווית: ערך") אחרי שני באגים
אמיתיים שנמצאו בבדיקה חיה תוך כדי בנייה, משני הכיוונים.

### Scope
UI: ששת העמודים המאומתים + Decision Snapshot (לא כולל Decision Review
ו-Learning Insight). AI-generated content: `case.ts`, `decision.ts`,
`dna.ts`, `strategy.ts`, `interview.ts` — כולם הושלמו (ר' Rollout מעל) —
לא `review.ts`/`learning.ts`. שני ה-scope-ים מחריגים את אותן שתי תכונות
בכוונה, לא בטעות.

## Counterfactual Learning — Pull, לא Push

אין התראות FOMO אוטומטיות ("אם היית מחזיק...", "X מתוך Y שפסלת עלו").
מוצג רק כשהמשתמש יוזם Review/Coach analysis, בהקשר איכות ההחלטה לפי מידע
בזמן אמת — לא כמחשבון כסף שפוספס. תוצאה חלופית לא משנה Decision Quality
לבדה.

## Historical Integrity

הקשר שנוסף בדיעבד = תוספת חדשה (`LaterContext`/`Correction`), אף פעם לא
עריכת `DecisionSnapshot`/`DecisionReview` המקוריים. הזרימה: Original
Snapshot → Later Context → Review → Learning Insight — ההיסטוריה המקורית
תמיד נגישה.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
