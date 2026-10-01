import type { InterviewActions, InterviewSession } from "@/components/interview/interview-view";

// SYNTHETIC data for the /styleguide Interview preview and the Interview
// render tests. Invented tickers, dates, quantities and wording; nothing here
// comes from the investor's records, and nothing here calls an AI. The facts
// lines follow the shape the backend renders from exposed point-in-time facts.

export type InterviewPreviewState = "orientation" | "no-history" | "no-eligible" | "start-failed" | "active" | "restart" | "long" | "complete-failed";
export const INTERVIEW_PREVIEW_STATES: readonly InterviewPreviewState[] = ["orientation", "no-history", "no-eligible", "start-failed", "active", "restart", "long", "complete-failed"];

const HASH = (c: string) => c.repeat(64);

export const PREVIEW_SESSION: InterviewSession = {
  sessionId: "session-preview",
  questions: [
    {
      anchor: { transactionId: "t-1", ticker: "MNOP", date: "2026-02-03", role: "initial_buy" },
      factsLine: "קנייה של 200 מניות MNOP ב-03/02/2026, במחיר $8.05 למניה. לפני הקנייה לא הוחזקו מניות MNOP.",
      questionText: "טקסט דוגמה: מה גרם לך לבחור ב-MNOP דווקא אז, ומה היה הרעיון שלך באותו רגע?",
      questionSource: "ai",
      anchorContextHash: HASH("a"),
    },
    {
      anchor: { transactionId: "t-2", ticker: "WXYZ", date: "2026-04-14", role: "partial_sell" },
      factsLine: "מכירה של 120 מתוך 300 מניות WXYZ, ב-14/04/2026. לפני הפעולה הוחזקו 300 מניות בעלות ממוצעת של $7.67 למניה, מאז 11/02/2026 (62 ימים).",
      questionText: "ב-14/04/2026 מכרת 120 מתוך 300 מניות WXYZ. מה גרם לך למכור חלק מהפוזיציה דווקא אז?",
      questionSource: "deterministic",
      anchorContextHash: HASH("b"),
    },
    {
      anchor: { transactionId: "t-3", ticker: "QRST", date: "2026-05-20", role: "add_buy" },
      factsLine: "קנייה של 50 מניות QRST ב-20/05/2026, במחיר $131.40 למניה. לפני הפעולה הוחזקו 100 מניות בעלות ממוצעת של $120.10 למניה (משוערת), מאז 02/03/2026 (79 ימים).",
      questionText: "ב-20/05/2026 הוספת 50 מניות QRST לפוזיציה של 100 מניות. מה גרם לך להגדיל את הפוזיציה דווקא אז?",
      questionSource: "deterministic",
      anchorContextHash: HASH("c"),
    },
    {
      anchor: { transactionId: "t-4", ticker: "ABCD", date: "2026-06-30", role: "full_sell" },
      factsLine: "מכירה של כל 40 מניות ABCD שהוחזקו, ב-30/06/2026. לפני הפעולה הוחזקו 40 מניות בעלות ממוצעת של $19.75 למניה, מאז 10/02/2026 (140 ימים).",
      questionText: "ב-30/06/2026 מכרת את כל 40 מניות ABCD שהחזקת. מה הוביל אותך לצאת מהפוזיציה באותו רגע?",
      questionSource: "deterministic",
      anchorContextHash: HASH("d"),
    },
  ],
};

export const LONG_SESSION: InterviewSession = {
  sessionId: "session-long",
  questions: [
    {
      anchor: { transactionId: "t-9", ticker: "LONGX", date: "2026-07-07", role: "add_buy" },
      factsLine:
        "קנייה של 12.5 מניות LONGX ב-07/07/2026, במחיר $1314.25 למניה. לפני הפעולה הוחזקו 1250.75 מניות בעלות ממוצעת של $1288.40 למניה (משוערת), מאז 15/01/2026 (173 ימים).",
      questionText:
        "טקסט דוגמה ארוך: ב-07/07/2026 הוספת 12.5 מניות LONGX לפוזיציה של 1250.75 מניות שהחזקת מאז ינואר. מה בדיוק שקלת באותו רגע, מה היה הרעיון שעמד מאחורי ההחלטה להגדיל דווקא אז ולא קודם או מאוחר יותר, ואילו סימנים חיפשת כדי לדעת אם הרעיון מתממש?",
      questionSource: "ai",
      anchorContextHash: HASH("e"),
    },
  ],
};

const restartError = () => Object.assign(new Error("The history behind this question changed, or it can no longer be asked as of that moment — start again to get a current question."), { data: { code: "BAD_REQUEST" } });

export function interviewPreviewActions(state: InterviewPreviewState): InterviewActions {
  return {
    start: async () => {
      if (state === "no-eligible") throw Object.assign(new Error("No trade in the history can be asked about yet"), { data: { code: "BAD_REQUEST" } });
      if (state === "start-failed") throw Object.assign(new Error("Sample transport failure"), { data: { code: "INTERNAL_SERVER_ERROR" } });
      return state === "long" ? LONG_SESSION : PREVIEW_SESSION;
    },
    answer: async () => {
      if (state === "restart") throw restartError();
    },
    complete: async () => {
      if (state === "complete-failed") throw Object.assign(new Error("Sample completion failure"), { data: { code: "INTERNAL_SERVER_ERROR" } });
    },
  };
}

export const previewHistoryCount = (state: InterviewPreviewState) => (state === "no-history" ? 0 : 142);
