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
  `MAX(version_number)`, אף פעם לא flag שמתעדכן. **`UNIQUE(parent_id,
  version_number)`** ברמת ה-DB על כל טבלת גרסה (dna_hypothesis_versions,
  strategy_principle_versions, strategy_versions, learning_insight_versions)
  — נוסף אחרי שכפל אמיתי (double-click / React StrictMode double-invoke)
  יצר שתי שורות עם אותו `key`/version בפועל; "הגרסה הנוכחית" תקף רק אם
  אף פעם אין שני version_number זהים לאותו parent, וזה לא היה אכוף עד
  אז ברמת ה-DB, רק בהנחה יישומית.
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
user_correction|system_grounding_revalidation|system_confidence_recalculation), change_reason`.
- נוצר ע"י: AI (ניסוח) + קוד (evidence_strength, ר' §Evidence Strength
  Table). נצרך ע"י: DNA view, Personal Fit, Decision Snapshot.
- **`created_by=system_grounding_revalidation`** (DNA Grounding
  Remediation, Autonomous Unit 3): ערך שלישי, נוסף כי אף אחד משני
  הערכים הקיימים לא כן — `ai_generated` מרמז הצעה טרייה מ-`dna.generate`,
  `user_correction` מרמז יזמת משתמש; גרסה שנוצרת כשהמערכת בודקת מחדש
  ראיה **קיימת-שלה-עצמה** מול Evidence Grounding (§ למטה) ומוצאת שהסט
  התקף השתנה היא לא אחד משני אלה. `statement_text` **לא** משתנה בגרסה
  כזו — רק ה-composition/ספירה של הראיה.
- **`created_by=system_confidence_recalculation`** (Confidence Recalculation
  Remediation; ערך זהה גם ב-`principle_created_by` של Strategy §3 — enum
  values לא משותפים בין enum types, לכן ערך משוקף בכל אחד): גרסה שמצורפת
  append-only כש-*הסמנטיקה* של `evidence_strength` השתנתה (ר' טבלת הסף למטה)
  וה-tier ששמור בגרסה **האחרונה** כבר לא מה ש-`calculateEvidenceStrength()`
  מחשב מאותם S/C. אינה ראיה חדשה, אינה grounding, אינה מידע זהות חדש ואינה
  תיקון משתמש — לכן אף אחד מארבעת הערכים האחרים לא כן. נשמרים זהים: statement,
  S, C (ב-Strategy גם `principle_type` ו-`rationale_text`); משתנים רק id,
  version_number, created_at, created_by, change_reason ו-`evidence_strength`.
  ה-grounding checks של הגרסה הקודמת (scoped לגרסה) מועתקים קדימה עם הסימון
  המפורש "Carried forward unchanged from version …" והנימוק המקורי — לא מתבצע
  judgment חדש, ובלי ההעתקה הגרסה החדשה הייתה נופלת חזרה לכל-הראיה-הגולמית
  ומחזירה ציטוטים שנדחו. אין AI. אידמפוטנטי — ההחלטה היא השוואת הגרסה
  האחרונה מול ה-helper הנוכחי, כך שהרצה שנייה היא no-op; מקביליות: נעילת שורת
  ה-identity (`FOR UPDATE`) + `UNIQUE(parent, version_number)` כ-backstop. Bundles
  ו-DecisionSnapshots לא נוגעים. (מימוש: `src/lib/evidence/recalculate-confidence.ts`,
  `recalculateDnaHypothesisConfidence`/`recalculatePrincipleConfidence`;
  מיגרציה 0010 מוחלת על ה-DB האמיתי ו-`applyConfidenceRecalculationsForInvestor`
  רץ עבור המשקיע האמיתי — 2026-09-21, אומת קריאה-בלבד 2026-09-22 ר' `docs/backlog.md`.)

**DNAEvidenceGroundingCheck** (append-only, `dna_evidence_grounding_checks`
— DNA Grounding Remediation, Autonomous Unit 3) — `id,
dna_hypothesis_version_id (FK), evidence_id (FK), verdict(supported|
unsupported), reason, checked_at`. `UNIQUE(dna_hypothesis_version_id,
evidence_id)` (שם מפורש, לא auto-generated — ר' ההערה על שמות constraint
שנחתכים ל-63 תווים למטה). התוצאה המאוחסנת של קריאת `checkEvidenceGrounding()`
(§ Evidence Grounding למטה) עבור *citation ספציפי* ו-*גרסה ספציפית* —
לא ל-identity, כי Evidence עצמה (למטה) לא scoped לגרסה בכלל, וללא
הטבלה הזו אין דרך לדעת אילו citations ספציפית סופרים לאיזו גרסה. תמיד
נוסף, אף פעם לא נערך — אין כאן flag "נוכחי"; "הגרסה הנוכחית" נשארת
`MAX(version_number)` בדיוק כמו קודם. **`dna.generate` אינו כותב check rows עבור identity חדש** (כל ראיה שלו עברה
grounding בזמן היצירה, וגרסה בלי אף שורת check נופלת ל-raw — ה-fallback
המאושר). **אבל גרסה חדשה שנוספת ל-identity שהגרסה הנוכחית שלו *כבר* כוללת
checks נושאת אותם קדימה** (`checksForAppendedVersion`,
`src/lib/evidence/append-version-checks.ts`): כל verdict קודם — כולל דחיות —
מועתק כמות שהוא, והראיה שהגרסה מוסיפה נרשמת `supported` (היא זה עתה עברה
grounding). בלי זה גרסה כזו הייתה נופלת בשקט ל-raw ומחזירה כל citation
ש-remediation דחה. גרסה בלי אף שורת check = מעולם לא נבדקה מול grounding —
לא "נבדקה ועברה".

**Evidence** — `id`, בדיוק אחד מ-
`{dna_hypothesis_id, strategy_principle_id, learning_insight_id}` (CHECK,
subject), `stance(supporting|contradicting)`, בדיוק אחד או אפס מ-
`{transaction_id, interview_answer_id, decision_review_id,
source_learning_insight_id}` + `manual_note_text?` (CHECK, מקור),
`description, created_at`.
**Immutable לחלוטין — לעולם לא נערך/נמחק.**
- נוצר ע"י: קוד (מדפוסי עסקאות) + AI (מפרשנות ראיון, תמיד עם source_id
  אמיתי). נצרך ע"י: חישוב Evidence Strength, כל "View Evidence".
- **Raw vs. Effective evidence (DNA Grounding Remediation, Autonomous
  Unit 3):** `Evidence` שייכת תמיד ל-**identity** (`dna_hypothesis_id`),
  **לא** לגרסה ספציפית — `getEvidenceForDnaHypothesis` (ללא שינוי)
  ממשיכה להחזיר את **כל** הראיה ההיסטורית של ה-identity, בלי סינון,
  לעולם לא הופכת ללא-נגישה. "View Evidence" בעמוד ה-DNA (וכל צרכן
  עתידי שצריך את מה שגרסה *ספציפית* באמת סופרת) קורא במקום זאת ל-
  `getEffectiveEvidenceForDnaHypothesisVersion` (`src/db/repositories/evidence.ts`)
  — מסננת לפי `DNAEvidenceGroundingCheck` (למעלה) כשקיימות שורות check
  לגרסה, ונופלת אוטומטית לכל-הראיה-הגולמית כשאין (כל גרסה שלא עברה
  remediation — ההתנהגות המקורית, ללא שינוי).

- **ספירת identity ב-`generate` (DNA ו-Strategy) מתבססת על ה-effective של
  הגרסה *הנוכחית*, לא על ה-raw.** `getCountingEvidenceForDnaVersion` /
  `getCountingEvidenceForStrategyPrincipleVersion` מחזירות `{effective, rejected}`
  (`partitionEvidenceForCounting` — אותו `selectEffectiveEvidence`; ב-check-set קיים
  שורה בלי verdict = rejected, fail-closed; ללא checks כלל = הכול effective, ה-fallback
  המאושר). ראיה ב-raw ש-remediation דחה **אינה** נספרת: לא מעלה `S`/`C`/`S_ub`/`C_ub`,
  לא יוצרת קשת חלשה, ולא יוצרת גרסה חדשה. **דחייה מפורשת דביקה:** הצגה חוזרת של
  אותו זוג (תשובה + stance) לאותו identity — גם אם grounding במקרה מקבל אותו הפעם —
  אינה נספרת ואינה מוסיפה Evidence (`no_new_information`); רק re-grounding מפורש
  (remediation) שופט מחדש, כך שאי-דטרמיניזם של ה-AI לעולם לא מעלה confidence. הדחייה
  ספציפית ל-stance. הכתיבה (`insert…VersionWithEvidence`) דורשת `expectedBaseVersionId` **ו-`expectedBaseCheckCount`**
  (כמה checks היו לגרסה שנספרה מולה) וזורקת `StaleIdentityVersionError` (מתורגם ל"נסה שוב")
  אם הגרסה שנספרה מולה כבר אינה האחרונה **או** שנוספו לה checks מאז — remediation
  (`checked_no_change`) מוסיף verdicts לגרסה קיימת *בלי* גרסה חדשה, ולכן גארד על ה-id לבדו לא היה
  מזהה אותו. כך ה-counts וה-verdicts שנישאים קדימה מתארים תמיד אותו מצב. הכתיבה נעולה על שורת
  ה-identity (`FOR UPDATE`), כמו ה-recalculations.
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
| 1 | **S** < 3 (supporting independent cases בלבד) | Insufficient Evidence |
| 2 | S/total < 0.6 | Weak |
| 3 | **S** ≥ 5 וגם S/total ≥ 0.8 | Strong |
| 4 | אחרת (S∈[3,5) עם ratio≥0.6, או S≥5 עם ratio∈[0.6,0.8)) | Moderate |

**ה-tier הוא ביטחון ב-claim, לא כמות ראיה (2026-09-20, תוקן אחרי ריצה חיה).**
שני שערי גודל-המדגם (שורות 1 ו-3) סופרים **S בלבד**, לא S+C. הגרסה הקודמת
השתמשה ב-total: מקרה **סותר** בודד העלה claim עם 2 מקרים תומכים מ-Insufficient
ל-Moderate (`3653aeed` v2 בריצת ה-Strategy החיה; וגם `7c3665ca` v1 ב-DNA האמיתי),
וגם העביר אותו מ"מוחרג מהקשר ה-AI" (`excludeInsufficientEvidence`) ל"נכלל בו".
**אינווריאנט (נאכף בטסט על גריד S,C∈0..25):** בהינתן S קבוע, הגדלת C **לעולם לא**
מעלה את ה-tier, ואף tier לא עולה על מה שאותה ראיה תומכת מרוויחה ללא שום סתירה.
סתירה נשארת מידע אמיתי — נשמרת, נספרת ונראית — היא רק לא יכולה *ליצור* ביטחון;
היא עדיין **מורידה** אותו דרך שער ה-ratio (למשל S=3,C=3 → Weak; S=5,C=20 → Weak).
שינוי מינימלי: בדיוק ה-repair המונוטוני הגדול ביותר של הכלל הישן (מוריד tiers
רק במקום שהיה צריך; עמודת C=0 לא השתנתה) — בגריד S,C∈0..40: 117 תאים עם S<3, ועוד (4,1)
שהיה Strong (הסתירה הרימה Moderate ל-Strong). אין tier "contested" — הוא היה
דורש שינוי enum/מיגרציה; הספירות S/C נשארות גלויות. **גרסאות שכבר נשמרו לא
נכתבו מחדש** (היסטוריה immutable); תיקון-בדיעבד שלהן הוא append-only נפרד.

**"total"/S/C סופרים independent EPISODES, לא raw Evidence rows —
Investment Episode Independence (תוקן בפועל, session זה).** `total`
בטבלה למעלה הוא תמיד תוצאה של `calculateEvidenceStrength()`
(`src/lib/dna/evidence-strength.ts`, לא נגע) על ספירה שכבר עברה
`countIndependentCases()` (`src/lib/evidence/count-independent-cases.ts`,
גם הוא לא נגע) — אבל ה-**case key** שמוזן לפונקציה הזו תוקן: לא עוד
`transactionId ?? answerId` גולמי (שהיה סופר כל עסקה בנפרד — פוזיציה
אחת עם BUY וכמה SELL הייתה יכולה לבד לחצות את סף "Insufficient →
Moderate"), אלא `episodeKey` — כל העסקאות של אותו רצף פתוח-עד-שטוח
("investment episode", למשל BUY+partial SELL+final SELL רציפים על
טיקר אחד) חולקות מפתח אחד. נגזר טרי, in-memory, בכל קריאה, ע"י
`computePositions()` (`src/lib/portfolio/positions.ts`, שדה נוסף
`episodeKeyByTransactionId` על ה-return שלו — לא נשמר, לא זכרון קבוע,
לא נכנס לשום snapshot), ומוזן ל-`dna.generate`/`strategy.generateObserved`
דרך ה-resolver המשותף `createIndependenceResolver`
(`src/lib/evidence/resolve-independence.ts`, ר' "Decision Independence
V1" מיד אחרי; `buildAnswerCaseKeys` הוחלף ונמחק) — שני הראוטרים קוראים
לאותו resolver, לא מימוש כפול. `InterviewAnswer` עם `transaction_id=null`
ממשיך להשתמש ב-`answer.id` כ-case key, בדיוק כמו קודם — לא נגע. תשתית
מלאה (חוזה סדר תוך-יומי, מודל ceiling/exactKnown, retrospective
run-based key assignment) בתיעוד התכנון של ה-session; אין טבלה חדשה
(`investmentEpisode` **לא** נוסף לסכמה) — episode תמיד מחושב, לא
מאוחסן, באותה רוח כמו `computePositions()` עצמו.

**Decision Independence V1 — עצמאות חוצת-tickers (מומש 2026-09-22;
מיגרציה `0011` **הוחלה** על ה-DB האמיתי ב-2026-09-22 ו-`applyIndependenceRecalculationsForInvestor`
רץ פעם אחת — DNA `699cdb50` → v3, Strategy `a48426b1` → v2, שתיהן S=1/C=0
insufficient_evidence, 0 requires_review; תוקן במסמך 2026-09-22).** ה-episode הוא
per-ticker בכוונה, ולכן החלטה אחת שנפרשת על שני tickers (מכירת MP כדי
לממן קניית MRVL — `a48426b1`) נספרה פעמיים. `createIndependenceResolver`
(טהור: בלי DB ובלי AI) הוא **האלגוריתם היחיד** ש-DNA ו-Strategy סופרים
דרכו — validation, grounding, remediation, identity resolution ו-recalculation;
Learning Insight מחוץ ל-scope וממשיך ב-`countIndependentCases`.
- **קבוצות חזקות:** לכל citation קבוצת labels — ה-episode שלו + מזהה כל
  `TransactionLinkFact` אפקטיבי מסוג `linked` שמכיל את העסקה; קבוצה = רכיב
  קשירות תחת "חולקים label". בלי facts זו בדיוק ההתנהגות הקודמת (ללא עסקה →
  `answer.id`, ובנוסף `unanchoredCitations` נרשם ב-basis). תלות אף פעם לא
  מתפשטת דרך פריט שלא צוטט.
- **קשת חלשה (UNRESOLVED)** בין שתי קבוצות: זוג עסקאות **מצוטטות**, cross-ticker,
  בצדדים הפוכים, ב-≤14 ימים (`maxGapDays`), **וגם** אחד מ: (א) *exclusive
  counterpart* — אין שום buy/sell אחר בחשבון ב-[המוקדם−3d, המאוחר+3d]
  (`isolationMarginDays`) מחוץ ל-episodes של שתי העסקאות; (ב) *named counterpart*
  — המשקיע הזכיר את ה-ticker של הצד השני בטקסט התשובה **שלו** (token לטיני
  case-sensitive; לא שאלת האפליקציה; לא ה-ticker העצמי). **קרבה זמנית בלבד =
  review-only:** מדווחת ולעולם לא נספרת — על ההיסטוריה האמיתית 6–13% מכל זוגות
  ה-cross-ticker נראים כך, וכלל כזה היה מפיץ תלות על כל העסקאות. same-day-any-side
  והתאמת סכומים נדחו.
- **Envelope סגור (בלי enumeration):** `S_lb` = רכיבי קשתות-חלשות ללא קבוצה
  סותרת; `C_ub` = מספר הקבוצות הסותרות (קשת חלשה **לעולם** לא מקטינה אותה);
  `S_ub` = קבוצות תומכות בלבד (תצוגה/audit). **`calculateEvidenceStrength(S_lb, C_ub)`**
  שווה בדיוק ל-tier המינימלי מעל כל פתרון אפשרי של הקשתות (הוכח, ונבדק brute-force
  כ-oracle בטסטים בלבד). אין `C_lb` בחוזה.
- **נשמר:** `supporting/contradicting_evidence_count` = `S_lb`/`C_ub`, בתוספת
  `independence_basis_json` (nullable `jsonb` ב-`dna_hypothesis_versions` וב-
  `strategy_principle_versions`; `NULL` = נספר לפני V1, episode-only, ללא backfill):
  policy version, קבוצות וסיבותיהן, קשתות חלשות, review-only, facts שנוצלו.
  סידור דטרמיניסטי; byte-identity מוגדר מעל `serializeIndependenceBasis` (מפתחות
  ממוינים — `jsonb` ממיין מחדש).
- **`TransactionLinkFact` / `TransactionLinkFactMember`** — ההצהרה המחייבת
  היחידה של המשקיע (`verdict` = `linked` | `independent`); append-only +
  `supersedes_fact_id` (יורש אחד לכל היותר; עובדה אפקטיבית = ראש השרשרת). אין
  `origin`/`ai_*`/`kind`/`channel`/`role` — רק פקודה של משקיע כותבת. אכיפה ב-repository:
  ≥2 עסקאות של אותו משקיע, כולן buy/sell עם ticker; `linked` דורש sell, buy ו-≥2
  tickers; verdicts סותרים על אותו זוג נדחים אלא אם superseding. **אין mutation
  procedure** — הכתיבה מחכה ל-workflow אישור. `linked` קורס את הקצוות לשני ה-stances;
  `independent` מדכא קשת חלשה לזוג (ולא מפצל episode). ל-AI אין שום סמכות והשפעה על ספירה.
- **Identity resolution:** "genuinely new" = עלייה ב**מספר הקבוצות החזקות**.
  citation שנופל בקבוצה שכבר נספרה (אותו episode / fact) לא יוצר גרסה; citation
  שרק קשת חלשה קושרת אותו נרשם (ראיה לא נזרקת על "אולי") ו-`S_lb` לא עולה.
  "כבר נספר" = ה-effective של הגרסה הנוכחית (ר' Raw vs. Effective למעלה), לא ה-raw.
- **Recalculation (`created_by = system_independence_recalculation`):**
  `planIndependenceRecalculationsForInvestor` (dry-run) /
  `applyIndependenceRecalculationsForInvestor` מוסיפים גרסה רק כש-`(S_lb, C_ub)` **לא
  גבוהים** מהשמורים (הגנה כיוונית); **עלייה** (קשת שנעלמה, backfill שהרס isolation,
  שינוי policy) מדווחת ל-review ואינה נכתבת. counts זהים ⇒ no-op גם כש-basis הישן NULL.
- **מחוץ ל-scope:** Review UI, שדה "funded by", claim-scoped release, Learning
  Insight, same-ticker cross-episode, AI proposals (ר' `docs/backlog.md`).

---

## 3. Strategy

**StrategyPrinciple** (identity) — `id, investor_id, key/slug, created_at`.

**StrategyPrincipleVersion** (append-only) — `id, strategy_principle_id,
version_number, principle_type(declared|observed|validated), statement_text,
rationale_text, created_at, created_by(user_declared|ai_observed|
system_default|system_grounding_revalidation|system_confidence_recalculation), change_reason, evidence_strength?, supporting_evidence_count?,
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

