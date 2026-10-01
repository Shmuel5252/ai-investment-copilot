// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { JournalView, partitionEpisodes } from "@/components/journal/journal-view";
import type { RationaleActions, TellMeWhySession } from "@/components/journal/rationale-writer";
import { journalPreviewData, JOURNAL_PREVIEW_SESSION, type JournalPreviewState } from "@/app/styleguide/journal-preview-data";
import { actionRoleLabel, journalPage as t, questionProvenanceLabel } from "@/lib/i18n/strings";

// Frontend V1 unit 7A — the Journal, rendered with the production component
// on the same synthetic data the /styleguide preview uses. No procedure, no
// AI and no database are involved.

function actions(over: Partial<RationaleActions> = {}) {
  return {
    start: vi.fn(async (): Promise<TellMeWhySession> => JOURNAL_PREVIEW_SESSION),
    save: vi.fn(async () => undefined),
    ...over,
  };
}
function renderJournal(state: JournalPreviewState = "main", a = actions()) {
  const view = render(<JournalView journal={journalPreviewData(state)} actions={a} />);
  return { a, ...view };
}
const region = (id: string) => document.getElementById(id) as HTMLElement;
const rows = (id: string) => Array.from(region(id).querySelector("ul")!.children) as HTMLElement[];
const rowOf = (id: string, ticker: string) => rows(id).find((r) => r.textContent?.includes(ticker)) as HTMLElement;

