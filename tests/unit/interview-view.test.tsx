// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loaded } from "@/components/home/types";
import { InterviewView, formatAnchorDate, type InterviewActions, type InterviewSession } from "@/components/interview/interview-view";
import { LONG_SESSION, PREVIEW_SESSION } from "@/app/styleguide/interview-preview-data";
import { actionRoleLabel, dnaPage, homePage, interviewPage as t } from "@/lib/i18n/strings";
import { NAV_ITEMS } from "@/components/shell/nav-config";

// Frontend V1 unit 7C-F — the guided interview, rendered with the production
// component on the synthetic session the /styleguide preview uses. Only the
// injected actions are stubbed; no procedure, AI or database is involved.

const RESTART_MESSAGE = "The history behind this question changed, or it can no longer be asked as of that moment — start again to get a current question.";
const trpcError = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });

function actions(over: Partial<Record<keyof InterviewActions, ReturnType<typeof vi.fn>>> = {}, session: InterviewSession = PREVIEW_SESSION) {
  return {
    start: vi.fn(async () => session),
    answer: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    ...over,
  };
}
type Actions = ReturnType<typeof actions>;
function renderInterview(a: Actions = actions(), transactionCount = 142) {
  render(<InterviewView history={loaded({ transactionCount })} actions={a as unknown as InterviewActions} />);
  return a;
}
async function open(a: Actions = actions()) {
  renderInterview(a);
  fireEvent.click(screen.getByRole("button", { name: t.startButton }));
  await screen.findByRole("heading", { level: 2, name: PREVIEW_SESSION.questions[0]!.questionText });
  return a;
}
const box = () => screen.getByLabelText(new RegExp(t.answerLabel)) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const saveButton = () => screen.getByRole("button", { name: new RegExp(`${t.saveNext}|${t.saveFinish}`) }) as HTMLButtonElement;
const questionHeading = (i: number) => screen.findByRole("heading", { level: 2, name: PREVIEW_SESSION.questions[i]!.questionText });
const live = () => document.querySelector("[role=status][aria-live=polite]") as HTMLElement;