- **`created_by=system_grounding_revalidation`** (Strategy Grounding +
  Identity Hardening task) — ערך רביעי, המקבילה המדויקת של
  `dna_created_by`'s הערך באותו שם (ר' §2 למעלה), אבל ב-**enum נפרד**
  (`principle_created_by`) — לא reuse בין שני סוגי enum שונים ב-Postgres.
  נוסף כי גרסה שנוצרת כשהמערכת בודקת מחדש ראיה **קיימת-שלה-עצמה** של
  עיקרון `observed` מול Evidence Grounding (למטה) ומוצאת שהסט התקף
  השתנה — היא לא `ai_observed` (לא הצעה טרייה מ-`generateObserved`)
  ולא `user_declared`/`system_default`. `principle_type` נשאר בלתי-משתנה
  בגרסה כזו — remediation לעולם לא מסווג מחדש עיקרון.

**StrategyEvidenceGroundingCheck** (append-only,
`strategy_evidence_grounding_checks` — Strategy Grounding + Identity
Hardening task) — `id, strategy_principle_version_id (FK), evidence_id
(FK), verdict(supported|unsupported), reason, checked_at`.
`UNIQUE(strategy_principle_version_id, evidence_id)` (שם מפורש). המקבילה
המדויקת מבחינה סמנטית של `DNAEvidenceGroundingCheck` (§2) — **טבלה
נפרדת ולא reuse**, כי `Evidence.strategy_principle_id` ו-`Evidence.dna_hypothesis_id`
הן שתי עמודות subject שונות, וטבלת grounding-check משותפת-פולימורפית
לא הייתה מוסיפה תועלת אמיתית על פני שתי טבלאות ממוקדות. `verdict` כן
**reuse** את ה-enum `grounding_verdict` הקיים (לא מוגדר-מחדש) — בניגוד
ל-provenance, לערכי ה-verdict אין שום סמנטיקה ספציפית ל-DNA; הם הפלט
הגנרי של `checkEvidenceGrounding()` (`src/lib/ai/dna-grounding.ts`),
הנקרא ללא שינוי גם עבור Strategy. אותה סמנטיקת raw-vs-effective, אותה
נפילה-אחורה ל-legacy, ואותו invariant של "complete check set" כמו
המקבילה ב-DNA — ר' §2 להסבר המלא, לא חוזר כאן.

