// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { loaded } from "@/components/home/types";
import { DoneStep, MappingStep, ReviewStep, UploadStep, WriteFailure, type ConfirmState } from "@/components/import/file-steps";
import { ManualEntryDone, ManualEntryForm } from "@/components/import/manual-entry";
import { StockSplits } from "@/components/import/stock-splits";
import { HistoryStatus } from "@/components/import/history-status";
import { declarableKeys, orderingGroups, skippedKeys, unresolvedCount } from "@/components/import/reconciliation";
import { toWriteError, type OpeningStateDraft, type ResolutionDraft } from "@/components/import/types";
import {
  EMPTY_HISTORY,
  PREVIEW_FILENAME,
  PREVIEW_HISTORY,
  PREVIEW_MANUAL_CHECK,
  PREVIEW_MANUAL_RESULT,
  PREVIEW_MANUAL_ROWS,
  PREVIEW_PREVIEW,
  PREVIEW_RESOLVED,
  PREVIEW_RESULT,
  PREVIEW_SPLITS,
  PREVIEW_UNCERTAIN,
  PREVIEW_VALIDATION,
  PREVIEW_VALIDATION_CLEAN,
} from "@/app/styleguide/import-preview-data";
import {
  collisionResolution as cr,
  corporateActionsPage as ca,
  historyFreshness as hf,
  importPage as t,
  manualEntryPage as m,
  reconciliation as rc,
} from "@/lib/i18n/strings";

// Frontend V1 unit 7B — the /import components on the synthetic data the
// /styleguide preview uses. No procedure, AI or database is involved.

const noop = () => undefined;
const esc = (s: string) => s.replace(/[()]/g, (c) => `\\${c}`);
const confirmState = (over: Partial<ConfirmState> = {}): ConfirmState => ({ run: vi.fn(), pending: false, error: null, needsRefresh: false, refresh: vi.fn(), refreshing: false, ...over });

function renderReview(over: { validation?: typeof PREVIEW_VALIDATION; resolutions?: Record<string, ResolutionDraft>; opening?: Record<string, OpeningStateDraft>; confirm?: ConfirmState } = {}) {
  const onResolution = vi.fn();
  const onOrder = vi.fn();
  const confirm = over.confirm ?? confirmState();
  render(
    <ReviewStep
      validation={loaded(over.validation ?? PREVIEW_VALIDATION)}
      splitsCount={1}
      resolutions={over.resolutions ?? {}}
      onResolution={onResolution}
      orders={{}}
      onOrder={onOrder}
      openingStates={over.opening ?? {}}
      onOpening={noop}
      confirm={confirm}
      onBack={noop}
    />
  );
  return { onResolution, onOrder, confirm };
}
const confirmButton = () => screen.getByRole("button", { name: t.confirmButton }) as HTMLButtonElement;
const ALL_COPY = [t, hf, rc, cr, m, ca].flatMap((g) => Object.values(g)).join(" ");

describe("copy never overclaims", () => {
  it("never says the preview is final, the file is kept, the mapping is saved, or the whole import is atomic", () => {
    for (const claim of ["בדיוק מה שייכתב", "הקובץ נשמר", "המיפוי נשמר", "יובא יחד", "הכול נשמר יחד", "אטומי", "בבת אחת"]) expect(ALL_COPY, claim).not.toContain(claim);
    expect(t.uploadHelp).toContain("לא את הקובץ עצמו");
    expect(t.mappingHint).toContain("אינו נשמר");
    expect(t.advisoryNote).toBe("זו בדיקה מקדימה. בזמן האישור המערכת בודקת מחדש מול המידע העדכני.");
  });

  it("every Import string is Hebrew", () => {
    for (const g of [t, hf, rc, cr, m, ca]) for (const [k, v] of Object.entries(g)) expect(v, k).toMatch(/[א-ת]/);
  });
});

describe("history status", () => {
  it("states the stored reach as plain facts, with no score or coloring", () => {
    render(<HistoryStatus history={loaded(PREVIEW_HISTORY)} />);
    const text = document.body.textContent ?? "";
    for (const label of [hf.latestTransaction, hf.totalTransactions, hf.latestFile, hf.latestFileRows, hf.manualEntries, hf.disclaimer]) expect(text).toContain(label);
    expect(text).toContain("broker-sample.csv");
    expect(document.body.innerHTML).not.toMatch(/text-(positive|negative|caution)|bg-(positive|negative|caution)/);
  });

  it("with no history, presents a legitimate first import", () => {
    render(<HistoryStatus history={loaded(EMPTY_HISTORY)} />);
    expect(screen.getByText(hf.noHistoryTitle)).toBeTruthy();
  });
});