describe("orientation", () => {
  it("is titled ראיון מודרך, describes the point-in-time rule and offers one start action, without starting anything", () => {
    const a = renderInterview();
    expect(t.title).toBe("ראיון מודרך");
    expect(screen.getByRole("heading", { level: 1, name: t.title })).toBeTruthy();
    expect(document.body.textContent).toContain(t.description);
    expect(screen.getByRole("button", { name: t.startButton })).toBeTruthy();
    expect(a.start).not.toHaveBeenCalled();
  });

  it("with no history: says so, links to /import and never starts", () => {
    const a = renderInterview(actions(), 0);
    expect(screen.getByText(t.noHistoryTitle)).toBeTruthy();
    expect(document.body.textContent).toContain(t.noHistoryBody);
    expect(screen.getByRole("link", { name: t.importLink }).getAttribute("href")).toBe("/import");
    expect(screen.queryByRole("button", { name: t.startButton })).toBeNull();
    expect(a.start).not.toHaveBeenCalled();
  });

  it("shows a preparing state while the questions are built", async () => {
    let resolve!: (s: InterviewSession) => void;
    renderInterview(actions({ start: vi.fn(() => new Promise<InterviewSession>((r) => (resolve = r))) }));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByText(t.preparing)).toBeTruthy();
    await act(async () => resolve(PREVIEW_SESSION));
    await questionHeading(0);
  });

  it("no eligible action (BAD_REQUEST): a calm explanation that never encourages more trading", async () => {
    renderInterview(actions({ start: vi.fn(async () => Promise.reject(trpcError("No trade in the history can be asked about yet", "BAD_REQUEST"))) }));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByText(t.noEligibleTitle)).toBeTruthy();
    expect(document.body.textContent).toContain(t.noEligibleBody);
    expect(document.body.textContent).not.toMatch(/בצע עסקה|סחור|קנה עוד|עסקאות נוספות/);
    expect(document.body.textContent).not.toContain("No trade in the history");
  });

  it("start failure: says nothing was opened or saved and allows another try", async () => {
    const start = vi.fn().mockRejectedValueOnce(trpcError("boom", "INTERNAL_SERVER_ERROR")).mockResolvedValueOnce(PREVIEW_SESSION);
    renderInterview(actions({ start }));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByText(t.startFailed)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    await questionHeading(0);
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe("start failure message", () => {
  it("shows the server's message (the AI timeout text) under the Hebrew title", async () => {
    const message = "AI call timed out (limit: 5 minutes per attempt, 1 retry); nothing was saved by this step.";
    renderInterview(actions({ start: vi.fn(async () => Promise.reject(trpcError(message, "INTERNAL_SERVER_ERROR"))) }));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByText(t.startFailed)).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("falls back to the Hebrew line alone when the error carries no message", async () => {
    renderInterview(actions({ start: vi.fn(async () => Promise.reject(trpcError("", "INTERNAL_SERVER_ERROR"))) }));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByText(t.startFailed)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(t.startFailed);
  });
});

describe("an active question", () => {
  it("shows progress, the action line with a role label, the facts verbatim, then the question, in that DOM order", async () => {
    await open();
    const q = PREVIEW_SESSION.questions[0]!;
    // searched within the form only: the page description also contains "השאלה"
    const text = box().closest("form")!.textContent!;
    const order = [`${t.progressPrefix} 1 ${t.progressMiddle} 4`, actionRoleLabel.initial_buy!, t.factsTitle, q.factsLine, t.factsProvenance, t.questionLabel, q.questionText, t.aboutQuestion, t.answerLabel, t.saveNext, t.skip, t.skipHelp].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(formatAnchorDate(q.anchor.date)).toBe("03/02/2026");
    expect(text).toContain("03/02/2026");
  });

  it("keeps facts, question and answer semantically apart: a titled facts region, the question as a heading, no quote style", async () => {
    await open();
    const facts = screen.getByRole("region", { name: t.factsTitle });
    expect(facts.textContent).toContain(PREVIEW_SESSION.questions[0]!.factsLine);
    expect(facts.textContent).not.toContain(PREVIEW_SESSION.questions[0]!.questionText);
    expect(document.querySelector("blockquote")).toBeNull();
    expect(facts.contains(box())).toBe(false);
    expect(box().getAttribute("aria-describedby")).toContain(facts.id);
    expect(box().closest("form")).toBeTruthy();
  });

  it("labels each of the four roles in Hebrew and never shows a role key or slot name", async () => {
    expect(actionRoleLabel).toEqual({ initial_buy: "קנייה ראשונה", add_buy: "הוספה לפוזיציה", partial_sell: "מכירה חלקית", full_sell: "מכירת כל הפוזיציה" });
    const a = await open();
    for (let i = 0; i < 4; i++) {
      await questionHeading(i);
      expect(document.body.textContent).toContain(actionRoleLabel[PREVIEW_SESSION.questions[i]!.anchor.role]!);
      expect(document.body.textContent).not.toMatch(/initial_buy|add_buy|partial_sell|full_sell|slot/i);
      if (i < 3) fireEvent.click(screen.getByRole("button", { name: t.skip }));
    }
    expect(PREVIEW_SESSION.questions.map((q) => q.anchor.role).sort()).toEqual(["add_buy", "full_sell", "initial_buy", "partial_sell"]);
    expect(a.answer).not.toHaveBeenCalled();
  });

  it("explains an AI question and a fixed question differently", async () => {
    await open();
    expect(document.body.textContent).toContain(t.sourceAi);
    expect(document.body.textContent).not.toContain(t.sourceDeterministic);
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    await questionHeading(1);
    expect(document.body.textContent).toContain(t.sourceDeterministic);
    expect(document.body.textContent).not.toContain(t.sourceAi);
  });

  it("adds no outcome, percentage or raw snapshot to what the backend sent", async () => {
    await open();
    const text = document.body.textContent!;
    expect(text).not.toMatch(/%|רווח|הפסד|תשואה|P&L|anchor_context|anchorContextHash|\{"/);
    expect(text).not.toContain(PREVIEW_SESSION.questions[0]!.anchorContextHash);
  });

  it("cannot save whitespace; Enter in the answer does not submit", async () => {
    const a = await open();
    expect(saveButton().disabled).toBe(true);
    type("   \n  ");
    expect(saveButton().disabled).toBe(true);
    type("שורה");
    fireEvent.keyDown(box(), { key: "Enter", code: "Enter" });
    expect(a.answer).not.toHaveBeenCalled();
  });

  it("saves exactly what was typed with the question and its hash, then moves on, focuses and announces", async () => {
    const a = await open();
    const text = "  טקסט דוגמה:\nשורה שנייה  ";
    type(text);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(a.answer).toHaveBeenCalledWith({
        sessionId: "session-preview",
        transactionId: "t-1",
        questionText: PREVIEW_SESSION.questions[0]!.questionText,
        answerText: text,
        anchorContextHash: PREVIEW_SESSION.questions[0]!.anchorContextHash,
      })
    );
    const next = await questionHeading(1);
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(box().value).toBe("");
    expect(live().textContent).toBe(`${t.announceSaved} ${t.progressPrefix} 2 ${t.progressMiddle} 4`);
    expect(a.complete).not.toHaveBeenCalled();
  });

  it("a double click saves once", async () => {
    let resolve!: () => void;
    const a = await open(actions({ answer: vi.fn(() => new Promise<void>((r) => (resolve = r))) }));
    type("פעם אחת");
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve());
    await questionHeading(1);
    expect(a.answer).toHaveBeenCalledTimes(1);
  });

  it("skip writes nothing, moves on, focuses the next question and announces it", async () => {
    const a = await open();
    type("טיוטה");
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    const next = await questionHeading(1);
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(live().textContent).toBe(`${t.announceSkipped} ${t.progressPrefix} 2 ${t.progressMiddle} 4`);
    expect(a.answer).not.toHaveBeenCalled();
  });
});

describe("finishing", () => {
  async function toLast(a: Actions) {
    await open(a);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: t.skip }));
      await questionHeading(i + 1);
    }
  }

  it("the last save answers, then completes, then shows the counts with focus on the heading", async () => {
    const a = actions();
    await toLast(a);
    expect(saveButton().textContent).toContain(t.saveFinish);
    type("אחרונה");
    fireEvent.click(saveButton());
    const done = await screen.findByRole("heading", { name: t.doneTitle });
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledWith("session-preview");
    expect(screen.queryByRole("heading", { name: t.unconfirmedSavedTitle })).toBeNull();
    expect(a.answer.mock.invocationCallOrder[0]!).toBeLessThan(a.complete.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(document.activeElement).toBe(done));
    expect(document.body.textContent).toContain(`${t.doneSavedPrefix} 1 ${t.doneSavedMiddle} 4 ${t.doneSavedSuffix} · 3 ${t.doneSkippedSuffix}`);
  });

  it("the last skip completes without any write", async () => {
    const a = actions();
    await toLast(a);
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    await screen.findByRole("heading", { name: t.doneTitle });
    expect(a.answer).not.toHaveBeenCalled();
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(`${t.doneSavedPrefix} 0 ${t.doneSavedMiddle} 4`);
  });

  it("last answer saved but complete fails: a partial-success state, never resent, never retried, never shown as completed", async () => {
    const a = actions({ complete: vi.fn(async () => Promise.reject(new Error("complete failed"))) });
    await toLast(a);
    type("אחרונה");
    fireEvent.click(saveButton());
    const heading = await screen.findByRole("heading", { name: t.unconfirmedSavedTitle });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole("heading", { name: t.doneTitle })).toBeNull();
    expect(document.body.textContent).not.toContain(t.doneBody);
    expect(document.body.textContent).toContain(t.unconfirmedSavedBody);
    expect(t.unconfirmedSavedBody).toContain("התשובה האחרונה נשמרה");
    expect(t.unconfirmedSavedBody).toContain("אין צורך לשלוח את התשובה שוב");
    // saved count includes the final answer; skipped stays accurate
    expect(document.body.textContent).toContain(`${t.unconfirmedCountsPrefix} 1 ${t.unconfirmedCountsSaved} · 3 ${t.doneSkippedSuffix}`);
    // nothing on the screen can resend the answer
    expect(screen.queryByLabelText(new RegExp(t.answerLabel))).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`${t.saveNext}|${t.saveFinish}|${t.startButton}`) })).toBeNull();
    expect(screen.getByRole("link", { name: t.toJournal }).getAttribute("href")).toBe("/journal");
    await new Promise((r) => setTimeout(r, 30));
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("while complete is pending, the last question cannot save or skip again", async () => {
    let reject!: (e: Error) => void;
    const a = actions({ complete: vi.fn(() => new Promise<void>((_, r) => (reject = r))) });
    await toLast(a);
    type("אחרונה");
    fireEvent.click(saveButton());
    await waitFor(() => expect(a.complete).toHaveBeenCalledTimes(1));
    const skipButton = screen.getByRole("button", { name: t.skip }) as HTMLButtonElement;
    expect(skipButton.disabled).toBe(true);
    fireEvent.click(skipButton);
    type("טקסט חדש");
    fireEvent.submit(box().closest("form")!);
    await act(async () => reject(new Error("complete failed")));
    await screen.findByRole("heading", { name: t.unconfirmedSavedTitle });
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(`${t.unconfirmedCountsPrefix} 1 ${t.unconfirmedCountsSaved} · 3 ${t.doneSkippedSuffix}`);
  });

  it("the partial-success state survives rerenders and state updates without another mutation", async () => {
    const a = actions({ complete: vi.fn(async () => Promise.reject(new Error("complete failed"))) });
    const { rerender } = render(<InterviewView history={loaded({ transactionCount: 142 })} actions={a as unknown as InterviewActions} />);
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    for (let i = 0; i < 3; i++) {
      await questionHeading(i);
      fireEvent.click(screen.getByRole("button", { name: t.skip }));
    }
    await questionHeading(3);
    type("אחרונה");
    fireEvent.click(saveButton());
    await screen.findByRole("heading", { name: t.unconfirmedSavedTitle });
    for (let n = 0; n < 3; n++) rerender(<InterviewView history={loaded({ transactionCount: 143 + n })} actions={{ ...(a as unknown as InterviewActions) }} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("heading", { name: t.unconfirmedSavedTitle })).toBeTruthy();
    expect(a.start).toHaveBeenCalledTimes(1);
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("last skip with a failed complete: says completion was not confirmed, never that an answer was saved", async () => {
    const a = actions({ complete: vi.fn(async () => Promise.reject(new Error("complete failed"))) });
    await toLast(a);
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    await screen.findByRole("heading", { name: t.unconfirmedSkippedTitle });
    expect(document.body.textContent).toContain(t.unconfirmedSkippedBody);
    expect(document.body.textContent).not.toContain("התשובה האחרונה נשמרה");
    expect(screen.queryByRole("heading", { name: t.unconfirmedSavedTitle })).toBeNull();
    expect(screen.queryByRole("heading", { name: t.doneTitle })).toBeNull();
    expect(document.body.textContent).toContain(`${t.unconfirmedCountsPrefix} 0 ${t.unconfirmedCountsSaved} · 4 ${t.doneSkippedSuffix}`);
    expect(a.answer).not.toHaveBeenCalled();
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("back to the interview from the partial-success state sends nothing until start is pressed", async () => {
    const a = actions({ complete: vi.fn(async () => Promise.reject(new Error("complete failed"))) });
    await toLast(a);
    type("אחרונה");
    fireEvent.click(saveButton());
    fireEvent.click(await screen.findByRole("button", { name: t.backToInterview }));
    expect(await screen.findByRole("button", { name: t.startButton })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(a.start).toHaveBeenCalledTimes(1);
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it("completion links to the Journal and DNA, claims nothing generated, and offers no further interview", async () => {
    const a = actions();
    await toLast(a);
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    await screen.findByRole("heading", { name: t.doneTitle });
    expect(document.body.textContent).toContain(t.doneBody);
    expect(screen.getByRole("link", { name: t.toJournal }).getAttribute("href")).toBe("/journal");
    expect(screen.getByRole("link", { name: t.toDna }).getAttribute("href")).toBe("/dna");
    expect(document.body.textContent).not.toContain("ראיון נוסף");
    expect(screen.queryByRole("button", { name: t.startButton })).toBeNull();
  });
});

describe("failures while answering", () => {
  it("a changed context keeps the text, explains, focuses the notice, and restarts as a NEW session answered from then on", async () => {
    const fresh: InterviewSession = { ...PREVIEW_SESSION, sessionId: "session-fresh" };
    const start = vi.fn().mockResolvedValueOnce(PREVIEW_SESSION).mockResolvedValueOnce(fresh);
    const answer = vi.fn().mockRejectedValueOnce(trpcError(RESTART_MESSAGE, "BAD_REQUEST")).mockResolvedValue(undefined);
    await open(actions({ start, answer }));
    type("המילים שלי");
    fireEvent.click(saveButton());
    expect(await screen.findByText(t.restartRequired)).toBeTruthy();
    expect(box().value).toBe("המילים שלי");
    expect(saveButton().disabled).toBe(true);
    await waitFor(() => expect(document.activeElement?.contains(screen.getByText(t.restartRequired))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: t.restartButton }));
    await questionHeading(0);
    expect(start).toHaveBeenCalledTimes(2);
    // the earlier text stays visible, but is not silently attached to the new question
    expect(box().value).toBe("");
    expect(screen.getByText(t.previousDraft)).toBeTruthy();
    expect(document.body.textContent).toContain("המילים שלי");
    type("חדש");
    fireEvent.click(saveButton());
    await questionHeading(1);
    expect(answer).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "session-fresh", answerText: "חדש" }));
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it("another BAD_REQUEST shows the server's reason and keeps the text", async () => {
    await open(actions({ answer: vi.fn(async () => Promise.reject(trpcError("Answer text is required", "BAD_REQUEST"))) }));
    type("טקסט");
    fireEvent.click(saveButton());
    expect(await screen.findByText(t.refusedTitle)).toBeTruthy();
    expect(document.body.textContent).toContain("Answer text is required");
    expect(screen.queryByText(t.restartRequired)).toBeNull();
    expect(box().value).toBe("טקסט");
  });

  it("an unconfirmed save warns about a duplicate and never retries by itself", async () => {
    const a = await open(actions({ answer: vi.fn(async () => Promise.reject(trpcError("network", "INTERNAL_SERVER_ERROR"))) }));
    type("טקסט");
    fireEvent.click(saveButton());
    expect(await screen.findByText(t.uncertain)).toBeTruthy();
    expect(box().value).toBe("טקסט");
    await new Promise((r) => setTimeout(r, 20));
    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 2, name: PREVIEW_SESSION.questions[0]!.questionText })).toBeTruthy();
  });
});

describe("long content", () => {
  it("renders a long question and facts line in full", async () => {
    renderInterview(actions({}, LONG_SESSION));
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    expect(await screen.findByRole("heading", { level: 2, name: LONG_SESSION.questions[0]!.questionText })).toBeTruthy();
    expect(document.body.textContent).toContain(LONG_SESSION.questions[0]!.factsLine);
    expect(saveButton().textContent).toContain(t.saveFinish);
  });
});

describe("copy and rename", () => {
  it("every interview string is Hebrew, without outcome vocabulary or a claim that DNA changed", () => {
    for (const [key, value] of Object.entries(t)) expect(value, key).toMatch(/[א-ת]/);
    const all = Object.values(t).join(" ");
    expect(all).not.toMatch(/רווח|הפסד|תשואה|הצלחה|הצליח|ציון|DNA (עודכן|השתנה)|עודכן אוטומטית/);
    expect(all).not.toContain("ראיון פתיחה");
  });

  it("the guided interview is named ראיון מודרך in the navigation, Home and DNA", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/interview")?.label).toBe("ראיון מודרך");
    expect(homePage.openInterview).toBe("לראיון המודרך");
    expect(dnaPage.openInterview).toBe("לראיון המודרך");
  });
});
