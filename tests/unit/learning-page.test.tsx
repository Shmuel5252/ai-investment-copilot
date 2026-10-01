// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { learningPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 8 — the /learning page's plumbing: learning.list,
// learning.generate, learning.agree and learning.disagree with their existing
// inputs, and learning.evidence read only once an insight's evidence opens.
// Only the tRPC plumbing is stubbed; no AI and no database are involved.

const log: string[] = [];

vi.mock("@/trpc/react", () => {
  const insights = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      investorId: "x",
      family: "Synthetic Sector",
      createdAt: "2026-09-01T00:00:00.000Z",
      versions: [
        {
          versionNumber: 1,
          statementText: "Synthetic statement.",
          evidenceStrength: "weak",
          createdAt: "2026-09-01T00:00:00.000Z",
          createdBy: "ai_generated",
          provenanceJson: null,
        },
      ],
    },
  ];
  const mutation = (name: string, result: () => unknown) => (opts?: { onSuccess?: () => void }) => ({
    mutateAsync: async (input?: unknown) => {
      log.push(`${name} ${JSON.stringify(input ?? null)}`);
      const r = result();
      opts?.onSuccess?.();
      return r;
    },
    isPending: false,
    error: null,
    data: undefined,
  });
  return {
    trpc: {
      useUtils: () => ({ learning: { list: { invalidate: async () => void log.push("invalidate list") } } }),
      learning: {
        list: { useQuery: () => ({ data: insights, isLoading: false, isError: false }) },
        evidence: {
          useQuery: (input: unknown) => {
            log.push(`evidence ${JSON.stringify(input)}`);
            return { data: [], isLoading: false, isError: false };
          },
        },
        generate: { useMutation: mutation("generate", () => ({ familiesConsidered: 0, createdCount: 0, versionedCount: 0, unchangedCount: 0, droppedCount: 0 })) },
        agree: { useMutation: mutation("agree", () => ({ replayed: false, carried: { cases: 1, groundedCitations: 1, excludedCitations: 0, decisionsWithoutStatements: 0 } })) },
        disagree: { useMutation: mutation("disagree", () => ({ id: "c" })) },
      },
    },
  };
});

const { default: LearningPage } = await import("@/app/learning/page");

beforeEach(() => {
  log.length = 0;
});

const ID = "11111111-1111-4111-8111-111111111111";

describe("/learning page", () => {
  it("reads evidence only once opened, with the existing input", () => {
    render(<LearningPage />);
    expect(log.filter((l) => l.startsWith("evidence"))).toEqual([]);
    const details = Array.from(document.querySelectorAll("details")).find((d) => d.textContent?.includes(t.evidenceSummary)) as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(log).toContain(`evidence ${JSON.stringify({ learningInsightId: ID })}`);
  });

  it("runs generate with no input and refreshes the list", async () => {
    render(<LearningPage />);
    fireEvent.click(screen.getByRole("button", { name: t.generateButton }));
    await waitFor(() => expect(log).toContain("invalidate list"));
    expect(log[0]).toBe("generate null");
  });

  it("agree and disagree send exactly {learningInsightId, note}", async () => {
    render(<LearningPage />);
    const row = screen.getByRole("list", { name: t.listLabel });
    fireEvent.click(within(row).getByRole("button", { name: t.respondButton }));
    fireEvent.change(within(row).getByLabelText(new RegExp(t.noteLabel)), { target: { value: "agree note" } });
    fireEvent.click(within(row).getByRole("button", { name: t.agreeButton }));
    await within(row).findByText(t.carriedTitle);
    fireEvent.click(within(row).getByRole("button", { name: t.respondButton }));
    fireEvent.change(within(row).getByLabelText(new RegExp(t.noteLabel)), { target: { value: "disagree note" } });
    fireEvent.click(within(row).getByRole("button", { name: t.disagreeButton }));
    await within(row).findByText(t.disagreedTitle);
    expect(log).toEqual([
      `agree ${JSON.stringify({ learningInsightId: ID, note: "agree note" })}`,
      `disagree ${JSON.stringify({ learningInsightId: ID, note: "disagree note" })}`,
    ]);
  });
});
