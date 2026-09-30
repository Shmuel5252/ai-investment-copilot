import { loaded, type Loadable } from "@/components/home/types";
import type { JournalData, JournalEpisodeRow } from "@/components/journal/journal-view";
import type { TellMeWhySession } from "@/components/journal/rationale-writer";

// SYNTHETIC data for the /styleguide Journal preview and the Journal render
// tests. Invented tickers, wording, ids and dates; nothing here comes from
// the investor's records. Episodes are in the order interview.journal
// returns them: unanswered first, then newest entry first. Unanswered rows
// carry `later: null`, exactly as the server sends them.

export type JournalPreviewState = "main" | "empty" | "covered";
export const JOURNAL_PREVIEW_STATES: readonly JournalPreviewState[] = ["main", "empty", "covered"];

const E = (o: Partial<JournalEpisodeRow> & Pick<JournalEpisodeRow, "key" | "ticker" | "episodeNumber">): JournalEpisodeRow => ({
  status: "closed",
  buyCount: 1,
  sellCount: 1,
  firstDate: "2026-05-04T00:00:00.000Z",
  entry: { transactionId: `buy-${o.key}`, date: "2026-05-04T00:00:00.000Z", quantity: 40, price: 52.1 },
  anchorable: true,
  rationale: { status: "unanswered", answers: [], latestAnswerId: null },
  later: null,
  ...o,
});

const UNANSWERED: JournalEpisodeRow[] = [
  E({ key: "QRST#2", ticker: "QRST", episodeNumber: 2, status: "open", buyCount: 2, sellCount: 0, firstDate: "2026-08-20T00:00:00.000Z", entry: { transactionId: "buy-q2", date: "2026-08-20T00:00:00.000Z", quantity: 12.5, price: 131.4 } }),
  E({ key: "MNOP#1", ticker: "MNOP", episodeNumber: 1, firstDate: "2026-06-11T00:00:00.000Z", entry: { transactionId: "buy-m1", date: "2026-06-11T00:00:00.000Z", quantity: 200, price: 8.05 } }),
  E({ key: "HIJK#1", ticker: "HIJK", episodeNumber: 1, buyCount: 0, firstDate: "2026-01-09T00:00:00.000Z", entry: null, anchorable: false }),
];

const ANSWERED: JournalEpisodeRow[] = [
  E({
    key: "WXYZ#1",
    ticker: "WXYZ",
    episodeNumber: 1,
    buyCount: 2,
    sellCount: 2,
    firstDate: "2026-04-02T00:00:00.000Z",
    entry: { transactionId: "buy-w1", date: "2026-04-02T00:00:00.000Z", quantity: 30, price: 74.2 },
    rationale: {
      status: "answered",
      answers: [
        {
          id: "ans-w1",
          questionText: "טקסט דוגמה: השאלה הקבועה שנשאלה על הכניסה.",
          answerText: "טקסט דוגמה: נכנסתי כי ציפיתי שהדוח הבא יראה שיפור בשולי הרווח.\nשורה שנייה, כפי שנכתבה.",
          createdAt: "2026-09-12T09:00:00.000Z",
        },
      ],
      latestAnswerId: "ans-w1",
    },
    later: {
      exitDate: "2026-07-15T00:00:00.000Z",
      holdingDays: 104,
      sells: [
        { transactionId: "sell-w1a", date: "2026-06-01T00:00:00.000Z", realizedPnlPercent: 6.4, sufficientHoldings: true },
        { transactionId: "sell-w1b", date: "2026-07-15T00:00:00.000Z", realizedPnlPercent: -3.1, sufficientHoldings: true },
      ],
    },
  }),
  E({
    key: "DEFG#1",
    ticker: "DEFG",
    episodeNumber: 1,
    status: "open",
    sellCount: 0,
    firstDate: "2026-03-18T00:00:00.000Z",
    entry: { transactionId: "buy-d1", date: "2026-03-18T00:00:00.000Z", quantity: 15, price: 210 },
    rationale: {
      status: "answered",
      answers: [
        { id: "ans-d1a", questionText: "Sample AI-written question, stored in English as it was asked.", answerText: "Sample answer kept in English, exactly as written.", createdAt: "2026-08-17T10:00:00.000Z" },
        { id: "ans-d1b", questionText: "טקסט דוגמה: שאלה נוספת שנשאלה.", answerText: "טקסט דוגמה: תשובה נוכחית שנייה לאותה פוזיציה.", createdAt: "2026-09-10T10:00:00.000Z" },
      ],
      latestAnswerId: "ans-d1b",
    },
    later: { exitDate: null, holdingDays: null, sells: [] },
  }),
  E({
    key: "ABCD#1",
    ticker: "ABCD",
    episodeNumber: 1,
    firstDate: "2026-02-10T00:00:00.000Z",
    entry: { transactionId: "buy-a1", date: "2026-02-10T00:00:00.000Z", quantity: 100, price: 19.75 },
    rationale: {
      status: "answered",
      answers: [{ id: "ans-a1", questionText: "טקסט דוגמה: השאלה הקבועה.", answerText: "טקסט דוגמה: קניתי לתקופה קצרה סביב אירוע מוגדר.", createdAt: "2026-09-14T08:00:00.000Z" }],
      latestAnswerId: "ans-a1",
    },
    later: {
      exitDate: "2026-02-24T00:00:00.000Z",
      holdingDays: 14,
      sells: [{ transactionId: "sell-a1", date: "2026-02-24T00:00:00.000Z", realizedPnlPercent: -8.2, sufficientHoldings: false }],
    },
  }),
];

export const JOURNAL_PREVIEW_SESSION: TellMeWhySession = {
  sessionId: "session-preview",
  transactionId: "buy-preview",
  questionText: "טקסט דוגמה: פוזיציה MNOP#1, כניסה ב-11/06/2026 (קנייה של 200 מניות במחיר $8.05). ספר לי על ההשקעה שלך ב-MNOP: למה נכנסת?",
};

// The question the preview's writer opens with: the one for the row it was
// opened on, in the shape the server builds it from that row's entry facts.
const PREVIEW_SESSIONS: Record<string, TellMeWhySession> = {
  "buy-m1": JOURNAL_PREVIEW_SESSION,
  "buy-w1": {
    sessionId: "session-preview-w1",
    transactionId: "buy-w1",
    questionText:
      "טקסט דוגמה: פוזיציה WXYZ#1, כניסה ב-02/04/2026 (קנייה של 30 מניות במחיר $74.20). ספר לי על ההשקעה שלך ב-WXYZ: למה נכנסת, איך התנהלת במהלך הפוזיציה, ולמה החלטת לממש חלק ממנה או לצאת ממנה?",
  },
};

export function journalPreviewSession(transactionId: string): TellMeWhySession {
  return PREVIEW_SESSIONS[transactionId] ?? { sessionId: `session-${transactionId}`, transactionId, questionText: "טקסט דוגמה: השאלה הקבועה על הכניסה לפוזיציה הזו." };
}

export function journalPreviewData(state: JournalPreviewState): Loadable<JournalData> {
  if (state === "empty") return loaded({ coverage: { covered: 0, total: 0 }, episodes: [] });
  if (state === "covered") return loaded({ coverage: { covered: ANSWERED.length, total: ANSWERED.length }, episodes: ANSWERED });
  return loaded({ coverage: { covered: ANSWERED.length, total: UNANSWERED.length + ANSWERED.length }, episodes: [...UNANSWERED, ...ANSWERED] });
}
