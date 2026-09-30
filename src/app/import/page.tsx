"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import type { CanonicalField } from "@/lib/import/types";
import { ImportLayout, type ImportMode } from "@/components/import/import-view";
import { HistoryStatus } from "@/components/import/history-status";
import { DoneStep, MappingStep, ReviewStep, UploadStep, type Mapping } from "@/components/import/file-steps";
import { ManualEntryDone, ManualEntryForm, emptyManualRow, manualRowsComplete } from "@/components/import/manual-entry";
import { StockSplits } from "@/components/import/stock-splits";
import { declarableKeys, orderingGroups, skippedKeys, toResolutionPayload } from "@/components/import/reconciliation";
import { toWriteError, type ManualRowDraft, type OpeningStateDraft, type ResolutionDraft } from "@/components/import/types";

// /import — Frontend V1, unit 7B. This file holds the workflow state and
// runs the existing import procedures with their existing inputs; the
// screens live in src/components/import. Two details the page decides:
//   - only answers the server can accept are sent: order numbers for rows
//     in groups without a stored member (a declaration there is refused),
//     and opening states for the tickers the current check asked about;
//   - after a failed write that may have saved something, confirm waits
//     until the investor refreshes and sees the current state.

type Step = "upload" | "mapping" | "review" | "done";

