// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { ideasPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 5 — the /ideas page's orchestration: the existing
// procedures are called with their existing inputs, a saved idea refreshes
// the list, and a promotion refetches both lists BEFORE navigating. Only the
// tRPC and router plumbing is stubbed; nothing about ideas is faked beyond
// the rows the stubbed list returns.

const log: string[] = [];
const push = vi.fn((href: string) => log.push(`push ${href}`));
let releaseRefetch: () => void = () => {};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/trpc/react", () => {
  const ideas = [{ id: "idea-1", ticker: "ABCD", noteText: "note", createdAt: "2026-09-01T00:00:00.000Z", promotedToCaseId: null }];
  const invalidate = (name: string) =>
    vi.fn(() => {
      log.push(`invalidate ${name}`);
      return new Promise<void>((resolve) => {
        const prev = releaseRefetch;
        releaseRefetch = () => {
          prev();
          log.push(`refetched ${name}`);
          resolve();
        };
      });
    });
  const utils = { ideas: { list: { invalidate: invalidate("ideas") } }, cases: { list: { invalidate: invalidate("cases") } } };
  const mutation = (name: string, result: unknown) => (opts: { onSuccess?: (r: unknown) => unknown }) => ({
    mutateAsync: async (input: unknown) => {
      log.push(`${name} ${JSON.stringify(input)}`);
      await opts.onSuccess?.(result);
      return result;
    },
    isPending: false,
    error: null,
    variables: undefined,
  });
  return {
    trpc: {
      useUtils: () => utils,
      ideas: {
        list: { useQuery: () => ({ data: ideas, isLoading: false, isError: false }) },
        create: { useMutation: mutation("create", { id: "idea-2" }) },
        promote: { useMutation: mutation("promote", { id: "case-9" }) },
      },
      cases: { list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) } },
    },
  };
});

const { default: IdeasPage } = await import("@/app/ideas/page");

beforeEach(() => {
  log.length = 0;
  push.mockClear();
  releaseRefetch = () => {};
});

describe("/ideas page", () => {
  it("creates through ideas.create with { ticker, noteText } and refreshes the idea list", async () => {
    render(<IdeasPage />);
    fireEvent.change(screen.getByLabelText(new RegExp(t.tickerLabel)), { target: { value: "wxyz" } });
    fireEvent.change(screen.getByLabelText(new RegExp(t.noteLabel)), { target: { value: "why" } });
    fireEvent.click(screen.getByRole("button", { name: t.saveButton }));
    await waitFor(() => expect(log).toContain('create {"ticker":"wxyz","noteText":"why"}'));
    expect(log).toContain("invalidate ideas");
  });

  it("promotes through ideas.promote with { ideaId }, refetches both lists, and only then navigates", async () => {
    render(<IdeasPage />);
    const row = within(document.getElementById("unresearched")!).getAllByRole("listitem")[0]!;
    fireEvent.click(within(row).getByRole("button", { name: t.promoteButton }));
    await waitFor(() => expect(log).toContain('promote {"ideaId":"idea-1"}'));
    expect(log).toContain("invalidate ideas");
    expect(log).toContain("invalidate cases");
    expect(push).not.toHaveBeenCalled();
    releaseRefetch();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-9"));
    expect(log.indexOf("push /cases/case-9")).toBeGreaterThan(log.indexOf("refetched cases"));
    expect(log.indexOf("push /cases/case-9")).toBeGreaterThan(log.indexOf("refetched ideas"));
  });
});
