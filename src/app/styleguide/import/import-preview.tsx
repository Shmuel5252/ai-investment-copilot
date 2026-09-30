"use client";

import { useState } from "react";
import { loaded } from "@/components/home/types";
import { ImportLayout, type ImportMode } from "@/components/import/import-view";
import { HistoryStatus } from "@/components/import/history-status";
import { DoneStep, MappingStep, ReviewStep, UploadStep } from "@/components/import/file-steps";
import { ManualEntryDone, ManualEntryForm } from "@/components/import/manual-entry";
import { StockSplits } from "@/components/import/stock-splits";
import type { OpeningStateDraft, ResolutionDraft } from "@/components/import/types";
import {
  PREVIEW_FILENAME,
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
  previewHistory,
  type ImportPreviewState,
} from "../import-preview-data";

// The production components on synthetic data, with local state so the
// review's choices and inputs respond. No procedure is ever called: every
// write action does nothing.
const noop = () => undefined;

export function ImportPreview({ state }: { state: ImportPreviewState }) {
  const manual = state === "manual" || state === "manual-done";
  const [mode, setMode] = useState<ImportMode>(manual ? "manual" : "file");
  const partial = state === "partial";
  const [resolutions, setResolutions] = useState<Record<string, ResolutionDraft>>(partial ? PREVIEW_RESOLVED : {});
  const [orders, setOrders] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<Record<string, OpeningStateDraft>>(
    partial ? { QRST: { ticker: "QRST", quantity: "12.5", costBasisPerShare: "131.40", costBasisConfidence: "approximate", asOfDate: "2026-06-30" } } : {}
  );
  const [manualRows, setManualRows] = useState(PREVIEW_MANUAL_ROWS);
  const [manualResolutions, setManualResolutions] = useState<Record<string, ResolutionDraft>>({});

  const file = (() => {
    if (state === "start" || state === "first") return <UploadStep onFile={noop} reading={false} />;
    if (state === "mapping")
      return <MappingStep filename={PREVIEW_FILENAME} preview={loaded(PREVIEW_PREVIEW)} mapping={PREVIEW_PREVIEW.suggestedMapping} onMapping={noop} onCheck={noop} onChangeFile={noop} />;
    if (state === "done") return <DoneStep result={PREVIEW_RESULT} filename={PREVIEW_FILENAME} openingSaved={1} onAnother={noop} />;
    return (
      <ReviewStep
        validation={loaded(partial ? PREVIEW_VALIDATION_CLEAN : PREVIEW_VALIDATION)}
        splitsCount={PREVIEW_SPLITS.length}
        resolutions={resolutions}
        onResolution={(k, d) => setResolutions((p) => ({ ...p, [k]: d }))}
        orders={orders}
        onOrder={(k, v) => setOrders((p) => ({ ...p, [k]: v }))}
        openingStates={opening}
        onOpening={(ticker, patch) =>
          setOpening((p) => ({ ...p, [ticker]: { ticker, quantity: "", costBasisPerShare: "", costBasisConfidence: "approximate", asOfDate: "2026-06-30", ...p[ticker], ...patch } }))
        }
        onBack={noop}
        confirm={{ run: noop, pending: false, error: partial ? PREVIEW_UNCERTAIN : null, needsRefresh: partial, refresh: noop, refreshing: false }}
      />
    );
  })();

  return (
    <ImportLayout
      history={<HistoryStatus history={previewHistory(state)} />}
      mode={mode}
      onMode={setMode}
      splits={<StockSplits list={loaded(PREVIEW_SPLITS)} actions={{ record: async () => false, pending: false, error: null }} />}
    >
      {mode === "file" && file}
      {mode === "manual" &&
        (state === "manual-done" ? (
          <ManualEntryDone result={PREVIEW_MANUAL_RESULT} onMore={noop} />
        ) : (
          <ManualEntryForm
            rows={manualRows}
            onRow={(i, patch) => setManualRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
            onAdd={noop}
            onRemove={noop}
            check={loaded(PREVIEW_MANUAL_CHECK)}
            resolutions={manualResolutions}
            onResolution={(k, d) => setManualResolutions((p) => ({ ...p, [k]: d }))}
            actions={{ submit: noop, pending: false, error: null, needsRefresh: false, refresh: noop, refreshing: false }}
          />
        ))}
    </ImportLayout>
  );
}