**Strategy Identity Resolution** (Strategy Grounding + Identity
Hardening task) — `generateObserved` כבר לא יוצר identity חדש+version 1
ללא-תנאי לכל proposal ששרד validation+grounding; `classifyHypothesisMatch`
(`src/lib/ai/dna-identity.ts`, נקרא ללא שינוי) מותאם מול עקרונות
`observed` **פעילים קיימים בלבד** — `filterToObservedCandidates`
(`src/lib/strategy/resolve-principle-identity.ts`) מסנן `declared`/
`validated`/`system_default` החוצה **לפני** שמשהו מגיע לשלב ההתאמה,
כי `strategyPrinciples` היא טבלת identity הטרוגנית המשותפת לשלושת
ה-tiers (בניגוד ל-`dnaHypotheses`, שאין לה פיצול כזה) — התאמה לא-מסוננת
הייתה יכולה ליצור merge חסר-משמעות בין דפוס observed טרי לבין הצהרה
מילולית של המשתמש עצמו או ברירת-מחדל קבועה של המערכת. אותו כלל
"case-key set גדל ממש → גרסה חדשה" כמו ב-DNA. אין matching לעקרונות
`declared`/`validated` בכלל, גם לא כ-fallback.

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

**Prediction** — `id, thesis_id, claim_text, kind(forecast|reentry_condition)?,
checkable_by_date?, status(pending|confirmed|refuted|inconclusive),
resolved_at?, resolved_by_review_id?, resolution_note?`. `claim_text`
ו-`kind` immutable מרגע היצירה; שדות רזולוציה נכתבים פעם אחת ע"י
Decision Review שפותר אותם.
- נוצר ע"י: AI (מחלץ מה-Thesis). נצרך ע"י: Decision Review (Thesis
  Accuracy).