describe("upload and mapping", () => {
  it("accepts a CSV file and says the file itself is not kept", () => {
    render(<UploadStep onFile={noop} reading={false} />);
    const input = screen.getByLabelText(t.uploadLabel) as HTMLInputElement;
    expect(input.accept).toBe(".csv,text/csv");
    expect(document.body.textContent).toContain(t.uploadHelp);
  });

  it("shows the suggested mapping, marks date and type required, and cannot check without them", () => {
    const onCheck = vi.fn();
    const { rerender } = render(<MappingStep filename={PREVIEW_FILENAME} preview={loaded(PREVIEW_PREVIEW)} mapping={PREVIEW_PREVIEW.suggestedMapping} onMapping={noop} onCheck={onCheck} onChangeFile={noop} />);
    expect((screen.getByLabelText(/^תאריך/) as HTMLSelectElement).value).toBe("Date");
    expect(document.body.textContent).toContain(t.mappingHint);
    fireEvent.click(screen.getByRole("button", { name: t.checkButton }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    rerender(<MappingStep filename={PREVIEW_FILENAME} preview={loaded(PREVIEW_PREVIEW)} mapping={{ date: "Date" }} onMapping={noop} onCheck={onCheck} onChangeFile={noop} />);
    expect((screen.getByRole("button", { name: t.checkButton }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("review", () => {
  it("is labelled a preview, explains confirm re-checks everything, and lists invalid rows as blockers", () => {
    renderReview();
    expect(document.body.textContent).toContain(t.advisoryNote);
    expect(document.body.textContent).toContain(t.confirmExplanation);
    expect(t.confirmExplanation).toContain("בודקת שוב");
    const invalid = document.getElementById("invalid") as HTMLElement;
    expect(within(invalid).getAllByRole("listitem")).toHaveLength(2);
    expect(invalid.textContent).toContain("Sample: missing date");
    expect(confirmButton().disabled).toBe(true);
    expect(document.body.textContent).toContain(t.blockedInvalid);
  });

  it("keeps the four reconciliation classes and asks only about the rows the contract flags", () => {
    renderReview();
    const section = document.getElementById("reconciliation-csv_import") as HTMLElement;
    for (const label of [rc.newCount, rc.exactCount, rc.probableCount, rc.ambiguousCount]) expect(section.textContent).toContain(label);
    const decisions = within(section).getAllByRole("group");
    expect(decisions).toHaveLength(2); // row 15 (probable) and row 16 (ambiguous); the exact duplicate is skipped without a question
    expect(section.textContent).toContain(`${rc.rowPrefix} 15`);
    expect(section.textContent).toContain(`${rc.rowPrefix} 16`);
  });

  it("an ambiguous row answered 'same' needs a chosen candidate before confirm is allowed", () => {
    const { onResolution } = renderReview({ validation: PREVIEW_VALIDATION_CLEAN, resolutions: { "14": PREVIEW_RESOLVED["14"], "15": { action: "same" } } });
    expect(confirmButton().disabled).toBe(true);
    expect(document.body.textContent).toContain(t.blockedUnresolved);
    const select = screen.getByLabelText(rc.chooseCandidate) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "man-3" } });
    expect(onResolution).toHaveBeenCalledWith("15", { action: "same", existingTransactionId: "man-3" });
  });

  it("allows confirm once the file is clean and every flagged row is answered", () => {
    const { confirm } = renderReview({ validation: PREVIEW_VALIDATION_CLEAN, resolutions: PREVIEW_RESOLVED });
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(confirm.run).toHaveBeenCalledTimes(1);
  });

  it("offers order numbers only for a group of new rows; a group with a stored row gets an explanation instead", () => {
    const { onOrder } = renderReview();
    const ordering = document.getElementById("ordering") as HTMLElement;
    const inputs = within(ordering).getAllByRole("spinbutton");
    expect(inputs).toHaveLength(2); // rows 5 and 6 of MNOP; the WXYZ group includes a stored row
    fireEvent.change(inputs[0]!, { target: { value: "1" } });
    expect(onOrder).toHaveBeenCalledWith("4", "1");
    expect(ordering.textContent).toContain(cr.existingNote);
    expect(ordering.textContent).toContain(cr.explanation);
  });

  it("asks for opening states and says they are stored separately, after the transactions", () => {
    renderReview({ validation: PREVIEW_VALIDATION_CLEAN, resolutions: PREVIEW_RESOLVED, opening: { QRST: { ticker: "QRST", quantity: "10", costBasisPerShare: "", costBasisConfidence: "approximate", asOfDate: "2026-06-30" } } });
    const opening = document.getElementById("opening") as HTMLElement;
    expect(opening.textContent).toContain("QRST");
    expect(opening.textContent).toContain(t.openingSeparateNote);
    expect(document.body.textContent).toContain(t.confirmOpeningNote);
  });

  it("offers no undo, edit or delete of imported data", () => {
    renderReview();
    for (const b of screen.getAllByRole("button")) expect(b.textContent).not.toMatch(/בטל ייבוא|ערוך|מחק|undo|delete/i);
  });
});

describe("write failures", () => {
  it("classifies only BAD_REQUEST as a refusal that wrote nothing", () => {
    const refused = Object.assign(new Error("refused"), { data: { code: "BAD_REQUEST" } });
    const server = Object.assign(new Error("boom"), { data: { code: "INTERNAL_SERVER_ERROR" } });
    expect(toWriteError(refused)).toEqual({ message: "refused", refused: true });
    expect(toWriteError(server)).toEqual({ message: "boom", refused: false });
    expect(toWriteError(new Error("network"))?.refused).toBe(false);
    expect(toWriteError(null)).toBeNull();
  });

  it("a refusal says nothing was saved", () => {
    render(<WriteFailure error={{ message: "1 row(s) still fail validation", refused: true }} body={t.uncertainBody} />);
    expect(screen.getByRole("alert").textContent).toContain(t.refusedTitle);
  });

  it("any other failure says something may have been saved, asks for a refresh, and blocks confirm until then", () => {
    const refresh = vi.fn();
    renderReview({ validation: PREVIEW_VALIDATION_CLEAN, resolutions: PREVIEW_RESOLVED, confirm: confirmState({ error: PREVIEW_UNCERTAIN, needsRefresh: true, refresh }) });
    const text = document.body.textContent ?? "";
    expect(text).toContain(t.uncertainTitle);
    expect(text).toContain(t.uncertainBody);
    expect(t.uncertainBody).toContain("יתרות פתיחה יישמרו שוב");
    expect(text).not.toContain(t.refusedTitle);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: t.refreshButton }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("done", () => {
  it("reports the transactions and the opening states separately, never as one atomic write", () => {
    render(<DoneStep result={PREVIEW_RESULT} filename={PREVIEW_FILENAME} openingSaved={1} onAnother={noop} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(t.doneTransactionsTitle);
    expect(text).toContain(t.doneOpeningTitle);
    expect(text).toContain(t.doneOpeningSaved);
    expect(t.doneOpeningSaved).toContain("בפעולה נפרדת");
    for (const label of [t.doneImported, t.doneSeparate, t.doneSkippedExact, t.doneSkippedSame]) expect(text).toContain(label);
    expect(screen.getByRole("link", { name: t.journalLink }).getAttribute("href")).toBe("/journal");
  });

  it("says no opening states were entered when none were sent", () => {
    render(<DoneStep result={PREVIEW_RESULT} filename={PREVIEW_FILENAME} openingSaved={0} onAnother={noop} />);
    expect(document.body.textContent).toContain(t.doneOpeningNone);
  });
});

describe("manual entry", () => {
  it("keeps the existing fields and has no amount field: the server computes it", () => {
    render(<ManualEntryForm rows={PREVIEW_MANUAL_ROWS} onRow={noop} onAdd={noop} onRemove={noop} check={loaded(PREVIEW_MANUAL_CHECK)} resolutions={{}} onResolution={noop} actions={{ submit: vi.fn(), pending: false, error: null, needsRefresh: false, refresh: noop, refreshing: false }} />);
    const first = screen.getAllByRole("group")[0]!;
    for (const label of [m.tickerLabel, m.typeLabel, m.quantityLabel, m.priceLabel, m.dateLabel, m.notesLabel]) expect(within(first).getByLabelText(new RegExp(esc(label)))).toBeTruthy();
    expect(within(first).queryByLabelText(/סכום/)).toBeNull();
    expect(m.description).toContain("הסכום מחושב במערכת");
  });

  it("an identical row in the same form must be declared separate or dropped before saving", () => {
    render(<ManualEntryForm rows={PREVIEW_MANUAL_ROWS} onRow={noop} onAdd={noop} onRemove={noop} check={loaded(PREVIEW_MANUAL_CHECK)} resolutions={{}} onResolution={noop} actions={{ submit: vi.fn(), pending: false, error: null, needsRefresh: false, refresh: noop, refreshing: false }} />);
    const section = document.getElementById("reconciliation-manual_entry") as HTMLElement;
    expect(section.textContent).toContain(rc.exactWithinBatchNote);
    expect(within(section).getByLabelText(rc.manualSeparateChoice)).toBeTruthy();
    expect((screen.getByRole("button", { name: m.submitButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("after saving, points to the Journal instead of embedding a rationale writer", () => {
    render(<ManualEntryDone result={PREVIEW_MANUAL_RESULT} onMore={noop} />);
    expect(screen.getByRole("link", { name: t.journalLink }).getAttribute("href")).toBe("/journal");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).not.toMatch(/אני רוצה לספר למה|ספר לי על ההשקעה/);
    expect(m.journalNext).toContain("אם תרצה");
    expect(m.journalNext).toContain("לא תופיע שם");
    expect(screen.getAllByText(m.provenance)).toHaveLength(2);
  });
});

describe("stock splits", () => {
  it("lists each split with its named source and the evidence as written", () => {
    render(<StockSplits list={loaded(PREVIEW_SPLITS)} actions={{ record: vi.fn(async () => true), pending: false, error: null }} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(ca.sourceIssuer);
    expect(document.querySelector("blockquote")?.textContent).toBe(PREVIEW_SPLITS[0]!.evidence);
    expect(ca.description).toContain("המערכת לא מזהה פיצולים לבד");
  });

  it("records only with evidence and the explicit confirmation, sending confirmed: true", async () => {
    const record = vi.fn(async () => true);
    render(<StockSplits list={loaded([])} actions={{ record, pending: false, error: null }} />);
    const button = screen.getByRole("button", { name: ca.recordButton }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(new RegExp(ca.tickerLabel)), { target: { value: "abcd" } });
    fireEvent.change(screen.getByLabelText(new RegExp(ca.effectiveDateLabel)), { target: { value: "2026-06-10" } });
    fireEvent.change(screen.getByLabelText(new RegExp(ca.ratioNumerator)), { target: { value: "4" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(new RegExp(esc(ca.evidenceLabel))), { target: { value: "sample evidence" } });
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(ca.confirmLabel));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(record).toHaveBeenCalledWith({ ticker: "abcd", effectiveDate: new Date("2026-06-10"), ratioNumerator: 4, ratioDenominator: 1, source: "issuer_disclosure", evidence: "sample evidence", confirmed: true });
  });
});

describe("helpers", () => {
  it("classify ordering groups the way confirmTransactionsWithOrdering resolves them", () => {
    const base = { ticker: "X", transactionDate: new Date("2026-01-01") };
    const inc = (k: string) => ({ clientRowKey: k, ...base });
    const ex = (order: number | null) => ({ id: `e${order}`, ...base, intraDayOrder: order, orderUnknownReason: null });
    const groups = orderingGroups(
      [
        { ...base, existing: [], incoming: [inc("1"), inc("2")] },
        { ...base, existing: [ex(null)], incoming: [inc("3")] },
        { ...base, existing: [ex(1)], incoming: [inc("4")] },
        { ...base, existing: [], incoming: [inc("5"), inc("6")] },
      ] as never,
      new Set(["6"])
    );
    expect(groups.map((g) => g.kind)).toEqual(["declarable", "existing", "existing_ordered"]); // the last group lost its only other member
    expect([...declarableKeys(groups)]).toEqual(["1", "2"]);
  });

  it("skip exact duplicates in file mode and rows answered 'same', and count unresolved rows like the server", () => {
    const rec = PREVIEW_VALIDATION.reconciliation;
    expect([...skippedKeys(rec, { "14": { action: "same", existingTransactionId: "man-1" } })].sort()).toEqual(["14", "20"]);
    expect(unresolvedCount(rec, {})).toBe(2);
    expect(unresolvedCount(rec, PREVIEW_RESOLVED)).toBe(0);
    expect(unresolvedCount(rec, { ...PREVIEW_RESOLVED, "15": { action: "same" } })).toBe(1);
  });
});