describe("the projection", () => {
  it("is two lists split only by rationale status, each keeping the server's order", () => {
    const input = [
      { id: 1, rationale: { status: "unanswered" as const } },
      { id: 2, rationale: { status: "answered" as const } },
      { id: 3, rationale: { status: "unanswered" as const } },
      { id: 4, rationale: { status: "answered" as const } },
    ];
    const { unanswered, answered } = partitionEpisodes(input as never[]) as unknown as { unanswered: typeof input; answered: typeof input };
    expect(unanswered.map((e) => e.id)).toEqual([1, 3]);
    expect(answered.map((e) => e.id)).toEqual([2, 4]);
  });

  it("renders each episode by ticker and ordinal, in the returned order, never by its derived key", () => {
    renderJournal();
    expect(rows("unanswered").map((r) => r.textContent?.match(/[A-Z]{4}/)?.[0])).toEqual(["QRST", "MNOP", "HIJK"]);
    expect(rows("answered").map((r) => r.textContent?.match(/[A-Z]{4}/)?.[0])).toEqual(["WXYZ", "DEFG", "ABCD"]);
    expect(document.body.textContent).not.toMatch(/[A-Z]{4}#\d/);
  });

  it("states coverage as a sentence, not a score, bar or percentage", () => {
    renderJournal();
    expect(document.body.textContent).toContain(t.coveragePrefix);
    expect(document.querySelector("progress, [role=progressbar], [role=meter]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/ציון|score|\d+%\s*(כוסו|מתועד)/);
  });
});

describe("an unanswered episode", () => {
  it("shows entry-time facts only: no later facts, realized P&L, holding days, status or trade counts", () => {
    renderJournal();
    for (const row of rows("unanswered")) {
      const text = row.textContent ?? "";
      expect(text).not.toContain(t.laterSummary);
      expect(text).not.toContain("%");
      for (const later of [t.holdingDaysLabel, t.exitLabel, t.statusLabel, t.statusOpen, t.statusClosed, t.tradesLabel, t.sellsSuffix]) expect(text).not.toContain(later);
    }
    expect(rowOf("unanswered", "MNOP").textContent).toContain("$8.05");
  });

  it("offers the write action, or says why it cannot, when there is no entry buy", () => {
    renderJournal();
    expect(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton })).toBeTruthy();
    expect(within(rowOf("unanswered", "HIJK")).queryByRole("button")).toBeNull();
    expect(rowOf("unanswered", "HIJK").textContent).toContain(t.notAnchorable);
  });
});

describe("the tell-me-why writer", () => {
  it("opens with the fixed question verbatim, labelled as code-built, not AI, and not evidence", async () => {
    const { a } = renderJournal();
    fireEvent.click(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton }));
    await waitFor(() => expect(screen.getByText(JOURNAL_PREVIEW_SESSION.questionText)).toBeTruthy());
    expect(a.start).toHaveBeenCalledWith("buy-m1");
    const row = rowOf("unanswered", "MNOP");
    expect(row.textContent).toContain(t.questionProvenance);
    expect(row.textContent).toContain(t.hindsightNote);
    expect(t.questionProvenance).toContain("לא נכתבה על ידי AI");
    expect(row.textContent).not.toMatch(/נוצרה על ידי AI|AI-generated/);
  });

  it("says the answer may become a source, never that it is evidence or changes DNA", () => {
    expect(t.saveNote).toContain("עשויה לשמש בהמשך כמקור כאשר המערכת בוחנת דפוסים ועקרונות");
    const all = Object.values(t).join(" ");
    for (const claim of ["תשפיע על ה-DNA", "משפיע על ה-DNA", "משפיעה על ה-DNA", "הופכת לראיה", "תילקח בחשבון"]) expect(all, claim).not.toContain(claim);
  });

  it("saves the text exactly as typed, once, even on a double click", async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    renderJournal("main", actions({ save }));
    fireEvent.click(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton }));
    const box = (await screen.findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "  מילים שלי\nשורה שנייה  " } });
    const button = screen.getByRole("button", { name: t.saveButton });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ session: JOURNAL_PREVIEW_SESSION, answerText: "  מילים שלי\nשורה שנייה  ", supersedesAnswerId: undefined });
    await waitFor(() => expect(screen.getByRole("button", { name: t.savingButton })).toBeTruthy());
    await act(async () => finish());
  });

  it("on a failed save: shows the failure, keeps the typed text, and asks the server again (current facts) only when reopened", async () => {
    const { a } = renderJournal("main", actions({ save: vi.fn(async () => Promise.reject(new Error("The history behind this question changed"))) }));
    const row = () => rowOf("unanswered", "MNOP");
    fireEvent.click(within(row()).getByRole("button", { name: t.writeButton }));
    fireEvent.change(await within(row()).findByLabelText(new RegExp(t.answerLabel)), { target: { value: "keep me" } });
    fireEvent.click(within(row()).getByRole("button", { name: t.saveButton }));
    await waitFor(() => expect(within(row()).getByRole("alert").textContent).toContain("The history behind this question changed"));
    expect(within(row()).getByRole("alert").textContent).toContain(t.saveFailedTitle);
    expect(a.save).toHaveBeenCalledTimes(1); // nothing retried silently
    expect(a.start).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row()).getByRole("button", { name: t.writeButton }));
    const box = (await within(row()).findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
    expect(a.start).toHaveBeenCalledTimes(2); // a fresh start: the facts and hash are current again
    expect(box.value).toBe("keep me");
  });

  it("shows a start failure on the row and does not open the writer", async () => {
    renderJournal("main", actions({ start: vi.fn(async () => Promise.reject(new Error("No buy"))) }));
    fireEvent.click(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton }));
    await waitFor(() => expect(within(rowOf("unanswered", "MNOP")).getByRole("alert").textContent).toContain("No buy"));
    expect(screen.queryByLabelText(new RegExp(t.answerLabel))).toBeNull();
  });

  it("reuses the opened session after closing, instead of starting another", async () => {
    const { a } = renderJournal();
    const row = () => rowOf("unanswered", "MNOP");
    fireEvent.click(within(row()).getByRole("button", { name: t.writeButton }));
    fireEvent.click(await within(row()).findByRole("button", { name: t.closeButton }));
    fireEvent.click(within(row()).getByRole("button", { name: t.writeButton }));
    await within(row()).findByRole("button", { name: t.saveButton });
    expect(a.start).toHaveBeenCalledTimes(1);
  });
});

