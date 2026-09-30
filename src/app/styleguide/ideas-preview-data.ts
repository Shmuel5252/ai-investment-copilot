import { loaded, type Loadable } from "@/components/home/types";
import type { CaseRow, IdeaRow } from "@/components/ideas/ideas-view";

// SYNTHETIC data for the /styleguide Ideas preview and the Ideas render
// tests. Invented tickers and words; nothing here comes from the investor's
// notes. Dates are ISO strings, newest first, as ideas.list returns them.

export type IdeasPreviewState = "mixed" | "empty" | "promoted";
export const IDEAS_PREVIEW_STATES: readonly IdeasPreviewState[] = ["mixed", "empty", "promoted"];

const IDEAS: IdeaRow[] = [
  { id: "idea-4", ticker: "QRST", noteText: "טקסט דוגמה: שמתי לב שהחברה הזו מופיעה שוב ושוב בדוחות של ספקים אחרים.", createdAt: "2026-09-27T19:10:00.000Z", promotedToCaseId: null },
  {
    id: "idea-3",
    ticker: "EFGH",
    noteText: "טקסט דוגמה ארוך יותר: שיחה עם חבר שעובד בתחום העלתה שאלה על מבנה העלויות. לא בדקתי כלום עדיין, רק רוצה לזכור למה זה עניין אותי ומה הייתי רוצה לבדוק אם אחזור לזה.",
    createdAt: "2026-09-20T08:00:00.000Z",
    promotedToCaseId: null,
  },
  { id: "idea-2", ticker: "ABCD", noteText: "טקסט דוגמה: ירידה חדה אחרי הדוח, ורציתי להבין אם משהו השתנה בעסק עצמו.", createdAt: "2026-09-10T12:00:00.000Z", promotedToCaseId: "case-2" },
  { id: "idea-1", ticker: "IJKL", noteText: "טקסט דוגמה: מוצר חדש שהתחלתי להשתמש בו בעצמי.", createdAt: "2026-08-30T12:00:00.000Z", promotedToCaseId: "case-1" },
];

const CASES: CaseRow[] = [
  { id: "case-3", ticker: "EFGH", status: "decided", createdAt: "2026-09-05T10:00:00.000Z" },
  { id: "case-2", ticker: "ABCD", status: "researching", createdAt: "2026-09-12T09:00:00.000Z" },
  { id: "case-1", ticker: "IJKL", status: "decided", createdAt: "2026-09-01T09:00:00.000Z" },
];

export function ideasPreviewData(state: IdeasPreviewState): { ideas: Loadable<IdeaRow[]>; cases: Loadable<CaseRow[]> } {
  if (state === "empty") return { ideas: loaded([]), cases: loaded([]) };
  if (state === "promoted") return { ideas: loaded(IDEAS.filter((i) => i.promotedToCaseId !== null)), cases: loaded(CASES) };
  return { ideas: loaded(IDEAS), cases: loaded(CASES) };
}
