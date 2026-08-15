# Data Model — Slice 1

Reference מלא של מודל הנתונים שאושר בשלב 3 (כולל התיקונים שאושרו לאחר
מכן: rollup table ל-decision_quality_overall, ו-Portfolio Fit כ-computed
לא stored). שמות ישויות כאן הם שמות מושג; שמות טבלה בפועל הם snake_case
ברוח Drizzle (`dna_hypothesis_versions` וכו').

---

## 0. דפוסי מידול

- **Identity + Version split** — לישויות שצוברות ראיות ברציפות (DNA
  Hypothesis, Strategy Principle, Learning Insight): שורת-זהות יציבה
  (ש-Evidence מתחבר אליה) + שורות-גרסה append-only. "הגרסה הנוכחית" =
  `MAX(version_number)`, אף פעם לא flag שמתעדכן.
- **Whole-bundle Version** — ל-Strategy בלבד (מאושרת במפורש כמכלול):
  `StrategyVersion` = snapshot של כל העקרונות יחד, דרך טבלת קישור.
- **Append-only + supersedes pointer** — ל-`InterviewAnswer`: תיקון = שורה
  חדשה עם `supersedes_answer_id`, לא identity+version נפרד (overkill
  לתשובת טקסט פשוטה).
- **Frozen deep-copy JSON** — `InvestmentCase` הוא מסמך עבודה חי (mutable
  כל עוד `researching`). כש-`DecisionSnapshot` נוצר, מועתק עותק מלא קפוא
  של תוכן ה-Case — לא `InvestmentCaseVersion` שהמסמך לא ביקש.
- **Typed nullable FK + CHECK** ל-polymorphism — `Evidence` ו-`Correction`
  משתמשים בכמה עמודות FK nullable + CHECK שמוודא בדיוק אחת מלאה, במקום
  `subject_type/subject_id` מחרוזתי בלי אכיפת FK אמיתית.
- **State מחושב, לא מאוחסן** — `Portfolio`/`Position` הם **תמיד** תוצאה
  של `computePositions(investorId, asOfDate?)` מעל `Transaction` +
  `PortfolioOpeningState`. **אין טבלה, אין cache מאוחסן.** זה חל גם על
  Portfolio Fit ב-`InvestmentCase`: `computePortfolioFit()` מחושב מחדש
  בכל צפייה כל עוד `status=researching`. הקיפאון היחיד קורה בתוך
  `DecisionSnapshot.portfolio_state_json` ברגע יצירת ה-Snapshot עצמו.
- **מניעת מחיקה של כל דבר שגרסה מוצבעת אליו** — כל FK מרשומה immutable
  (בעיקר `DecisionSnapshot`) לעבר שורת-גרסה הוא `ON DELETE RESTRICT`
  ברמת ה-DB, בנוסף למדיניות אפליקטיבית של "אין מחיקה" לטבלאות היסטוריה.
  ה-RESTRICT הוא רשת ביטחון, לא מנגנון תפעול רגיל.

---

## 1. זהות וחשבון

**Investor** — `id, email, password_hash (bcrypt/argon2), display_name,
created_at`. Mutable (ניהול חשבון, לא Investment Memory).

---

## 2. Investor DNA

**DNAHypothesis** (identity) — `id, investor_id, created_at,
status(active|user_rejected)`.

**DNAHypothesisVersion** (append-only) — `id, dna_hypothesis_id,
version_number, statement_text, evidence_strength, supporting_evidence_count,
contradicting_evidence_count, created_at, created_by(ai_generated|
user_correction), change_reason`.
- נוצר ע"י: AI (ניסוח) + קוד (evidence_strength, ר' §Evidence Strength
  Table). נצרך ע"י: DNA view, Personal Fit, Decision Snapshot.

**Evidence** — `id`, בדיוק אחד מ-
`{dna_hypothesis_id, strategy_principle_id, learning_insight_id}` (CHECK,
subject), `stance(supporting|contradicting)`, בדיוק אחד או אפס מ-
`{transaction_id, interview_answer_id, decision_review_id,
source_learning_insight_id}` + `manual_note_text?` (CHECK, מקור),
`description, created_at`.
**Immutable לחלוטין — לעולם לא נערך/נמחק.**
- נוצר ע"י: קוד (מדפוסי עסקאות) + AI (מפרשנות ראיון, תמיד עם source_id
  אמיתי). נצרך ע"י: חישוב Evidence Strength, כל "View Evidence".
