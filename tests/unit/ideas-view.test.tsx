// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { IdeasView, existingCaseFor, partitionIdeas, type IdeasActions } from "@/components/ideas/ideas-view";
import { ActionError } from "@/components/ui/action-error";
import { loaded } from "@/components/home/types";
import { caseStatusLabel, ideasPage as t, shell } from "@/lib/i18n/strings";
import { ideasPreviewData } from "@/app/styleguide/ideas-preview-data";

// Frontend V1 unit 5 — the ideas notebook, rendered with the production
// component on the same synthetic data the /styleguide preview uses.

function actions(over: Partial<{ create: Partial<IdeasActions["create"]>; promote: Partial<IdeasActions["promote"]> }> = {}) {
  return {
    create: { run: vi.fn(async () => true), pending: false, error: null, ...over.create },
    promote: { run: vi.fn(), pendingIdeaId: null, error: null, ...over.promote },
  } as IdeasActions & { create: { run: ReturnType<typeof vi.fn> }; promote: { run: ReturnType<typeof vi.fn> } };
}
function renderIdeas(state: "mixed" | "empty" | "promoted" = "mixed", a = actions()) {
  const data = ideasPreviewData(state);
  const view = render(<IdeasView ideas={data.ideas} cases={data.cases} actions={a} />);
  return { a, ...view };
}
const region = (id: string) => document.getElementById(id) as HTMLElement;
const rows = (id: string) => within(region(id)).getAllByRole("listitem");

