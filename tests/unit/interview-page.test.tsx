// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { interviewPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 7C-F — the /interview page's plumbing: interview.start,
// interview.answer (with the opaque anchorContextHash) and interview.complete
// are called with their existing inputs, and nothing starts without history.
// Only the tRPC plumbing is stubbed; no AI and no database are involved.

const log: string[] = [];
const history = { transactionCount: 3 };

vi.mock("@/trpc/react", () => {
  const mutation = (name: string, result: () => unknown) => () => ({
    mutateAsync: async (input?: unknown) => {
      log.push(`${name} ${JSON.stringify(input ?? null)}`);
      return result();
    },
  });
  const question = {
    anchor: { transactionId: "tx-1", ticker: "AAAA", side: "buy", date: "2026-03-04", quantity: 5, role: "initial_buy", price: 10 },
    factsLine: "synthetic facts line",
    questionText: "synthetic question",
    questionSource: "deterministic",
    anchorContextHash: "f".repeat(64),
  };
  return {
    trpc: {
      import: { history: { useQuery: () => ({ data: history, isLoading: false, isError: false }) } },
      interview: {
        start: { useMutation: mutation("start", () => ({ sessionId: "11111111-1111-4111-8111-111111111111", questions: [question] })) },
        answer: { useMutation: mutation("answer", () => ({ id: "answer-1" })) },
        complete: { useMutation: mutation("complete", () => ({ ok: true })) },
      },
    },
  };
});

const { default: InterviewPage } = await import("@/app/interview/page");

beforeEach(() => {
  log.length = 0;
  history.transactionCount = 3;
});

describe("/interview page", () => {
  it("starts, answers with the question's hash, then completes, using the existing inputs", async () => {
    render(<InterviewPage />);
    fireEvent.click(screen.getByRole("button", { name: t.startButton }));
    const box = (await screen.findByLabelText(new RegExp(t.answerLabel))) as HTMLTextAreaElement;
    expect(document.body.textContent).toContain("synthetic facts line");
    fireEvent.change(box, { target: { value: "my words" } });
    fireEvent.click(screen.getByRole("button", { name: t.saveFinish }));
    await screen.findByRole("heading", { name: t.doneTitle });
    expect(log).toEqual([
      "start null",
      `answer ${JSON.stringify({ sessionId: "11111111-1111-4111-8111-111111111111", transactionId: "tx-1", questionText: "synthetic question", answerText: "my words", anchorContextHash: "f".repeat(64) })}`,
      `complete ${JSON.stringify({ sessionId: "11111111-1111-4111-8111-111111111111" })}`,
    ]);
  });

  it("with no imported history, offers /import and calls nothing", () => {
    history.transactionCount = 0;
    render(<InterviewPage />);
    expect(screen.getByText(t.noHistoryTitle)).toBeTruthy();
    expect(log).toEqual([]);
  });
});
