// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { importPage as t, manualEntryPage as m } from "@/lib/i18n/strings";

// Frontend V1 unit 7B — the /import page's orchestration. Only the tRPC
// plumbing is stubbed (with the synthetic preview data); no AI and no
// database are involved. There is deliberately no `interview` namespace in
// the stub: the page must not call any rationale procedure.

const log: string[] = [];
const failures = new Map<string, "BAD_REQUEST" | "INTERNAL_SERVER_ERROR">();
const refetched: string[] = [];

vi.mock("@/trpc/react", async () => {
  const React = await import("react");
  const data = await import("@/app/styleguide/import-preview-data");
  const query = (name: string, value: unknown) => (_input?: unknown, opts?: { enabled?: boolean }) => ({
    data: opts?.enabled === false ? undefined : value,
    isLoading: false,
    isError: false,
    refetch: async () => void refetched.push(name),
  });
  const mutation = (name: string, result: unknown) => (opts?: { onSettled?: () => unknown }) => {
    const [state, setState] = React.useState<{ data: unknown; error: unknown }>({ data: undefined, error: null });
    return {
      mutateAsync: async (input: unknown) => {
        log.push(`${name} ${JSON.stringify(input)}`);
        const code = failures.get(name);
        if (code) {
          const e = Object.assign(new Error(`${name} failed`), { data: { code } });
          setState({ data: undefined, error: e });
          await opts?.onSettled?.();
          throw e;
        }
        setState({ data: result, error: null });
        await opts?.onSettled?.();
        return result;
      },
      isPending: false,
      data: state.data,
      error: state.error,
      reset: () => setState({ data: undefined, error: null }),
    };
  };
  const manualCheck = {
    collisionGroups: [],
    reconciliation: { mode: "manual_entry", counts: { new: 1, exact_duplicate: 0, probable_manual_match: 0, ambiguous: 0, requiresResolution: 0 }, rows: [] },
  };
  return {
    trpc: {
      useUtils: () => ({ import: { history: { invalidate: async () => undefined }, corporateActions: { invalidate: async () => undefined } } }),
      import: {
        history: { useQuery: query("history", data.PREVIEW_HISTORY) },
        corporateActions: { useQuery: query("corporateActions", data.PREVIEW_SPLITS) },
        preview: { useQuery: query("preview", data.PREVIEW_PREVIEW) },
        validate: { useQuery: query("validate", data.PREVIEW_VALIDATION_CLEAN) },
        checkManualEntry: { useQuery: query("checkManualEntry", manualCheck) },
        confirmImport: { useMutation: mutation("confirmImport", { batchId: "b", ...data.PREVIEW_RESULT }) },
        confirmManualEntry: { useMutation: mutation("confirmManualEntry", data.PREVIEW_MANUAL_RESULT) },
        recordStockSplit: { useMutation: mutation("recordStockSplit", {}) },
      },
    },
  };
});

const { default: ImportPage } = await import("@/app/import/page");

beforeEach(() => {
  log.length = 0;
  refetched.length = 0;
  failures.clear();
});

async function reachReview() {
  render(<ImportPage />);
  const file = new File(["Date,Symbol\n2026-07-02,MNOP"], "sample.csv", { type: "text/csv" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(t.uploadLabel), { target: { files: [file] } });
  });
  fireEvent.click(await screen.findByRole("button", { name: t.checkButton }));
  await screen.findByRole("button", { name: t.confirmButton });
  // answer both flagged rows: 15 is the same as the manual one, 16 is separate
  const rec = document.getElementById("reconciliation-csv_import") as HTMLElement;
  const [probable, ambiguous] = within(rec).getAllByRole("group");
  fireEvent.click(within(probable!).getAllByRole("radio")[0]!);
  fireEvent.click(within(ambiguous!).getAllByRole("radio")[1]!);
}
const confirmButton = () => screen.getByRole("button", { name: t.confirmButton }) as HTMLButtonElement;
const sent = (name: string) => JSON.parse(log.find((l) => l.startsWith(`${name} `))!.slice(name.length + 1));

describe("/import file path", () => {
  it("sends the existing confirmImport input: mapping, file name, answers, orders only for new-row groups, opening states only for asked tickers", async () => {
    await reachReview();
    const ordering = document.getElementById("ordering") as HTMLElement;
    const [o1, o2] = within(ordering).getAllByRole("spinbutton");
    fireEvent.change(o1!, { target: { value: "1" } });
    fireEvent.change(o2!, { target: { value: "2" } });
    fireEvent.change(within(document.getElementById("opening") as HTMLElement).getByLabelText(t.openingQuantity), { target: { value: "12.5" } });
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    await screen.findByText(t.doneTitle);
    expect(log.filter((l) => l.startsWith("confirmImport"))).toHaveLength(1);
    const input = sent("confirmImport");
    expect(input.filename).toBe("sample.csv");
    expect(input.mapping.date).toBe("Date");
    expect(input.rowOrderDeclarations).toEqual({ "4": 1, "5": 2 });
    expect(input.reconciliationResolutions).toEqual([
      { clientRowKey: "14", identityKey: "k14", action: "same", existingTransactionId: "man-1" },
      { clientRowKey: "15", identityKey: "k15", action: "separate" },
    ]);
    expect(input.openingStates).toHaveLength(1);
    expect(input.openingStates[0]).toMatchObject({ ticker: "QRST", quantity: 12.5, costBasisPerShare: null, costBasisConfidence: "approximate" });
    expect(document.body.textContent).toContain(t.doneOpeningSaved);
    expect(screen.getByRole("link", { name: t.journalLink }).getAttribute("href")).toBe("/journal");
  });

  it("after a failure that may have written something, confirm waits for a refresh", async () => {
    failures.set("confirmImport", "INTERNAL_SERVER_ERROR");
    await reachReview();
    fireEvent.click(confirmButton());
    await screen.findByText(t.uncertainTitle);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: t.refreshButton }));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(refetched).toEqual(expect.arrayContaining(["history", "validate"]));
  });

  it("after a refusal, says nothing was saved and leaves confirm available", async () => {
    failures.set("confirmImport", "BAD_REQUEST");
    await reachReview();
    fireEvent.click(confirmButton());
    await screen.findByText(t.refusedTitle);
    expect(confirmButton().disabled).toBe(false);
  });
});

describe("/import manual path", () => {
  it("saves the entered fields with no amount, then points to the Journal without any rationale writer", async () => {
    render(<ImportPage />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.manualMode) }));
    const row = screen.getAllByRole("group")[0]!;
    fireEvent.change(within(row).getByLabelText(m.tickerLabel), { target: { value: " hijk " } });
    fireEvent.change(within(row).getByLabelText(m.quantityLabel), { target: { value: "15" } });
    fireEvent.change(within(row).getByLabelText(m.priceLabel), { target: { value: "210" } });
    fireEvent.change(within(row).getByLabelText(m.dateLabel), { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    await screen.findByText(m.savedTitle);
    const input = sent("confirmManualEntry");
    expect(input.rows).toHaveLength(1);
    expect(input.rows[0]).toEqual({ ticker: "hijk", transactionType: "buy", quantity: 15, price: 210, transactionDate: "2026-09-10T00:00:00.000Z" });
    expect(input.resolutions).toEqual([]);
    expect(screen.getByRole("link", { name: t.journalLink }).getAttribute("href")).toBe("/journal");
    // the only textarea left on the page is the stock-split evidence field
    expect(document.getElementById("manual-done")!.querySelector("textarea")).toBeNull();
    expect([...document.querySelectorAll("textarea")].every((el) => el.closest("#splits"))).toBe(true);
  });
});