describe("an answered episode", () => {
  it("leads with the investor's words verbatim, with the question and the date written", () => {
    renderJournal();
    const row = rowOf("answered", "WXYZ");
    const quote = row.querySelector("blockquote") as HTMLElement;
    expect(quote.textContent).toBe("טקסט דוגמה: נכנסתי כי ציפיתי שהדוח הבא יראה שיפור בשולי הרווח.\nשורה שנייה, כפי שנכתבה.");
    expect(row.textContent).toContain(t.inReplyTo);
    expect(row.textContent).toContain(t.writtenOnPrefix);
    expect(row.textContent).toContain(new Date("2026-09-12T09:00:00.000Z").toLocaleDateString("he-IL"));
    expect(row.textContent).toContain(t.answerProvenance);
  });

  it("keeps English answers in English", () => {
    renderJournal();
    expect(rowOf("answered", "DEFG").textContent).toContain("Sample answer kept in English, exactly as written.");
  });

  it("shows every current answer and says an update replaces only the latest, with no older-version list", () => {
    renderJournal();
    const row = rowOf("answered", "DEFG");
    expect(row.querySelectorAll("blockquote")).toHaveLength(2);
    expect(row.textContent).toContain(t.severalAnswers);
    expect(document.body.textContent).not.toMatch(/גרסה קודמת|היסטוריית תשובות|תשובות קודמות:/);
  });

  it("keeps later facts closed by default, labelled as later, with no success/failure coloring", () => {
    renderJournal();
    const row = rowOf("answered", "WXYZ");
    const details = Array.from(row.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent?.includes(t.laterSummary)) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain(t.laterSummary);
    expect(details.textContent).toContain(t.laterNote);
    expect(details.textContent).toContain("+6.4%");
    expect(details.textContent).toContain("-3.1%");
    expect(details.innerHTML).not.toMatch(/text-(positive|negative)|bg-(positive|negative)|text-green|text-red/);
  });

  it("marks a sell that exceeded known holdings as unreliable", () => {
    renderJournal();
    expect(rowOf("answered", "ABCD").textContent).toContain(t.insufficientHoldingsNote);
  });
});