export default function ImportPage() {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<ImportMode>("file");

  // --- file path ---
  const [step, setStep] = useState<Step>("upload");
  const [reading, setReading] = useState(false);
  const [filename, setFilename] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [openingStates, setOpeningStates] = useState<Record<string, OpeningStateDraft>>({});
  // keyed by the row's clientRowKey (String(rowIndex)), as validate returns it
  const [rowOrders, setRowOrders] = useState<Record<string, string>>({});
  const [csvResolutions, setCsvResolutions] = useState<Record<string, ResolutionDraft>>({});
  const [csvNeedsRefresh, setCsvNeedsRefresh] = useState(false);
  const [openingSaved, setOpeningSaved] = useState(0);

  // --- manual path ---
  const [manualRows, setManualRows] = useState<ManualRowDraft[]>([emptyManualRow()]);
  const [manualResolutions, setManualResolutions] = useState<Record<string, ResolutionDraft>>({});
  const [manualNeedsRefresh, setManualNeedsRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const history = trpc.import.history.useQuery();
  const splits = trpc.import.corporateActions.useQuery();
  const preview = trpc.import.preview.useQuery({ csvContent }, { enabled: csvContent.length > 0 });
  const validation = trpc.import.validate.useQuery({ csvContent, mapping }, { enabled: step === "review" && csvContent.length > 0 });
  const confirmImport = trpc.import.confirmImport.useMutation({ onSettled: () => utils.import.history.invalidate() });
  const confirmManual = trpc.import.confirmManualEntry.useMutation({ onSettled: () => utils.import.history.invalidate() });
  const recordSplit = trpc.import.recordStockSplit.useMutation({ onSettled: () => utils.import.corporateActions.invalidate() });

  const manualComplete = manualRowsComplete(manualRows);
  const manualCheck = trpc.import.checkManualEntry.useQuery(
    {
      rows: manualRows.map((r) => ({
        ticker: r.ticker.trim(),
        transactionType: r.transactionType,
        quantity: Number(r.quantity),
        price: Number(r.price),
        transactionDate: new Date(r.transactionDate),
      })),
    },
    { enabled: manualComplete && mode === "manual" }
  );

  // Pre-fill the mapping with the server's suggestion once, the first time
  // it arrives, never over the investor's own edits (setState during
  // render, guarded by the last-seen value: React's documented pattern).
  const suggestedMapping = preview.data?.suggestedMapping;
  const [lastSeenSuggestion, setLastSeenSuggestion] = useState(suggestedMapping);
  if (suggestedMapping !== lastSeenSuggestion) {
    setLastSeenSuggestion(suggestedMapping);
    if (suggestedMapping && Object.keys(mapping).length === 0) setMapping(suggestedMapping);
  }

  async function handleFile(file: File) {
    setReading(true);
    const content = await file.text();
    setReading(false);
    setFilename(file.name);
    setCsvContent(content);
    setMapping({});
    setLastSeenSuggestion(undefined);
    // Row-keyed answers and per-ticker drafts never outlive the file they were given for.
    setRowOrders({});
    setCsvResolutions({});
    setOpeningStates({});
    setCsvNeedsRefresh(false);
    confirmImport.reset();
    setStep("mapping");
  }

  function resetFile() {
    setCsvContent("");
    setFilename("");
    setMapping({});
    setLastSeenSuggestion(undefined);
    setRowOrders({});
    setCsvResolutions({});
    setOpeningStates({});
    setCsvNeedsRefresh(false);
    confirmImport.reset();
    setStep("upload");
  }

  function updateOpeningState(ticker: string, patch: Partial<OpeningStateDraft>) {
    setOpeningStates((prev) => ({
      ...prev,
      [ticker]: { ticker, quantity: "", costBasisPerShare: "", costBasisConfidence: "approximate", asOfDate: new Date().toISOString().slice(0, 10), ...prev[ticker], ...patch },
    }));
  }

  async function handleConfirm() {
    const v = validation.data;
    if (!v) return;
    const asked = new Set(v.tickersNeedingOpeningState);
    const openingPayload = Object.values(openingStates)
      .filter((os) => asked.has(os.ticker) && os.quantity.trim() !== "")
      .map((os) => ({
        ticker: os.ticker,
        quantity: Number(os.quantity),
        costBasisPerShare: os.costBasisPerShare.trim() === "" ? null : Number(os.costBasisPerShare),
        costBasisConfidence: os.costBasisConfidence,
        asOfDate: new Date(os.asOfDate),
      }));
    const declarable = declarableKeys(orderingGroups(v.collisionGroups, skippedKeys(v.reconciliation, csvResolutions)));
    const orderPayload = Object.fromEntries(
      Object.entries(rowOrders)
        .filter(([k, value]) => declarable.has(k) && value.trim() !== "")
        .map(([k, value]) => [k, Number(value)])
    );
    try {
      const result = await guard(
        () =>
          confirmImport.mutateAsync({
            csvContent,
            mapping,
            filename,
            openingStates: openingPayload,
            rowOrderDeclarations: orderPayload,
            reconciliationResolutions: toResolutionPayload(v.reconciliation, csvResolutions),
          }),
        "confirm-import"
      );
      // Success means every opening state in the request was inserted: the
      // server inserts them one by one after the transaction commits and
      // throws on the first failure.
      if (result) {
        setOpeningSaved(openingPayload.length);
        setStep("done");
      }
    } catch (err) {
      if (!toWriteError(err)?.refused) setCsvNeedsRefresh(true);
    }
  }

  async function handleManualSubmit() {
    const declarable = manualCheck.data
      ? declarableKeys(orderingGroups(manualCheck.data.collisionGroups, skippedKeys(manualCheck.data.reconciliation, manualResolutions)))
      : new Set<string>();
    const rows = manualRows.map((r, i) => ({
      ticker: r.ticker.trim(),
      transactionType: r.transactionType,
      quantity: Number(r.quantity),
      price: Number(r.price),
      transactionDate: new Date(r.transactionDate),
      notes: r.notes.trim() === "" ? undefined : r.notes.trim(),
      intraDayOrder: declarable.has(String(i)) && r.intraDayOrder.trim() !== "" ? Number(r.intraDayOrder) : undefined,
    }));
    try {
      const result = await guard(() => confirmManual.mutateAsync({ rows, resolutions: toResolutionPayload(manualCheck.data?.reconciliation, manualResolutions) }), "manual-entry");
      if (result) {
        setManualRows([emptyManualRow()]);
        setManualResolutions({});
      }
    } catch (err) {
      if (!toWriteError(err)?.refused) setManualNeedsRefresh(true);
    }
  }

  // Re-reads the stored state the failed write may have changed: history,
  // and the preview that is compared against it.
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([history.refetch(), splits.refetch(), step === "review" ? validation.refetch() : null, manualComplete ? manualCheck.refetch() : null]);
      setCsvNeedsRefresh(false);
      setManualNeedsRefresh(false);
      confirmImport.reset();
      confirmManual.reset();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main>
      <ImportLayout
        history={<HistoryStatus history={history} />}
        mode={mode}
        onMode={setMode}
        splits={
          <StockSplits
            list={splits}
            actions={{
              record: async (input) => {
                try {
                  return (await guard(() => recordSplit.mutateAsync(input), "record-stock-split")) !== undefined;
                } catch {
                  return false;
                }
              },
              pending: recordSplit.isPending,
              error: toWriteError(recordSplit.error),
            }}
          />
        }
      >
        {mode === "file" && step === "upload" && <UploadStep onFile={(f) => void handleFile(f)} reading={reading} />}
        {mode === "file" && step === "mapping" && (
          <MappingStep
            filename={filename}
            preview={preview}
            mapping={mapping}
            onMapping={(field: CanonicalField, header) => setMapping((prev) => ({ ...prev, [field]: header }))}
            onCheck={() => setStep("review")}
            onChangeFile={resetFile}
          />
        )}
        {mode === "file" && step === "review" && (
          <ReviewStep
            validation={validation}
            splitsCount={splits.data ? splits.data.length : null}
            resolutions={csvResolutions}
            onResolution={(k, d) => setCsvResolutions((prev) => ({ ...prev, [k]: d }))}
            orders={rowOrders}
            onOrder={(k, value) => setRowOrders((prev) => ({ ...prev, [k]: value }))}
            openingStates={openingStates}
            onOpening={updateOpeningState}
            onBack={() => setStep("mapping")}
            confirm={{
              run: () => void handleConfirm(),
              pending: confirmImport.isPending,
              error: toWriteError(confirmImport.error),
              needsRefresh: csvNeedsRefresh,
              refresh: () => void refresh(),
              refreshing,
            }}
          />
        )}
        {mode === "file" && step === "done" && confirmImport.data && <DoneStep result={confirmImport.data} filename={filename} openingSaved={openingSaved} onAnother={resetFile} />}

        {mode === "manual" &&
          (confirmManual.data ? (
            <ManualEntryDone
              result={confirmManual.data}
              onMore={() => {
                confirmManual.reset();
                setManualRows([emptyManualRow()]);
              }}
            />
          ) : (
            <ManualEntryForm
              rows={manualRows}
              onRow={(i, patch) => setManualRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)))}
              onAdd={() => setManualRows((prev) => [...prev, emptyManualRow()])}
              onRemove={(i) => setManualRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
              check={manualComplete ? manualCheck : null}
              resolutions={manualResolutions}
              onResolution={(k, d) => setManualResolutions((prev) => ({ ...prev, [k]: d }))}
              actions={{
                submit: () => void handleManualSubmit(),
                pending: confirmManual.isPending,
                error: toWriteError(confirmManual.error),
                needsRefresh: manualNeedsRefresh,
                refresh: () => void refresh(),
                refreshing,
              }}
            />
          ))}
      </ImportLayout>
    </main>
  );
}