describe("capture form", () => {
  it("stays disabled until both fields have non-whitespace text, then sends the existing create input", async () => {
    const { a } = renderIdeas();
    const save = screen.getByRole("button", { name: t.saveButton }) as HTMLButtonElement;
    const ticker = screen.getByLabelText(new RegExp(t.tickerLabel)) as HTMLInputElement;
    const note = screen.getByLabelText(new RegExp(t.noteLabel)) as HTMLTextAreaElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(ticker, { target: { value: "  " } });
    fireEvent.change(note, { target: { value: "why" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(ticker, { target: { value: "wxyz" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(a.create.run).toHaveBeenCalledWith("wxyz", "why");
    await waitFor(() => expect(ticker.value).toBe(""));
    expect(note.value).toBe("");
  });

  it("keeps the draft when saving fails, and shows the server message", async () => {
    const a = actions({ create: { run: vi.fn(async () => false), error: "Server said no" } });
    renderIdeas("mixed", a);
    const note = screen.getByLabelText(new RegExp(t.noteLabel)) as HTMLTextAreaElement;
    fireEvent.change(screen.getByLabelText(new RegExp(t.tickerLabel)), { target: { value: "wxyz" } });
    fireEvent.change(note, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: t.saveButton }));
    await waitFor(() => expect(a.create.run).toHaveBeenCalled());
    expect(note.value).toBe("keep me");
    expect(screen.getByRole("alert").textContent).toContain("Server said no");
  });
});

describe("the two lifecycle lists", () => {
  it("partition only by promotedToCaseId and keep the returned order in each", () => {
    const input = [
      { id: "a", promotedToCaseId: null },
      { id: "b", promotedToCaseId: "x" },
      { id: "c", promotedToCaseId: null },
      { id: "d", promotedToCaseId: "y" },
    ];
    const { unresearched, researched } = partitionIdeas(input);
    expect(unresearched.map((i) => i.id)).toEqual(["a", "c"]);
    expect(researched.map((i) => i.id)).toEqual(["b", "d"]);
  });

  it("render the note verbatim as the primary text, with the ticker as muted metadata", () => {
    renderIdeas();
    const first = rows("unresearched")[0]!;
    const quote = first.querySelector("blockquote")!;
    expect(quote.textContent).toBe("טקסט דוגמה: שמתי לב שהחברה הזו מופיעה שוב ושוב בדוחות של ספקים אחרים.");
    const meta = within(first).getByText((_, el) => el?.tagName === "P" && el.textContent!.startsWith("QRST"));
    expect(meta.className).toContain("text-muted");
    // the note comes before the ticker in reading order
    expect(first.textContent!.indexOf("טקסט דוגמה")).toBeLessThan(first.textContent!.indexOf("QRST"));
  });

  it("show the rows in the order ideas.list returned them", () => {
    renderIdeas();
    expect(rows("unresearched").map((r) => r.textContent!.match(/[A-Z]{4}/)![0])).toEqual(["QRST", "EFGH"]);
    expect(rows("researched").map((r) => r.textContent!.match(/[A-Z]{4}/)![0])).toEqual(["ABCD", "IJKL"]);
  });

  it("show no price, company, score, age or ranking language", () => {
    const { container } = renderIdeas();
    expect(container.textContent).not.toMatch(/\$|%|Inc\.|ציון|דירוג|עדיפות|ישן|stale/);
  });
});

describe("promotion", () => {
  it("offers the action, with its explanation, only on unpromoted ideas", () => {
    renderIdeas();
    for (const r of rows("unresearched")) {
      expect(within(r).getByRole("button", { name: t.promoteButton })).toBeTruthy();
      expect(within(r).getByText(t.promoteHelp)).toBeTruthy();
    }
    for (const r of rows("researched")) expect(within(r).queryByRole("button", { name: t.promoteButton })).toBeNull();
  });

  it("calls the existing promote with the idea id", () => {
    const { a } = renderIdeas();
    fireEvent.click(within(rows("unresearched")[1]!).getByRole("button", { name: t.promoteButton }));
    expect(a.promote.run).toHaveBeenCalledWith("idea-3");
  });

  it("while one idea is promoting, its button shows pending and the others are disabled", () => {
    renderIdeas("mixed", actions({ promote: { pendingIdeaId: "idea-4" } }));
    const [first, second] = rows("unresearched");
    const pending = within(first!).getByRole("button", { name: t.promotingButton }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((within(second!).getByRole("button", { name: t.promoteButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed promotion shows its message on that idea's row only", () => {
    renderIdeas("mixed", actions({ promote: { error: { ideaId: "idea-3", message: "Idea not found." } } }));
    const [first, second] = rows("unresearched");
    expect(within(first!).queryByRole("alert")).toBeNull();
    expect(within(second!).getByRole("alert").textContent).toContain("Idea not found.");
  });
});

describe("case lookups", () => {
  it("a promoted idea shows the case it became: date, status, one quiet link", () => {
    renderIdeas();
    const abcd = rows("researched")[0]!;
    expect(abcd.textContent).toContain(t.becameCasePrefix + new Date("2026-09-12T09:00:00.000Z").toLocaleDateString("he-IL"));
    expect(abcd.textContent).toContain(caseStatusLabel.researching);
    const links = within(abcd).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/cases/case-2");
    expect(abcd.querySelector(".bg-positive-soft, .text-positive")).toBeNull();
  });

  it("when the case row is missing, the link still works and no status or date is invented", () => {
    const data = ideasPreviewData("mixed");
    render(<IdeasView ideas={data.ideas} cases={loaded([])} actions={actions()} />);
    const abcd = rows("researched")[0]!;
    expect(abcd.textContent).toContain(t.becameCase);
    expect(abcd.textContent).not.toContain(t.becameCasePrefix);
    expect(abcd.textContent).not.toContain(caseStatusLabel.researching);
    expect(within(abcd).getByRole("link", { name: t.openCase }).getAttribute("href")).toBe("/cases/case-2");
  });

  it("an unpromoted idea whose ticker already has a case says so, neutrally, with a link", () => {
    renderIdeas();
    const [qrst, efgh] = rows("unresearched");
    expect(qrst!.textContent).not.toContain(t.existingCaseFact);
    expect(efgh!.textContent).toContain(t.existingCaseFact);
    expect(within(efgh!).getByRole("link", { name: t.openExistingCase }).getAttribute("href")).toBe("/cases/case-3");
    expect(efgh!.querySelector(".bg-caution-soft, .text-caution, .bg-negative-soft")).toBeNull();
  });

  it("with several cases on one ticker, the pointer is the first in the returned order", () => {
    const cases = [
      { id: "new", ticker: "EFGH" },
      { id: "old", ticker: "EFGH" },
    ];
    expect(existingCaseFor("EFGH", cases)?.id).toBe("new");
    expect(existingCaseFor("NONE", cases)).toBeUndefined();
  });
});

describe("states", () => {
  it("empty: the form stays above a teaching empty state", () => {
    const { container } = renderIdeas("empty");
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint)).toBeTruthy();
    expect(container.textContent!.indexOf(t.saveButton)).toBeLessThan(container.textContent!.indexOf(t.emptyTitle));
  });

  it("all promoted: the first list says so calmly", () => {
    renderIdeas("promoted");
    expect(within(region("unresearched")).getByText(t.allResearched)).toBeTruthy();
    expect(rows("researched")).toHaveLength(2);
  });

  it("loading and a failed list", () => {
    const { unmount } = render(<IdeasView ideas={{ data: undefined, isLoading: true, isError: false }} cases={loaded([])} actions={actions()} />);
    expect(screen.getByRole("status")).toBeTruthy();
    unmount();
    const refetch = vi.fn();
    render(<IdeasView ideas={{ data: undefined, isLoading: false, isError: true, error: { message: "network" }, refetch }} cases={loaded([])} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: shell.retry }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("shared ActionError", () => {
  it("renders the same markup the Case and Decision copies did, and nothing without a message", () => {
    const { container, rerender } = render(<ActionError message="boom" />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("rounded-md px-3.5 py-2.5 text-sm leading-relaxed bg-negative-soft text-ink");
    expect(alert.querySelector("p")!.textContent).toBe(shell.actionFailed);
    const bdi = alert.querySelector("bdi")!;
    expect(bdi.getAttribute("dir")).toBe("ltr");
    expect(bdi.className).toBe("text-xs");
    rerender(<ActionError message="boom" title="custom" />);
    expect(screen.getByRole("alert").querySelector("p")!.textContent).toBe("custom");
    rerender(<ActionError message={null} />);
    expect(container.innerHTML).toBe("");
  });
});