- **`source_learning_insight_id` (תיקון, התגלה בזמן מימוש Learning
  Insight task):** נדרש בפועל כדי לממש את "סגירת הלולאה ל-DNA" ב-§8 —
  `learning_insight_id` הקיים הוא **subject בלבד** (לא יכול להיות
  source על אותה שורה בגלל CHECK ה-subject היחיד), כך שהמנגנון שכבר
  תואר במפורש ב-§8 ("DNAHypothesisVersion חדש שמצטט את ה-LearningInsight
  כ-Evidence") לא היה בר-ייצוג בסכמה כפי שהיא נבנתה. עמודה חדשה, נפרדת
  מ-`learning_insight_id` הקיים, נוספה לקבוצת ה-source; ה-CHECK עודכן
  בהתאם. גילוי אמיתי של אי-עקביות בין הפרוזה המתוכננת לסכמה בפועל, לא
  שינוי כיוון.

### Evidence Strength — טבלת סף (S=Supporting, C=Contradicting, total=S+C)

| # | תנאי | תוצאה |
|---|---|---|
| 1 | total < 3 | Insufficient Evidence |
| 2 | S/total < 0.6 | Weak |
| 3 | total ≥ 5 וגם S/total ≥ 0.8 | Strong |
| 4 | אחרת (total∈[3,5) עם ratio≥0.6, או total≥5 עם ratio∈[0.6,0.8)) | Moderate |

---

## 3. Strategy

**StrategyPrinciple** (identity) — `id, investor_id, key/slug, created_at`.

**StrategyPrincipleVersion** (append-only) — `id, strategy_principle_id,
version_number, principle_type(declared|observed|validated), statement_text,
rationale_text, created_at, created_by(user_declared|ai_observed|
system_default), change_reason, evidence_strength?, supporting_evidence_count?,
contradicting_evidence_count?`. שלושת השדות האחרונים **nullable** —
נמלאים רק כש-`principle_type=observed` (אותה טבלת סף כמו DNA, ר' §2;
קוד תמיד מחשב, לעולם לא ה-LLM). `declared` הוא ציטוט מפורש של המשתמש
ו-`validated` הוא ברירת מחדל קבועה של המערכת — אף אחד מהם אינו דפוס
סטטיסטי הנבחן, כך שהשדות נשארים null עבורם. **תיקון עקביות (התגלה
בזמן מימוש Baseline Strategy, ר' Docs Sync Rule):** הגדרת השדות המקורית
כאן לא כללה evidence_strength, למרות ש-§0 כבר מסווג Strategy Principle
יחד עם DNA Hypothesis ו-Learning Insight כשלוש הישויות שצוברות ראיות
לפי אותה טבלת סף, ושתי האחרות כן כוללות את השדה — נסתר עד שקוד ה-Baseline
Strategy בפועל נתקל בזה.

**StrategyVersion** (append-only) — `id, investor_id, version_number,
created_at, change_summary`. אין עמודת `approved_by` נפרדת — הטבלה
נכתבת רק דרך תהליך אישור המשתמש (אילוץ ברמת אפליקציה, לא DB); `investor_id`
כבר קובע בעלות, ואין ערך מוסף בעמודה שתמיד שווה לאותו דבר (תוקן בזמן
המימוש, ר' Core Data Model task).

**StrategyVersionPrinciple** (קישור) — `strategy_version_id,
strategy_principle_version_id`.

"Strategy" כישות = `StrategyVersion` העדכני ביותר; אין טבלה נפרדת בשם
Strategy.
- נוצר ע"י: כל שינוי מאושר יוצר `StrategyPrincipleVersion` חדש +
  `StrategyVersion` חדש (מאגד גם עקרונות לא-שונים). נצרך ע"י: Investment
  Case, Decision Snapshot (FK בודד, RESTRICT).

---

## 4. Idea ו-Investment Case

**Idea** — `id, investor_id, ticker, note_text, source(user_manual),
created_at, promoted_to_case_id?`. Mutable.

**InvestmentCase** — `id, investor_id, ticker, idea_id?,
status(researching|decided|archived), tags(text[], AI-assigned, editable),
created_at, updated_at`, ותת-מקטעים: `market_intelligence_json (מ-FMP,
fetched_at), personal_fit_text + evidence_refs, portfolio_fit_text
(narrative, נוצר/מתעדכן ע"י פעולת "רענן ניתוח" — לא בכל צפייה), bull_case_text,
bear_case_text, catalysts_text, invalidation_conditions_text,
market_blindspot_text, devils_advocate_text, synthesis_text`.
**אין `portfolio_fit_metrics_json` מאוחסן** — מטריקות Portfolio Fit
(חשיפה, ריכוזיות וכו') **תמיד מחושבות בזמן קריאה** דרך `computePortfolioFit()`
מעל `computePositions()`, כל עוד `status=researching`.
Mutable כל עוד `researching` — מסמך עבודה חי, לא שיפוט קפוא. Devil's
Advocate הוא שדה על ה-Case, לא agent/ישות נפרדת.
- נוצר ע"י: משתמש + AI (סינתזה) + קוד (Market Intelligence fetch,
  portfolio fit מחושב). נצרך ע"י: Decision Snapshot (מעתיק עותק קפוא).

---

## 5. שרשרת Decision → Review (הליבה ה-immutable)

**Thesis** — `id, thesis_text (משתמש, verbatim), ai_interpretation_text,
created_at`. Immutable. **אין** עמודת `decision_snapshot_id`: הכיוון היחיד
הוא `DecisionSnapshot.thesis_id` (למטה) — FK דו-כיווני בין שתי הטבלאות
היה יוצר תלות מעגלית אמיתית בלי שום תועלת (זהו יחס 1:1 אמיתי; "איזה
Snapshot משתמש בתזה הזאת" הוא lookup הפוך טריוויאלי). תוקן בזמן המימוש,
ר' Core Data Model task.

**Prediction** — `id, thesis_id, claim_text, checkable_by_date?,
status(pending|confirmed|refuted|inconclusive), resolved_at?,
resolved_by_review_id?, resolution_note?`. `claim_text` immutable מרגע
היצירה; שדות רזולוציה נכתבים פעם אחת ע"י Decision Review שפותר אותם.
- נוצר ע"י: AI (מחלץ מה-Thesis). נצרך ע"י: Decision Review (Thesis
  Accuracy).

**Decision** (זהות דקה) — `id, investor_id, investment_case_id, ticker,
decision_type(BUY|PASS|HOLD|ADD|REDUCE|SELL), decision_date, created_at`.

**DecisionSnapshot** — `id, decision_id (1:1), price_at_decision, size?,
user_reasoning_text, ai_realtime_assessment_text, risks_considered_text,
exit_conditions_text, portfolio_state_json (תוצאת computePositions קפואה),
market_context_id (FK, RESTRICT), strategy_version_id (FK, RESTRICT),
thesis_id (FK), investment_case_snapshot_json (עותק קפוא), created_at`.
**אין UPDATE לעולם** — אכיפה בשכבת אפליקציה (repository חושף רק insert);
DB trigger כהקשחה אופציונלית בעתיד.

**DecisionSnapshotDNAReference** (קישור, לא JSON) — `decision_snapshot_id,
dna_hypothesis_version_id (FK, ON DELETE RESTRICT)` — אילו גרסאות-השערה
היו בתוקף ברגע ההחלטה.

**LaterContext** — `id, decision_id, added_at, text, added_by(user|ai)`.
Append-only.

**DecisionReview** — `id, decision_id, review_date, narrative_summary_text
(שכבה 1, AI), decision_quality_overall (ר' טבלת Rollup למטה),
thesis_accuracy(confirmed|partially_confirmed|refuted|inconclusive|
insufficient_evidence, AI נתמך ע"י Prediction resolutions), outcome_json
(P/L, %-תשואה — קוד טהור), created_at`. Immutable; review חוזר = שורה
חדשה.

**ReviewDimension** — `id, decision_review_id,
dimension(thesis_quality|evidence_quality|risk_awareness|
valuation_awareness|portfolio_fit|strategy_consistency|exit_conditions),
verdict(strong|reasonable|weak|insufficient_evidence), rationale_text,
cited_snapshot_fields(json array — חובה תוכן, אחרת verdict=
insufficient_evidence, נאכף באפליקציה), created_at`. Immutable, שכבה 2.

### decision_quality_overall — טבלת Rollup (מ-7 ה-ReviewDimension verdicts)

| # | תנאי | תוצאה |
|---|---|---|
| 1 | insufficient_evidence ≥ 4 מתוך 7 | Insufficient Evidence |
| 2 | weak ≥ 2 מתוך 7 | Weak |
| 3 | weak == 1 וגם strong == 0 | Weak |
| 4 | strong ≥ 5 מתוך 7 וגם weak == 0 | Strong |
| 5 | אחרת | Reasonable |

מוטה במכוון לזהירות: חולשה אחת בלי חוזק מנגד ⇒ Weak, לא מעוגל כלפי מעלה.
נגזר בקוד מתוך ה-verdicts בפועל, לעולם לא נקבע ע"י AI ישירות. הפירוט המלא
של 7 הממדים מוצג תמיד לצד התווית הכוללת (Traceable Judgments).

**Correction** (מכליל Appeal) — `id`, בדיוק אחד מ-
`{review_dimension_id, decision_review_id, dna_hypothesis_id,
strategy_principle_id, learning_insight_id}` (CHECK), `user_argument_text,
created_at, status(pending|led_to_new_review|led_to_new_version|noted),
resulting_review_id?, resulting_version_id?`. מנגנון ערעור גנרי אחד לכל
המערכת; לעולם לא דורס — אם מתקבל, יוצר Review/Version חדשים.

---

## 6. Portfolio, Transactions

**Transaction** — `id, investor_id, ticker?,
transaction_type(buy|sell|dividend|deposit|withdrawal|fee), quantity?,
price?, amount, transaction_date, source(csv_import|manual_entry),
import_batch_id?, notes?, created_at, updated_at`. **Mutable-לתיקון**
(עובדה גולמית, לא שיפוט). שיטת cost-basis: **Average Cost** (לא FIFO) —
פישוט מכוון: המוצר לא מיועד לדיווח מס; ניתן לשדרג בלי לשבור snapshots
ישנים (כבר קפואים כ-JSON).

**PortfolioOpeningState** — `id, investor_id, ticker, quantity,
cost_basis_per_share?, cost_basis_confidence(known|approximate|unknown),
as_of_date, created_at, updated_at`. Mutable-לתיקון, מסומן UI כ-self-reported.

**ImportBatch** — `id, investor_id, filename, uploaded_at, row_count,
status`.

**Portfolio / Position** — **אין טבלה.** `computePositions(investorId,
asOfDate?)` מעל Transaction+PortfolioOpeningState. גם ממלא את
`portfolio_state_json` הקפוא ב-Snapshot וגם את `computePortfolioFit()`
החי ב-Investment Case.

---

## 7. Market Data / Context

**MarketContext** — `id, captured_at, index_level, index_change_1d/1m,
sector_performance_json, volatility_index_value, source, raw_data_json`.
Immutable מרגע היצירה.

**MarketDataCache** (תשתית, לא Investment Memory) — `id, ticker,
data_type(quote|profile|historical_price), payload_json, fetched_at,
expires_at`. Mutable/מתחלף.

---

## 8. Learning

**LearningInsight** (identity) — `id, investor_id, family/category,
created_at`.

**LearningInsightVersion** (append-only) — `id, learning_insight_id,
version_number, statement_text, decision_quality_pattern_json /
thesis_accuracy_pattern_json (אגרגציה דטרמיניסטית), evidence_strength
(אותה טבלה כמו DNA), created_at, created_by, change_reason`.

**סגירת הלולאה ל-DNA:** אישור משתמש (Correction, status=led_to_new_version)
יוצר `DNAHypothesisVersion` חדש שמצטט את ה-LearningInsight עצמו כ-Evidence
(`Evidence.learning_insight_id`) — שימוש חוזר במנגנון Evidence הקיים.

---

## 9. Onboarding Interview

**InterviewSession** — `id, investor_id, started_at, completed_at?,
status`.

**InterviewAnswer** — `id, interview_session_id, transaction_id?,
question_text(AI), answer_text(משתמש), supersedes_answer_id?, created_at`.
Append-only.

---

## 10. אכיפת Immutability — סיכום קונקרטי

- **אין UPDATE/DELETE בכלל** (repository layer חושף רק `insert`):
  `DecisionSnapshot`, `DecisionReview`, `ReviewDimension`, `Thesis`,
  `LaterContext`, `Evidence`, `DNAHypothesisVersion`,
  `StrategyPrincipleVersion`, `StrategyVersion`, `LearningInsightVersion`,
  `InterviewAnswer`.
- **`ON DELETE RESTRICT`**: `strategy_version_id`, `market_context_id`,
  `dna_hypothesis_version_id` (דרך `DecisionSnapshotDNAReference`),
  `thesis_id` — כל FK שיוצא מ-`DecisionSnapshot`.
- **Mutable** (עובדה גולמית/מסמך עבודה, לא שיפוט קפוא): `Transaction`,
  `PortfolioOpeningState`, `MarketDataCache`, `Idea`, `InvestmentCase`
  (בזמן `researching`).

---

## פישוטים מכוונים
1. Portfolio/Position — תמיד מחושבים, גם ב-Investment Case, לא רק
   ב-Position "כללי" — אין cache מאוחסן בשום מקום.
2. Strategy אינה טבלה נפרדת — "Strategy" = ה-StrategyVersion העדכני.
3. Devil's Advocate — שדה על Investment Case, לא agent/ישות נפרדת.
4. Average Cost ולא FIFO — לא רלוונטי לדיווח מס, רק לאיכות החלטה.
5. Evidence/Correction — typed-nullable-FK+CHECK, לא polymorphic string.
6. Decision Snapshot אחד מסיים את שלב ה-`researching` של Case — ברגע
   שנרשמת החלטה (כל `decision_type`, כולל PASS), ה-`InvestmentCase`
   עובר ל-`status=decided` ואינו נפתח מחדש. שקילה חוזרת של אותו טיקר
   בהמשך פותחת Idea/Case חדשים, לא מוסיפה החלטה שנייה לאותו Case —
   לא צוין מפורש בתכנון המקורי, הוחלט בזמן מימוש Decision Snapshot
   task כדי ש-`status` יישאר חד-משמעי בלי לתמוך במעקב multi-decision
   לא-מתוכנן.
