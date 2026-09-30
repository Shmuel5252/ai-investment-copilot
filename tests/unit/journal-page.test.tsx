// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { journalPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 7A — the /journal page's orchestration: the existing
// "Tell me why" procedures are called with their existing inputs, an update
// passes supersedesAnswerId, the Journal is refetched after a save (and
// after a failed one), and a failure to mark the session complete never
// sends the answer again. Only the tRPC plumbing is stubbed; no AI and no
// database are involved.

const log: string[] = [];
const fail = new Set<string>();

vi.mock("@/trpc/react", () => {
  const episode = (key: string, entryId: string, answered: boolean) => ({
    key,
    ticker: key.split("#")[0],
    episodeNumber: 1,
    status: "closed",
    buyCount: 1,
    sellCount: 1,
    firstDate: "2026-05-01T00:00:00.000Z",
    entry: { transactionId: entryId, date: "2026-05-01T00:00:00.000Z", quantity: 1, price: 1 },
    anchorable: true,
    rationale: answered
      ? { status: "answered", answers: [{ id: "old-answer", questionText: "q", answerText: "old words", createdAt: "2026-09-01T00:00:00.000Z" }], latestAnswerId: "old-answer" }
      : { status: "unanswered", answers: [], latestAnswerId: null },
    later: answered ? { exitDate: null, holdingDays: null, sells: [] } : null,
  });
  const data = { coverage: { covered: 1, total: 2 }, episodes: [episode("AAAA#1", "buy-a", false), episode("BBBB#1", "buy-b", true)] };
  const utils = {
    interview: {
      journal: { invalidate: async () => void log.push("invalidate journal") },
      journalCoverage: { invalidate: async () => void log.push("invalidate coverage") },
    },
  };
  const mutation = (name: string, result: (input: { transactionId?: string }) => unknown) => () => ({
    mutateAsync: async (input: { transactionId?: string }) => {
      log.push(`${name} ${JSON.stringify(input)}`);
      if (fail.has(name)) throw new Error(`${name} failed`);
      return result(input);
    },
  });
  return {
    trpc: {
      useUtils: () => utils,
      interview: {
        journal: { useQuery: () => ({ data, isLoading: false, isError: false }) },
        startTellMeWhy: { useMutation: mutation("start", (i) => ({ sessionId: "11111111-1111-4111-8111-111111111111", transactionId: i.transactionId, questionText: "fixed question" })) },
        answer: { useMutation: mutation("answer", () => ({ id: "new-answer" })) },
        complete: { useMutation: mutation("complete", () => ({ ok: true })) },
      },
    },
  };
});

const { default: JournalPage } = await import("@/app/journal/page");

beforeEach(() => {
  log.length = 0;
  fail.clear();
});

const rowOf = (ticker: string) => screen.getAllByRole("listitem").find((r) => r.textContent?.includes(ticker)) as HTMLElement;

async function write(ticker: string, button: string, text: string, save: string) {
  fireEvent.click(within(rowOf(ticker)).getByRole("button", { name: button }));
  const box = (await within(rowOf(ticker)).findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(within(rowOf(ticker)).getByRole("button", { name: save }));
  return box;
}

describe("/journal page", () => {
  it("writes a rationale through startTellMeWhy, answer and complete, then refetches the Journal and coverage", async () => {
    render(<JournalPage />);
    await write("AAAA", t.writeButton, "my words", t.saveButton);
    await waitFor(() => expect(log).toContain("invalidate coverage"));
    expect(log).toEqual([
      'start {"transactionId":"buy-a"}',
      'answer {"sessionId":"11111111-1111-4111-8111-111111111111","transactionId":"buy-a","questionText":"fixed question","answerText":"my words"}',
      'complete {"sessionId":"11111111-1111-4111-8111-111111111111"}',
      "invalidate journal",
      "invalidate coverage",
    ]);
  });

  it("an update passes supersedesAnswerId of the current answer and never edits it", async () => {
    render(<JournalPage />);
    await write("BBBB", t.updateButton, "better words", t.updateSaveButton);
    await waitFor(() => expect(log.some((l) => l.startsWith("answer"))).toBe(true));
    const sent = JSON.parse(log.find((l) => l.startsWith("answer"))!.slice("answer ".length));
    expect(sent).toMatchObject({ transactionId: "buy-b", answerText: "better words", supersedesAnswerId: "old-answer" });
  });

  it("when complete fails, the saved answer is not sent again and the Journal is still refetched", async () => {
    fail.add("complete");
    render(<JournalPage />);
    await write("AAAA", t.writeButton, "my words", t.saveButton);
    await waitFor(() => expect(log).toContain("invalidate coverage"));
    expect(log.filter((l) => l.startsWith("answer"))).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("when answer fails, the text stays, the failure shows, and the Journal is refetched to show what was saved", async () => {
    fail.add("answer");
    render(<JournalPage />);
    const box = await write("AAAA", t.writeButton, "keep me", t.saveButton);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("answer failed"));
    expect(box.value).toBe("keep me");
    expect(log).toContain("invalidate journal");
    expect(log.some((l) => l.startsWith("complete"))).toBe(false);
  });
});