- `kind` — `forecast` (טענה על מה שיקרה) לעומת `reentry_condition`
  (תנאי לשקילה מחדש של ההחלטה, לא טענה על מה שיקרה). נוסף
  2026-08-23 אחרי שנמצא בפועל (ר' `docs/backlog.md` — "נבנה") שה-AI
  בלבל בין השניים: תנאי-יציאה ("אשקול מחדש אם X") חולץ וכונה בניסוח
  תחזית ("X יקרה"), ואם כמה תנאים חלופיים (OR) נאמרו יחד — רק אחד
  חולץ, וסטטוס הפתרון שלו לבדו נתפס כאילו הוא קובע את כל הטענה.
  `kind` הוא `null` עבור Prediction-ים שנוצרו לפני התאריך הזה — לא
  משוחזר בדיעבד. Decision Review (`synthesizeDecisionReview`,
  `src/lib/ai/review.ts`) מקבל את מלוא `userReasoningText`/
  `exitConditionsText` המקוריים (לא רק את רשימת ה-Predictions
  המבודדת) כדי להסיק בעצמו אם כמה `reentry_condition` שייכים לאותה
  קבוצת-OR — **אין** מבנה `group_id` פורמלי בטבלה (אופציה חלופית
  ששקלנו ונדחתה במכוון בשלב הזה: פחות over-engineering, אבל דורש
  שה-AI יקרא נכון את הקשר הלוגי מהטקסט המקורי בכל פעם, לא מובטח
  ע"י מבנה נתונים).

**Decision** (זהות דקה) — `id, investor_id, investment_case_id, ticker,
decision_type(BUY|PASS|HOLD|ADD|REDUCE|SELL), decision_date, review_by_date?,
created_at`. `review_by_date` (Open-Decision Monitoring V1, 2026-09-23):
מועד ה-Review שהמשקיע בחר — date-only 00:00Z; NULL = "לא נקבע תאריך
Review" (רשומות ישנות נשארות NULL, אין backfill); בהחלטה חדשה הבחירה
**מפורשת** (תאריך או "ללא", שדה חסר = שגיאת ולידציה); **כתיבה פעם אחת**
— המעבר היחיד המותר NULL→תאריך, ב-UPDATE אטומי עם תנאי בעלות ו-`IS NULL`
(`setReviewByDateIfUnset`), לעולם לא תאריך→תאריך אחר ולא →NULL. לא לפני
יום ההחלטה.

**Decision Monitoring (נגזר, לא נשמר; Open-Decision Monitoring V1)** — אין
טבלה ואין enum: `deriveDecisionAttention()` מחשבת בקריאה לכל Decision
מצב `attention | monitoring | settled`, baseline (Review אחרון או תאריך
ההחלטה), מצב אופק (`not_set | upcoming | due | satisfied`), Predictions
ממתינים/שהגיע מועדם, עובדות ביצוע מקובצות (ידועות לפני ההחלטה / נוספו
בדיעבד לפני ההחלטה / ביום ההחלטה / אחרי ההחלטה — `transaction_date` הוא
תאריך קלנדרי (00:00Z, רכיבי UTC) מול היום הקלנדרי של `decision_date` באזור
הזמן שהלקוח שולח (IANA, זה שבו ה-UI מרנדר תאריכים), ו-`transactions.created_at`
כשעון החידוש — השוואת רגעים, בלי ימים) ומצב פוזיציה מ-`computePositionsForInvestor()` בלבד. ארבע סיבות
בדיוק (ר' `docs/architecture.md` §2.9). שום דבר מזה לא נכתב.

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
transaction_type(buy|sell|dividend|deposit|withdrawal|fee|tax_refund), quantity?,
price?, amount, transaction_date, source(csv_import|manual_entry),
import_batch_id?, notes?, intra_day_order?, order_unknown_reason?
(user_declared|never_recorded), created_at, updated_at`.
**Mutable-לתיקון** (עובדה גולמית, לא שיפוט). שיטת cost-basis: **Average
Cost** (לא FIFO) — פישוט מכוון: המוצר לא מיועד לדיווח מס; ניתן לשדרג בלי
לשבור snapshots ישנים (כבר קפואים כ-JSON).

**Same-day ordering (`intra_day_order`/`order_unknown_reason`)** — שתי
עמודות nullable נוספות, נוגעות ל-Investment Episode Independence (ר'
מטה): כש-transactions של אותו `(investor_id, ticker, transaction_date)`
מתנגשות (יותר מעסקה אחת בדיוק באותו timestamp), הסדר היחסי ביניהן או
מוצהר (`intra_day_order`, ייחודי בתוך הקבוצה — `UNIQUE(investor_id,
ticker, transaction_date, intra_day_order) WHERE intra_day_order IS NOT
NULL`) או מסומן כלא-ידוע (`order_unknown_reason`: `user_declared` =
המשתמש נשאל בזמן ה-confirm ואמר "לא ידוע"; `never_recorded` = התגלה
בדיעבד, אף אחד לא נשאל — למשל backfill על נתונים ישנים, או התנגשות עם
שורה קיימת ש-Manual Entry/Import לא תומכים ב"עריכה רטרואקטיבית" שלה).
נכתב אך ורק ע"י ה-atomic confirm contract ב-`confirmTransactionsWithOrdering`
(`src/db/repositories/portfolio.ts`) — נועל בעזרת
`pg_advisory_xact_lock` per `(investor_id, ticker, transaction_date)` כדי
שקונפירם מקבילי לא ייצור מצב לא-מסומן/מעורב. ההבחנה המדויקת (Scope
Boundary): ה-accumulator הקיים של `computePositions()`
(quantity/total_cost_basis/avg cost/sellTrace/warnings/positions
המוצגים) **אף פעם לא קורא** את שתי העמודות האלה — ללא שינוי. גזירת
ה-episode הנפרדת (`deriveEpisodeKeys()`, `src/lib/portfolio/positions.ts`)
כן קוראת אותן, וכן — מבחינה טכנית — מופעלת **מתוך** `computePositions()`
עצמו (קריאה אחת, לצד ה-accumulator, לא לתוכו), ומאכלסת שדה נוסף
בלבד (`episodeKeyByTransactionId`) על ה-return שלו; שום ערך שה-accumulator
כבר חישב לא נקרא/משתנה בחזרה. ר' מטה.

**Transaction identity / reconciliation (History Refresh V1, 2026-09-22)**
— אין עמודה ואין אילוץ; זהות מחושבת בקוד (`src/lib/import/reconcile.ts`)
בכל preview ובכל confirm (תחת ה-advisory locks של
`confirmTransactionsWithOrdering`, על השורות הקיימות שנשלפו שם — לעולם לא
על סיווג מהלקוח). **מפתח זהות מדויקת:** `(ticker↑, transaction_type,
transaction_date [timestamp מדויק, אותה גרנולריות כמו התנגשות הסדר-היומי],
quantity, price, amount)`, כל מספר בצורה קנונית = עיגול ל-8 ספרות אחרי
הנקודה + הסרת אפסים — הייצוג הסמכותי ב-pipeline הוא `String(number)` לתוך
`numeric`, שמדליף רעש IEEE-754 (השורה הידנית האמיתית של MRVL:
`-999.9901229999999` עבור 4.5419×220.17); הדיוק האמיתי לעולם לא עולה על 6
ספרות (כמות 4 × מחיר 2; סכומי CSV ≤ 2), כך שהקנוניזציה מסירה רק רעש.
**Multiset:** N קיימים בולעים ≤ N נכנסים; העודף חדש. `notes` אינו חלק
מהזהות. **התאמה אפשרית (probable manual match):** רק כשלפחות צד אחד הוא
`manual_entry`; אותו ticker/type/date, ולקנייה/מכירה — כמות **וגם** מחיר
מסכימים אחרי עיגול-חצי-למעלה על ספרות עשרוניות (לא float) לדיוק
**הגס** מבין שני הערכים (`20.65` ↔ `20.6521` מתאימים; `20.6521` ↔
`20.6522` לא; `20.65` ↔ `20.655` לא) — `amount` לא נבדק כי עמלה שנכללת
בסכום מ-CSV משנה אותו בלגיטימיות; לסוגים בלי כמות (dividend/fee/…) —
`amount` באותו כלל. מועמדת אחת ייחודית → `probable_manual_match`; יותר
מאחת, או מועמדת שמשותפת לכמה שורות נכנסות → `ambiguous`. שני המצבים
**דורשים הכרעה מפורשת** (`same` + id המועמדת שנבחרה / `separate`). כל
הכרעה **קשורה לזהות השורה** שהוצגה בתצוגה המקדימה (`identityKey`, לא רק
`clientRowKey` המיקומי): אם השורה באותו מיקום השתנתה (קובץ אחר, טופס
שנערך) ההכרעה לא עוברת אליה. `same` לשורה שכבר לא מועמדת, הכרעה לשורה
שכבר לא דורשת אותה, הכרעה שזהותה לא תואמת את השורה הטרייה, או שתי שורות
שטוענות לאותה קיימת → `ReconciliationError` (stale/invalid), הייבוא כולו
נדחה. **חוזה התאריך:** הזהות משתמשת ב-timestamp המדויק כפי שה-parser
מייצר אותו; קובץ הברוקר הנתמך (זה שיובא בפועל: 153/153 שורות ב-00:00:00Z)
הוא בפורמט תאריך-בלבד ISO (`YYYY-MM-DD` → חצות UTC, כמו `<input
type=date>` בהזנה ידנית). קובץ באותו מקור ובאותו פורמט מתאים בדיוק; פורמט
תאריך אחר (`MM/DD/YYYY`, תאריך+שעה) היה מתפרש לפי אזור הזמן של השרת
ומייצר timestamps אחרים — כלומר "חדש" ולא "כפול" — סיכון מתועד, לא
מנורמל (החלטת Product נפרדת). ערכים מחוץ לטווח `toFixed` (|x| ≥ 1e21)
נכשלים בקול, לא מושווים. CSV: `exact_duplicate` מדולג תמיד, בלי אפשרות override. הזנה
ידנית: `exact_duplicate` (מול קיימת **או** מול שורה קודמת באותו טופס)
דורש הכרעה — `separate` = "זהה בכוונה, שמור", `same` = דלג. שורות קיימות
לעולם לא נמחקות/ממוזגות/מוחלפות ב-V1.

**`tax_refund` (Import Blockers V1, 2026-09-23):** זיכוי מס מהברוקר — תנועת
מזומן נכנסת (`CASH_DIRECTION = +1`), בלי ticker/כמות/מחיר, `amount` חובה;
ב-`computePositions()` היא מזומן בלבד (כמו deposit), לא episode, ובהתאמה
(reconciliation) היא תנועת מזומן רגילה (זהות `(""|tax_refund|date|||amount)`).
**חיובי מס** היסטוריים נשארים `fee` — הוחלט במפורש לא לסווג מחדש; ה-enum
תוסף בלבד (`0012`; Postgres לא מוחק ערכי enum).

**CorporateAction** (Import Blockers V1, 2026-09-23; טבלה `corporate_actions`)
— `id, investor_id, ticker, kind(stock_split), effective_date, ratio_numerator,
ratio_denominator, source(issuer_disclosure|broker_statement|user_declared),
evidence(text, חובה — ציטוט המקור), created_at`. **Immutable** (repository
insert-only, §10); `CHECK (numerator > 0 AND denominator > 0)`;
`UNIQUE (investor_id, ticker, effective_date)`. פיצול הפוך = numerator <
denominator. **רק** פיצולים: לא מיזוגים/ספין-אוף/שינוי סימול, לא זיהוי
אוטומטי ולא שליפה מספק. **הכלל הדטרמיניסטי (קפוא):** `effective_date` =
היום הראשון שבו הכמויות מבוטאות ביחידות שאחרי הפיצול (date-only, 00:00Z כמו
`transaction_date`). `computePositions(transactions, openingStates,
asOfDate?, corporateActions)` מיישם את היחס לפי סדר קבוע באותו תאריך: (1)
הפעולה, (2) opening state, (3) עסקאות — עסקה **בתאריך התחילה** כבר ביחידות
שאחרי הפיצול; opening state **לפני** התאריך מוכפל; opening state **בתאריך או
אחריו** הוא דיווח-עצמי כבר ביחידות החדשות ולא מוכפל שוב. הכמות המוחזקת
מוכפלת ב-numerator/denominator, **סך עלות הבסיס לא משתנה** (עלות ממוצעת
למניה מתחלקת), `sellTrace`/`sufficientHoldings` נגזרים מהכמות המותאמת;
הפעולה נספרת אם ורק אם `effective_date <= asOfDate` (אותו כלל cutoff) —
חישוב point-in-time משחזר בדיוק את מה שהיה נכון באותו תאריך; snapshots
היסטוריים קפואים לעולם לא מחושבים מחדש. `deriveEpisodeKeys()` מקבל את אותו
ציר-זמן ומכפיל את `ceiling`/`exactKnown` באותה נקודה — כלל ה-episode לא
משתנה (Decision Independence קפוא), רק oversell שהפיצול מסביר הופך לסגירה
מדויקת. נטען פעם אחת ב-`computePositionsForInvestor()` (ה-wrapper היחיד)
ולכן Journal/DI/Decision/Review/Portfolio Fit/תצוגת הייבוא רואים אותו;
בחירת העסקאות לראיון (`selectInterestingTransactions`, שקוראת ל-`computePositions()`
ישירות) מקבלת את אותן פעולות מ-`interview.start` — פער שנמצא ותוקן ב-final
review של היחידה (בלעדיו מכירה אחרי פיצול הושמטה מהראיון או סווגה כהפסד).
עסקאות BUY/SELL מקוריות לעולם לא נערכות; אין "BUY מזויף".

**PortfolioOpeningState** — `id, investor_id, ticker, quantity,
cost_basis_per_share?, cost_basis_confidence(known|approximate|unknown),
as_of_date, created_at, updated_at`. Mutable-לתיקון, מסומן UI כ-self-reported.

**ImportBatch** — `id, investor_id, filename, uploaded_at, row_count,
status`. מאז History Refresh V1 נוצר **בתוך אותה טרנזקציה** עם השורות
שלו (`confirmTransactionsWithOrdering`, אופציית `importBatch`), ולכן
ייבוא שנדחה (reconciliation/ordering) לא משאיר batch יתום, ו-`row_count`
= מספר השורות שנוספו בפועל אחרי reconciliation — 0 לקובץ שכבר יובא
במלואו (עדיין נרשם: עקבות לכך שהקובץ נבדק). סיכום ה-reconciliation עצמו
(דולגו/אותה-עסקה/נפרדות) מוחזר בתשובת ה-confirm ולא נשמר — ניתן לשחזור
דטרמיניסטי מהנתונים; שמירה קבועה שלו תדרוש שינוי סכימה (לא בוצע).

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
status, origin(guided_interview|user_initiated)`. `origin` נוסף
ב-Manual Historical Entry task (2026-09-08, ר' `docs/backlog.md`):
`guided_interview` = הראיון האלגוריתמי הרגיל (`selectInterestingTransactions`
+ AI question); `user_initiated` = "Tell me why" — המשקיע יזם תיעוד
רציונל על episode ספציפי (**עודכן 2026-09-22, Episode Journal V1:** כל
buy/sell עם ticker בבעלותו, מכל source — לא רק הזנה ידנית; ר'
`docs/architecture.md` §2.2). Traceability בלבד — לא משפיע על Evidence
Strength/weighting.

**Episode (נגזר, לא טבלה — Episode Journal V1):** אין ישות Episode ואין FK
אליו. `src/lib/portfolio/episodes.ts` מקבץ את
`computePositions().episodeKeyByTransactionId` (המפה היחידה שמגדירה episode,
ר' §6) ל-`JournalEpisode`: ticker, מספר, פתוח/סגור (הפוזיציה מוחזקת עכשיו
וזה ה-episode האחרון של ה-ticker), העסקאות, **anchor** = קניית הכניסה
(תאריך → `intra_day_order` → id; `null` = אין קנייה → אין "Tell me why"),
עובדות מאוחרות מ-`sellTrace` בלבד (לא מחושבות מחדש), ו-**כיסוי רציונל**:
episode מכוסה כשלפחות תשובה **אפקטיבית** אחת (פלט `getAllAnswersForInvestor`,
ללא superseded) מעוגנת לאחת מעסקאותיו — כמה תשובות לאותו episode = episode
מכוסה אחד. הכול מחושב בכל קריאה, לא נשמר.

**InterviewAnswer** — `id, interview_session_id, transaction_id?,
question_text(AI עבור guided_interview, דטרמיניסטי-בקוד עבור
user_initiated), answer_text(משתמש), supersedes_answer_id?, created_at`.
Append-only. `transaction_id` נשאר עמודה יחידה (לא junction/מערך) גם
אחרי Manual Historical Entry — `answer_text` הוא טקסט חופשי לא-מוגבל,
יכול לתאר lifecycle שלם שחוצה כמה transactions (למשל BUY+SELL+SELL)
תחת anchor transaction יחיד, בלי אכיפה מבנית שהתוכן מוגבל אליו. **ב-Episode
Journal ה-anchor הוא תמיד קניית הכניסה של ה-episode** (ר' Episode למעלה).
**`supersedes_answer_id` — חוזה (מיושם ב-`interview.answer`, 2026-09-22):**
עדכון רציונל = שורה חדשה שמצביעה על הקודמת; הקודמת חייבת להיות של אותו
משקיע ועדיין ללא יורש (שרשרת, לא fork) — נבדק **תחת נעילת שורה** (`SELECT …
FOR UPDATE` על התשובה הקודמת, בטרנזקציה אחת עם ה-insert,
`insertSupersedingInterviewAnswer`): אין UNIQUE על `supersedes_answer_id`
בסכמה, ובלי הנעילה שני עדכונים מקבילים לאותה תשובה יצרו fork (שוחזר בפועל
8/8 בסקירה, 2026-09-22); `getAllAnswersForInvestor` מחזיר רק
את ראש השרשרת, כך ש-DNA/Strategy/כיסוי רואים תשובה אחת נוכחית לכל שרשרת.
`question_text` של Episode Journal נושא רק עובדות מזמן הכניסה (הגנת hindsight).

---

## 10. אכיפת Immutability — סיכום קונקרטי

- **אין UPDATE/DELETE בכלל** (repository layer חושף רק `insert`):
  `DecisionSnapshot`, `DecisionReview`, `ReviewDimension`, `Thesis`,
  `LaterContext`, `Evidence`, `DNAHypothesisVersion`,
  `StrategyPrincipleVersion`, `StrategyVersion`, `LearningInsightVersion`,
  `InterviewAnswer`, `DNAEvidenceGroundingCheck`, `StrategyEvidenceGroundingCheck`,
  `TransactionLinkFact`, `TransactionLinkFactMember`, `CorporateAction`.
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
   לא-מתוכנן. **חוזק בפועל ל-`UNIQUE(investment_case_id)` על `decisions`**
   אחרי שכפל אמיתי (double-submit) נמצא במקום אחר לגמרי (Strategy) —
   בלי האילוץ הזה, אותו סוג race יכול לייצר שני `DecisionSnapshot`
   בלתי-הפיכים לאותו Case; זו הכללה הכרחית, לא רק "ניקיון".