describe("updating a rationale", () => {
  it("prefills the current answer, explains the append-only rule, and hides later facts while writing", async () => {
    renderJournal();
    const row = () => rowOf("answered", "WXYZ");
    fireEvent.click(within(row()).getByRole("button", { name: t.updateButton }));
    const box = (await within(row()).findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
    expect(box.value).toContain("טקסט דוגמה: נכנסתי");
    expect(row().textContent).toContain("העדכון נשמר כתשובה חדשה; התשובה הקודמת נשארת ברשומה ואינה משמשת עוד כתשובה הנוכחית.");
    expect(row().textContent).toContain(t.updateHindsight);
    expect(row().querySelector("details")).toBeNull();
    // unchanged text cannot be saved as a "new" answer
    expect((within(row()).getByRole("button", { name: t.updateSaveButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a NEW answer that supersedes the current one, leaving the shown original untouched", async () => {
    const { a } = renderJournal();
    const row = () => rowOf("answered", "DEFG");
    fireEvent.click(within(row()).getByRole("button", { name: t.updateButton }));
    const box = (await within(row()).findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "ניסוח מתוקן" } });
    fireEvent.click(within(row()).getByRole("button", { name: t.updateSaveButton }));
    await waitFor(() => expect(a.save).toHaveBeenCalledWith({ session: JOURNAL_PREVIEW_SESSION, answerText: "ניסוח מתוקן", supersedesAnswerId: "ans-d1b" }));
    expect(row().querySelectorAll("blockquote")[1]?.textContent).toBe("טקסט דוגמה: תשובה נוכחית שנייה לאותה פוזיציה.");
  });
});

describe("answers about other actions (unit 7C-F)", () => {
  const actionBlock = (ticker: string, list: "answered" | "unanswered") =>
    Array.from(rowOf(list, ticker).querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent?.includes(t.actionAnswersTitle)) as HTMLDetailsElement;

  it("shows them on an episode with no entry rationale, without counting them as coverage", () => {
    renderJournal();
    const block = actionBlock("MNOP", "unanswered");
    expect(block).toBeTruthy();
    expect(block.open).toBe(false);
    expect(block.textContent).toContain(t.actionAnswersNote);
    // MNOP stays in the unanswered list, and coverage is the entry rationale count only
    expect(rowOf("answered", "MNOP")).toBeUndefined();
    expect(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton })).toBeTruthy();
    expect(region("unanswered").textContent).not.toContain("טקסט דוגמה: נכנסתי");
  });

  it("a legacy answer: the stored side and date, no facts line, the limitation label, the answer as the only quote", () => {
    renderJournal();
    const block = actionBlock("MNOP", "unanswered");
    expect(block.textContent).toContain(t.sideSell);
    expect(block.textContent).not.toContain(t.actionFactsTitle);
    expect(block.textContent).toContain(questionProvenanceLabel.guided_legacy);
    expect(block.textContent).toContain("Sample legacy question, stored in English as it was asked.");
    const quotes = block.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.textContent).toBe("טקסט דוגמה: מכרתי כי הסיבה שבגללה נכנסתי כבר לא הייתה רלוונטית.");
    expect(quotes[0]!.textContent).not.toContain("Sample legacy question");
  });

  it("a point-in-time answer: its role, the frozen facts line and its provenance, apart from the entry rationale", () => {
    renderJournal();
    const row = rowOf("answered", "WXYZ");
    const block = actionBlock("WXYZ", "answered");
    expect(block.textContent).toContain(actionRoleLabel.partial_sell);
    expect(block.textContent).toContain(t.actionFactsTitle);
    expect(block.textContent).toContain("מכירה של 20 מתוך 60 מניות WXYZ");
    expect(block.textContent).toContain(questionProvenanceLabel.guided_pit_ai);
    // the entry rationale's quote is outside the action block, and comes first
    const entryQuote = row.querySelector("blockquote") as HTMLElement;
    expect(block.contains(entryQuote)).toBe(false);
    expect(entryQuote.textContent).toContain("טקסט דוגמה: נכנסתי");
    expect(block.querySelector("blockquote")?.textContent).toBe("טקסט דוגמה: מכרתי חלק כדי להקטין את החשיפה לפני הדוח.");
  });

  it("never renders snapshot or audit data", () => {
    renderJournal();
    expect(document.body.textContent).not.toMatch(/anchor_context|anchorContext|question_provenance|guided_legacy|guided_pit|\{"/);
  });

  it("leave the screen while the entry rationale is written or updated", async () => {
    renderJournal();
    fireEvent.click(within(rowOf("unanswered", "MNOP")).getByRole("button", { name: t.writeButton }));
    await within(rowOf("unanswered", "MNOP")).findByLabelText(new RegExp(t.answerLabel));
    expect(rowOf("unanswered", "MNOP").textContent).not.toContain(t.actionAnswersTitle);
    fireEvent.click(within(rowOf("answered", "WXYZ")).getByRole("button", { name: t.updateButton }));
    await within(rowOf("answered", "WXYZ")).findByLabelText(new RegExp(t.answerLabel));
    expect(rowOf("answered", "WXYZ").textContent).not.toContain(t.actionAnswersTitle);
  });

  it("labels every stored question provenance in Hebrew", () => {
    for (const p of ["guided_legacy", "tell_me_why_legacy", "guided_pit_ai", "guided_pit_fallback", "tell_me_why_pit"]) expect(questionProvenanceLabel[p], p).toMatch(/[א-ת]/);
    expect(questionProvenanceLabel.guided_legacy).toBe("שאלה שנוצרה לפני כלל הזמן־אמת ועשויה להזכיר מידע מאוחר.");
    expect(questionProvenanceLabel.guided_pit_ai).toBe("שאלה שנוסחה מתוך עובדות הזמן־אמת.");
    expect(questionProvenanceLabel.guided_pit_fallback).toBe("שאלה קבועה של המערכת מתוך עובדות הזמן־אמת.");
  });
});

describe("empty and covered states", () => {
  it("with no episodes, says there is nothing to reconstruct and links to /import", () => {
    renderJournal("empty");
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.emptyAction }).getAttribute("href")).toBe("/import");
  });

  it("when every episode has a rationale, says so calmly", () => {
    renderJournal("covered");
    expect(region("unanswered").textContent).toContain(t.noneWaiting);
    for (const word of ["כל הכבוד", "מצוין", "הושלם!", "🎉"]) expect(document.body.textContent).not.toContain(word);
  });
});

describe("copy", () => {
  it("every Journal string is Hebrew", () => {
    for (const [key, value] of Object.entries(t)) expect(value, key).toMatch(/[א-ת]/);
  });
});
