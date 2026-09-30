// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { strategyPage as t } from "@/lib/i18n/strings";

// Frontend V1 unit 6B — the /strategy page's orchestration: ensureDefaults
// still runs once on load, and every mutation is called with its existing
// input (the edited wording goes to confirmDeclared). Only the tRPC plumbing
// is stubbed; no AI and no database are involved.

const log: string[] = [];

vi.mock("@/trpc/react", () => {
  const list = {
    principles: [{ id: "p1", versions: [{ principleType: "validated", statementText: "guardrail", rationaleText: "", versionNumber: 1, evidenceStrength: null, supportingEvidenceCount: null, contradictingEvidenceCount: null, createdAt: "2026-08-01T00:00:00.000Z", createdBy: "system_default", changeReason: null }] }],
    latestVersion: null,
  };
  const candidates = [{ statementText: "proposed wording", rationaleText: "why", citedAnswerIds: ["a1"] }];
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: async () => undefined }) }) });
  const mutation = (name: string, result: unknown) => (opts?: { onSuccess?: (r: unknown) => unknown }) => {
    const m = {
      mutate: (input?: unknown) => void m.mutateAsync(input),
      mutateAsync: async (input?: unknown) => {
        log.push(`${name} ${JSON.stringify(input ?? null)}`);
        await opts?.onSuccess?.(result);
        return result;
      },
      isPending: false,
      error: null,
      data: name === "proposeDeclared" ? { candidates } : undefined,
    };
    return m;
  };
  return {
    trpc: {
      useUtils: () => utils,
      strategy: {
        list: { useQuery: () => ({ data: list, isLoading: false, isError: false }) },
        evidence: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        ensureDefaults: { useMutation: mutation("ensureDefaults", []) },
        approveVersion: { useMutation: mutation("approveVersion", { versionNumber: 1 }) },
        proposeDeclared: { useMutation: mutation("proposeDeclared", { candidates }) },
        confirmDeclared: { useMutation: mutation("confirmDeclared", { principle: {}, version: {} }) },
        generateObserved: { useMutation: mutation("generateObserved", { createdCount: 0, versionedCount: 0, unchangedCount: 0, droppedCount: 0 }) },
      },
      evidence: { reach: { useQuery: () => ({ data: { claims: [] }, isLoading: false, isError: false }) } },
      decisions: { list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) } },
    },
  };
});

const { default: StrategyPage } = await import("@/app/strategy/page");

beforeEach(() => {
  log.length = 0;
});

describe("/strategy page", () => {
  it("runs ensureDefaults once on load, even under StrictMode's double mount", () => {
    render(
      <StrictMode>
        <StrategyPage />
      </StrictMode>
    );
    expect(log.filter((l) => l.startsWith("ensureDefaults"))).toHaveLength(1);
  });

  it("sends the investor's edited wording, and the other fields unchanged, to confirmDeclared", async () => {
    render(<StrategyPage />);
    const list = screen.getByRole("list", { name: t.candidatesTitle });
    const [row] = within(list).getAllByRole("listitem");
    fireEvent.change(within(row!).getByLabelText(t.candidateLabel), { target: { value: "my wording" } });
    fireEvent.click(within(row!).getByRole("button", { name: t.confirmButton }));
    await waitFor(() => expect(log).toContain('confirmDeclared {"statementText":"my wording","rationaleText":"why","citedAnswerIds":["a1"]}'));
  });

  it("sends the summary to approveVersion", async () => {
    render(<StrategyPage />);
    fireEvent.change(screen.getByLabelText(new RegExp(t.summaryLabel)), { target: { value: "first version" } });
    fireEvent.click(screen.getByRole("button", { name: t.approveButton }));
    await waitFor(() => expect(log).toContain('approveVersion {"changeSummary":"first version"}'));
  });
});
