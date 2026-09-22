"use client";

import { useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/import/types";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import {
  importFieldLabel,
  importPage as t,
  manualEntryPage as m,
  collisionResolution as cr,
  reconciliation as rc,
  historyFreshness as hf,
  tellMeWhy as ttw,
  costBasisConfidenceLabel,
  common,
  nav,
} from "@/lib/i18n/strings";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Reconciliation = inferRouterOutputs<AppRouter>["import"]["validate"]["reconciliation"];
type ReconciliationRow = Reconciliation["rows"][number];
type HistoryFreshness = inferRouterOutputs<AppRouter>["import"]["history"];
/** The investor's answer for one flagged row — sent to confirm as-is; the server re-verifies it under the lock. */
type ResolutionDraft = { action: "same" | "separate"; existingTransactionId?: string };

const formatDay = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
const typeLabel = (type: string) => (type === "buy" ? m.buyOption : type === "sell" ? m.sellOption : type);

function rowFacts(f: ReconciliationRow["incoming"] | ReconciliationRow["candidates"][number]) {
  const tradeFacts = f.quantity !== null && f.price !== null ? ` · ${f.quantity} @ $${Number(f.price).toFixed(2)}` : ` · $${Number(f.amount).toFixed(2)}`;
  return `${f.ticker ?? "—"} · ${typeLabel(f.transactionType)} · ${formatDay(f.transactionDate)}${tradeFacts}`;
}

// Every row still needing an answer must have a complete one before the
// server will accept the batch (planInsertions fails closed); mirror that
// here so the button is only enabled when confirm can succeed.
function unresolvedCount(reconciliation: Reconciliation | undefined, drafts: Record<string, ResolutionDraft>) {
  if (!reconciliation) return 0;
  return reconciliation.rows.filter((r) => {
    if (!r.requiresResolution) return false;
    const d = drafts[r.clientRowKey];
    if (!d) return true;
    return d.action === "same" && r.class !== "exact_duplicate" && !d.existingTransactionId;
  }).length;
}

function toResolutionPayload(reconciliation: Reconciliation | undefined, drafts: Record<string, ResolutionDraft>) {
  if (!reconciliation) return [];
  return reconciliation.rows
    .filter((r) => r.requiresResolution && drafts[r.clientRowKey])
    .map((r) => {
      const d = drafts[r.clientRowKey]!;
      return {
        clientRowKey: r.clientRowKey,
        identityKey: r.identityKey,
        action: d.action,
        existingTransactionId: d.action === "same" && r.class !== "exact_duplicate" ? d.existingTransactionId : undefined,
      };
    });
}

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

type Mode = "file" | "manual";
type Step = "upload" | "mapping" | "review" | "done";

interface ManualRowDraft {
  ticker: string;
  transactionType: "buy" | "sell";
  quantity: string;
  price: string;
  transactionDate: string;
  notes: string;
  /** Same-day ordering (Investment Episode Independence design) — only shown/used when this row is part of a detected collision group. Empty = no declaration. */
  intraDayOrder: string;
}

function emptyManualRow(): ManualRowDraft {
  return {
    ticker: "",
    transactionType: "buy",
    quantity: "",
    price: "",
    transactionDate: new Date().toISOString().slice(0, 10),
    notes: "",
    intraDayOrder: "",
  };
}

interface OpeningStateDraft {
  ticker: string;
  quantity: string;
  costBasisPerShare: string;
  costBasisConfidence: "known" | "approximate" | "unknown";
  asOfDate: string;
}

export default function ImportPage() {
  const guard = useSubmitGuard();
  const [mode, setMode] = useState<Mode>("file");
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<CanonicalField, string>>>({});
  const [openingStates, setOpeningStates] = useState<Record<string, OpeningStateDraft>>({});
  // Same-day ordering declarations for CSV import — keyed by rowIndex
  // (string), matching collisionGroups' incoming[].clientRowKey exactly
  // (both derive from NormalizedTransactionRow.rowIndex).
  const [rowOrderDeclarations, setRowOrderDeclarations] = useState<Record<string, string>>({});
  // Reconciliation answers (History Refresh V1), keyed like
  // rowOrderDeclarations — by the row's clientRowKey from the preview.
  const [csvResolutions, setCsvResolutions] = useState<Record<string, ResolutionDraft>>({});
  const [manualResolutions, setManualResolutions] = useState<Record<string, ResolutionDraft>>({});
  const [manualRows, setManualRows] = useState<ManualRowDraft[]>([emptyManualRow()]);

  const utils = trpc.useUtils();
  const history = trpc.import.history.useQuery();
  const preview = trpc.import.preview.useQuery({ csvContent }, { enabled: csvContent.length > 0 });
  const validation = trpc.import.validate.useQuery(
    { csvContent, mapping },
    { enabled: step === "review" && csvContent.length > 0 }
  );
  const confirmImport = trpc.import.confirmImport.useMutation({ onSuccess: () => utils.import.history.invalidate() });
  const confirmManualEntry = trpc.import.confirmManualEntry.useMutation({ onSuccess: () => utils.import.history.invalidate() });

  // Same-day collision preview for manual entry — only fires once every
  // current row is complete enough to validate server-side (positional
  // index correlation with manualRows must stay exact, so partial rows
  // can't be filtered out before sending).
  const manualRowsComplete =
    manualRows.length > 0 &&
    manualRows.every(
      (r) => r.ticker.trim() !== "" && Number(r.quantity) > 0 && Number(r.price) > 0 && r.transactionDate !== ""
    );
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
    { enabled: manualRowsComplete && mode === "manual" }
  );
  const manualCollisions = manualCheck.data?.collisionGroups ?? [];
  const manualReconciliation = manualCheck.data?.reconciliation;
  const manualUnresolved = unresolvedCount(manualReconciliation, manualResolutions);
  const csvUnresolved = unresolvedCount(validation.data?.reconciliation, csvResolutions);
  // Rows reconciliation will skip never reach ordering, so they get no
  // order input in the collision groups either.
  const csvSkippedKeys = new Set(
    (validation.data?.reconciliation.rows ?? [])
      .filter((r) => r.class === "exact_duplicate" || csvResolutions[r.clientRowKey]?.action === "same")
      .map((r) => r.clientRowKey)
  );

  // Pre-fill the mapping form with the server's best guess, once, the
  // first time it arrives — never overwrites edits the user has already
  // made. This is React's documented pattern for "adjust state when a
  // value from elsewhere changes" (react.dev/learn/you-might-not-need-an-effect
  // #adjusting-some-state-when-a-prop-changes): setState during render,
  // guarded by comparing against the last-seen value, not a useEffect —
  // an effect here would cause an extra, visible re-render.
  const suggestedMapping = preview.data?.suggestedMapping;
  const [lastSeenSuggestion, setLastSeenSuggestion] = useState(suggestedMapping);
  if (suggestedMapping !== lastSeenSuggestion) {
    setLastSeenSuggestion(suggestedMapping);
    if (suggestedMapping && Object.keys(mapping).length === 0) {
      setMapping(suggestedMapping);
    }
  }

  async function handleFile(file: File) {
    const content = await file.text();
    setFilename(file.name);
    setCsvContent(content);
    // A previous file's row-index-keyed order declarations must never
    // survive into a new file — row 5 of file A and row 5 of file B are
    // unrelated transactions, and a stale declaration here would be
    // silently pre-filled into a new, unrelated collision group's input
    // (pre-commit raw-diff review finding, this session). openingStates
    // isn't touched here: same pre-existing pattern, out of this fix's
    // narrow scope.
    setRowOrderDeclarations({});
    setCsvResolutions({}); // same reasoning: row-keyed answers never outlive the file they were given for
    setStep("mapping");
  }

  function startReview() {
    setStep("review");
  }

  function updateOpeningState(ticker: string, patch: Partial<OpeningStateDraft>) {
    setOpeningStates((prev) => ({
      ...prev,
      [ticker]: {
        ticker,
        quantity: "",
        costBasisPerShare: "",
        costBasisConfidence: "approximate",
        asOfDate: new Date().toISOString().slice(0, 10),
        ...prev[ticker],
        ...patch,
      },
    }));
  }

  async function handleConfirm() {
    const openingStatesPayload = Object.values(openingStates)
      .filter((os) => os.quantity.trim() !== "")
      .map((os) => ({
        ticker: os.ticker,
        quantity: Number(os.quantity),
        costBasisPerShare: os.costBasisPerShare.trim() === "" ? null : Number(os.costBasisPerShare),
        costBasisConfidence: os.costBasisConfidence,
        asOfDate: new Date(os.asOfDate),
      }));

    const rowOrderPayload = Object.fromEntries(
      Object.entries(rowOrderDeclarations)
        .filter(([, v]) => v.trim() !== "")
        .map(([k, v]) => [k, Number(v)])
    );

    // The exact button a real double-click duplicated a full import
    // through (see git history) — guarded now, not just disabled-on-
    // isPending (see src/lib/use-submit-guard.ts for why that alone
    // wasn't enough).
    const result = await guard(() =>
      confirmImport.mutateAsync({
        csvContent,
        mapping,
        filename,
        openingStates: openingStatesPayload,
        rowOrderDeclarations: rowOrderPayload,
        reconciliationResolutions: toResolutionPayload(validation.data?.reconciliation, csvResolutions),
      })
    );
    if (result) setStep("done");
  }

  function updateManualRow(index: number, patch: Partial<ManualRowDraft>) {
    setManualRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addManualRow() {
    setManualRows((prev) => [...prev, emptyManualRow()]);
  }

  function removeManualRow(index: number) {
    setManualRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleManualSubmit() {
    const rows = manualRows.map((r) => ({
      ticker: r.ticker.trim(),
      transactionType: r.transactionType,
      quantity: Number(r.quantity),
      price: Number(r.price),
      transactionDate: new Date(r.transactionDate),
      notes: r.notes.trim() === "" ? undefined : r.notes.trim(),
      intraDayOrder: r.intraDayOrder.trim() === "" ? undefined : Number(r.intraDayOrder),
    }));

    // Same double-submit guard as the CSV path above, keyed separately
    // (src/lib/use-submit-guard.ts) — an unrelated action, must not
    // block or be blocked by the file-import button.
    const result = await guard(
      () => confirmManualEntry.mutateAsync({ rows, resolutions: toResolutionPayload(manualReconciliation, manualResolutions) }),
      "manual-entry"
    );
    if (result) {
      setManualRows([emptyManualRow()]);
      setManualResolutions({});
    }
  }

  return (
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 text-journal-ink`}
    >
      <BackLink href="/" label={nav.home} />

      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>{t.title}</h1>
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      {history.data && <FreshnessBlock history={history.data} />}

      <div className="flex gap-2 border-b border-journal-rule">
        <button
          onClick={() => setMode("file")}
          className={`px-3 py-2 text-sm font-medium ${
            mode === "file"
              ? "border-b-2 border-journal-accent text-journal-ink"
              : "text-journal-muted"
          }`}
        >
          {t.fileModeTab}
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`px-3 py-2 text-sm font-medium ${
            mode === "manual"
              ? "border-b-2 border-journal-accent text-journal-ink"
              : "text-journal-muted"
          }`}
        >
          {t.manualModeTab}
        </button>
      </div>

      {mode === "file" && step === "upload" && (
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      )}

      {mode === "file" && step === "mapping" && preview.data && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <Num>{preview.data.rowCount}</Num> {t.rowsDetectedLabel}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {CANONICAL_FIELDS.map((field) => (
                <tr key={field}>
                  <td className="py-1 pl-4 font-medium">{importFieldLabel[field]}</td>
                  <td>
                    <select
                      className="rounded border border-journal-rule bg-journal-surface px-2 py-1"
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))
                      }
                    >
                      <option value="">{t.notMappedOption}</option>
                      {preview.data.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <details className="text-xs text-journal-muted">
            <summary>{t.previewFirstRows}</summary>
            <pre dir="ltr" className="mt-2 overflow-x-auto rounded bg-journal-bg p-2 text-left">
              {JSON.stringify(preview.data.previewRows, null, 2)}
            </pre>
          </details>

          <button
            onClick={startReview}
            disabled={!mapping.date || !mapping.type}
            className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t.validateButton}
          </button>
        </div>
      )}

      {mode === "file" && step === "review" && (
        <div className="flex flex-col gap-4">
          {validation.isLoading && <p>{t.validatingLabel}</p>}
          {validation.data && (
            <>
              <p className="text-sm">
                <Num>{validation.data.validCount}</Num> {t.validRowsLabel}{" "}
                <Num>{validation.data.invalidRows.length}</Num> {t.invalidRowsLabel}
              </p>

              {validation.data.invalidRows.length > 0 && (
                <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
                  <p className="font-medium">{t.fixRowsInstruction}</p>
                  <ul className="mt-1 list-disc pr-5">
                    {validation.data.invalidRows.slice(0, 10).map((r) => (
                      <li key={r.rowIndex}>
                        {t.rowLabel} <Num>{r.rowIndex + 1}</Num>: {r.errors.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.data.tickersNeedingOpeningState.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">{t.openingStateInstruction}</p>
                  <div className="mt-3 flex flex-col gap-3">
                    {validation.data.tickersNeedingOpeningState.map((ticker) => {
                      const draft = openingStates[ticker];
                      return (
                        <div key={ticker} className="flex flex-wrap items-center gap-2">
                          <span className="w-16 font-medium">{ticker}</span>
                          <input
                            type="number"
                            placeholder={t.quantityPlaceholder}
                            className="w-24 rounded border border-journal-rule px-2 py-1"
                            value={draft?.quantity ?? ""}
                            onChange={(e) => updateOpeningState(ticker, { quantity: e.target.value })}
                          />
                          <input
                            type="number"
                            placeholder={t.costBasisPlaceholder}
                            className="w-32 rounded border border-journal-rule px-2 py-1"
                            value={draft?.costBasisPerShare ?? ""}
                            onChange={(e) =>
                              updateOpeningState(ticker, { costBasisPerShare: e.target.value })
                            }
                          />
                          <select
                            className="rounded border border-journal-rule px-2 py-1"
                            value={draft?.costBasisConfidence ?? "approximate"}
                            onChange={(e) =>
                              updateOpeningState(ticker, {
                                costBasisConfidence: e.target.value as OpeningStateDraft["costBasisConfidence"],
                              })
                            }
                          >
                            <option value="known">{costBasisConfidenceLabel.known}</option>
                            <option value="approximate">{costBasisConfidenceLabel.approximate}</option>
                            <option value="unknown">{costBasisConfidenceLabel.unknown}</option>
                          </select>
                          <input
                            type="date"
                            className="rounded border border-journal-rule px-2 py-1"
                            value={draft?.asOfDate ?? new Date().toISOString().slice(0, 10)}
                            onChange={(e) => updateOpeningState(ticker, { asOfDate: e.target.value })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <ReconciliationPanel
                reconciliation={validation.data.reconciliation}
                drafts={csvResolutions}
                onChange={(key, draft) => setCsvResolutions((prev) => ({ ...prev, [key]: draft }))}
              />

              {validation.data.collisionGroups.some((g) => g.incoming.some((inc) => !csvSkippedKeys.has(inc.clientRowKey))) && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">{cr.heading}</p>
                  <p className="mt-1 text-xs text-journal-muted">{cr.explanation}</p>
                  <div className="mt-3 flex flex-col gap-3">
                    {validation.data.collisionGroups
                      .filter((g) => g.incoming.some((inc) => !csvSkippedKeys.has(inc.clientRowKey)))
                      .map((group) => (
                      <div
                        key={`${group.ticker}-${new Date(group.transactionDate).toISOString()}`}
                        className="flex flex-col gap-1 rounded border border-journal-rule p-2"
                      >
                        <span className="font-medium">
                          {group.ticker} — {new Date(group.transactionDate).toISOString().slice(0, 10)}
                        </span>
                        {group.existing.map((ex) => (
                          <span key={ex.id} className="text-xs text-journal-muted">
                            {cr.existingRowLabel}
                          </span>
                        ))}
                        {group.incoming.filter((inc) => !csvSkippedKeys.has(inc.clientRowKey)).map((inc) => (
                          <label key={inc.clientRowKey} className="flex items-center gap-2 text-xs">
                            {t.rowLabel} <Num>{Number(inc.clientRowKey) + 1}</Num>
                            <input
                              type="number"
                              placeholder={cr.orderPlaceholder}
                              className="w-16 rounded border border-journal-rule px-2 py-1"
                              value={rowOrderDeclarations[inc.clientRowKey] ?? ""}
                              onChange={(e) =>
                                setRowOrderDeclarations((prev) => ({ ...prev, [inc.clientRowKey]: e.target.value }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleConfirm}
                disabled={validation.data.invalidRows.length > 0 || csvUnresolved > 0 || confirmImport.isPending}
                className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {confirmImport.isPending ? t.importingButton : t.confirmImportButton}
              </button>
              {confirmImport.isError && (
                <p className="text-sm text-red-600">{confirmImport.error.message}</p>
              )}
            </>
          )}
        </div>
      )}

      {mode === "file" && step === "done" && confirmImport.data && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <Num>{confirmImport.data.importedCount}</Num> {t.importedLabel}
          </p>
          {confirmImport.data.skippedExactCount > 0 && (
            <p className="text-sm text-journal-muted">
              <Num>{confirmImport.data.skippedExactCount}</Num> {t.skippedExactLabel}
            </p>
          )}
          {confirmImport.data.skippedSameCount > 0 && (
            <p className="text-sm text-journal-muted">
              <Num>{confirmImport.data.skippedSameCount}</Num> {t.skippedSameLabel}
            </p>
          )}
          <div>
            <p className="text-sm font-medium">{t.currentPositions}</p>
            <ul className="mt-1 text-sm">
              {confirmImport.data.positions.positions.map((p) => (
                <li key={p.ticker}>
                  {p.ticker}: <Num>{p.quantity}</Num> · {common.avgCostLabel}{" "}
                  <Num>{p.costBasisPerShare?.toFixed(2)}</Num> (
                  {costBasisConfidenceLabel[p.costBasisConfidence] ?? p.costBasisConfidence})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm">
              {common.cashLabel}: <Num>{confirmImport.data.positions.cash.toFixed(2)}</Num>
            </p>
          </div>
        </div>
      )}

      {mode === "manual" && !confirmManualEntry.data && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-journal-muted">{m.description}</p>

          <div className="flex flex-col gap-3">
            {manualRows.map((row, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-2 rounded border border-journal-rule p-3"
              >
                <label className="flex flex-col text-xs">
                  {m.tickerLabel}
                  <input
                    type="text"
                    className="w-24 rounded border border-journal-rule px-2 py-1"
                    value={row.ticker}
                    onChange={(e) => updateManualRow(index, { ticker: e.target.value })}
                  />
                </label>
                <label className="flex flex-col text-xs">
                  {m.typeLabel}
                  <select
                    className="rounded border border-journal-rule px-2 py-1"
                    value={row.transactionType}
                    onChange={(e) =>
                      updateManualRow(index, {
                        transactionType: e.target.value as ManualRowDraft["transactionType"],
                      })
                    }
                  >
                    <option value="buy">{m.buyOption}</option>
                    <option value="sell">{m.sellOption}</option>
                  </select>
                </label>
                <label className="flex flex-col text-xs">
                  {m.quantityLabel}
                  <input
                    type="number"
                    step="any"
                    className="w-24 rounded border border-journal-rule px-2 py-1"
                    value={row.quantity}
                    onChange={(e) => updateManualRow(index, { quantity: e.target.value })}
                  />
                </label>
                <label className="flex flex-col text-xs">
                  {m.priceLabel}
                  <input
                    type="number"
                    step="any"
                    className="w-24 rounded border border-journal-rule px-2 py-1"
                    value={row.price}
                    onChange={(e) => updateManualRow(index, { price: e.target.value })}
                  />
                </label>
                <label className="flex flex-col text-xs">
                  {m.dateLabel}
                  <input
                    type="date"
                    className="rounded border border-journal-rule px-2 py-1"
                    value={row.transactionDate}
                    onChange={(e) => updateManualRow(index, { transactionDate: e.target.value })}
                  />
                </label>
                <label className="flex min-w-56 flex-1 flex-col text-xs">
                  {m.notesLabel}
                  <input
                    type="text"
                    placeholder={m.notesPlaceholder}
                    className="rounded border border-journal-rule px-2 py-1"
                    value={row.notes}
                    onChange={(e) => updateManualRow(index, { notes: e.target.value })}
                  />
                </label>
                <button
                  onClick={() => removeManualRow(index)}
                  disabled={manualRows.length === 1}
                  className="rounded border border-journal-rule px-2 py-1 text-xs disabled:opacity-40"
                >
                  {m.removeRowButton}
                </button>
              </div>
            ))}
          </div>

          {manualReconciliation && (
            <ReconciliationPanel
              reconciliation={manualReconciliation}
              drafts={manualResolutions}
              onChange={(key, draft) => setManualResolutions((prev) => ({ ...prev, [key]: draft }))}
            />
          )}

          {manualCollisions.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium">{cr.heading}</p>
              <p className="mt-1 text-xs text-journal-muted">{cr.explanation}</p>
              <div className="mt-3 flex flex-col gap-3">
                {manualCollisions.map((group) => (
                  <div
                    key={`${group.ticker}-${new Date(group.transactionDate).toISOString()}`}
                    className="flex flex-col gap-1 rounded border border-journal-rule p-2"
                  >
                    <span className="font-medium">
                      {group.ticker} — {new Date(group.transactionDate).toISOString().slice(0, 10)}
                    </span>
                    {group.existing.map((ex) => (
                      <span key={ex.id} className="text-xs text-journal-muted">
                        {cr.existingRowLabel}
                      </span>
                    ))}
                    {group.incoming.map((inc) => {
                      const rowIndex = Number(inc.clientRowKey);
                      return (
                        <label key={inc.clientRowKey} className="flex items-center gap-2 text-xs">
                          {t.rowLabel} <Num>{rowIndex + 1}</Num>
                          <input
                            type="number"
                            placeholder={cr.orderPlaceholder}
                            className="w-16 rounded border border-journal-rule px-2 py-1"
                            value={manualRows[rowIndex]?.intraDayOrder ?? ""}
                            onChange={(e) => updateManualRow(rowIndex, { intraDayOrder: e.target.value })}
                          />
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={addManualRow}
              className="w-fit rounded border border-journal-rule px-3 py-2 text-sm"
            >
              {m.addRowButton}
            </button>
            <button
              onClick={handleManualSubmit}
              disabled={confirmManualEntry.isPending || manualUnresolved > 0}
              className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {confirmManualEntry.isPending ? m.savingButton : m.submitButton}
            </button>
          </div>
          {confirmManualEntry.isError && (
            <p className="text-sm text-red-600">{confirmManualEntry.error.message}</p>
          )}
        </div>
      )}

      {mode === "manual" && confirmManualEntry.data && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <Num>{confirmManualEntry.data.transactions.length}</Num> {m.savedCountLabel}
          </p>
          {confirmManualEntry.data.skippedCount > 0 && (
            <p className="text-sm text-journal-muted">
              <Num>{confirmManualEntry.data.skippedCount}</Num> {m.skippedCountLabel}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {confirmManualEntry.data.transactions.map((txn) => (
              <div key={txn.id} className="rounded border border-journal-rule p-3">
                <p className="text-sm">
                  {txn.ticker} — {txn.transactionType === "buy" ? m.buyOption : m.sellOption} ·{" "}
                  <Num>{txn.quantity}</Num> @ <Num>{Number(txn.price).toFixed(2)}</Num> ·{" "}
                  {new Date(txn.transactionDate).toISOString().slice(0, 10)}
                </p>
                <p className="mt-1 text-xs text-journal-muted" title={m.provenanceExplanation}>
                  {m.provenanceBadge}
                </p>
                {txn.ticker && <TellMeWhyPanel transactionId={txn.id} />}
              </div>
            ))}
          </div>

          <div>
            <p className="text-sm font-medium">{t.currentPositions}</p>
            <ul className="mt-1 text-sm">
              {confirmManualEntry.data.positions.positions.map((p) => (
                <li key={p.ticker}>
                  {p.ticker}: <Num>{p.quantity}</Num> · {common.avgCostLabel}{" "}
                  <Num>{p.costBasisPerShare?.toFixed(2)}</Num> (
                  {costBasisConfidenceLabel[p.costBasisConfidence] ?? p.costBasisConfidence})
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={() => {
              confirmManualEntry.reset();
              setManualRows([emptyManualRow()]);
            }}
            className="w-fit rounded border border-journal-rule px-3 py-2 text-sm"
          >
            {m.enterMoreButton}
          </button>
        </div>
      )}
    </main>
  );
}

// History freshness (History Refresh V1) — plain facts from
// import.history; the wording never claims more than the latest persisted
// transaction date.
function FreshnessBlock({ history }: { history: HistoryFreshness }) {
  if (!history.latestTransactionDate) {
    return <p className="rounded border border-journal-rule bg-journal-bg p-3 text-sm text-journal-muted">{hf.noHistory}</p>;
  }
  const batch = history.latestBatch;
  return (
    <div className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-bg p-3 text-sm">
      <p className="font-medium">{hf.title}</p>
      <p>
        {hf.upToDatePrefix} <Num>{formatDay(history.latestTransactionDate)}</Num>
        {history.ageDays !== null && (
          <>
            {" · "}
            {history.ageDays === 0 ? (
              hf.ageToday
            ) : (
              <>
                {hf.agePrefix} <Num>{history.ageDays}</Num> {hf.ageSuffixDays}
              </>
            )}
          </>
        )}
        {" · "}
        <Num>{history.transactionCount}</Num> {hf.transactionsSuffix}
      </p>
      {batch && (
        <p className="text-xs text-journal-muted">
          {hf.latestBatchPrefix} <Num>{batch.filename}</Num> ({formatDay(batch.uploadedAt)})
          {batch.windowStart && batch.windowEnd && (
            <>
              {" · "}
              {hf.latestBatchWindow} <Num>{formatDay(batch.windowStart)}</Num> {hf.latestBatchTo} <Num>{formatDay(batch.windowEnd)}</Num>
            </>
          )}
          {" · "}
          <Num>{batch.rowCount}</Num> {hf.latestBatchRows}
        </p>
      )}
      {history.manualEntry.count > 0 && history.manualEntry.latestDate && (
        <p className="text-xs text-journal-muted">
          {hf.manualPrefix} <Num>{history.manualEntry.count}</Num> {hf.manualSuffix}
          <Num>{formatDay(history.manualEntry.latestDate)}</Num>
        </p>
      )}
      <p className="text-xs text-journal-muted">{hf.disclaimer}</p>
    </div>
  );
}

// Reconciliation review (History Refresh V1) — one panel for both CSV
// review and manual entry: the classification summary, and a decision
// control for every row the server says needs one. It only collects the
// investor's answers; the server re-derives everything at confirm time.
function ReconciliationPanel({
  reconciliation,
  drafts,
  onChange,
}: {
  reconciliation: Reconciliation;
  drafts: Record<string, ResolutionDraft>;
  onChange: (clientRowKey: string, draft: ResolutionDraft) => void;
}) {
  const manual = reconciliation.mode === "manual_entry";
  const flagged = reconciliation.rows.filter((r) => r.requiresResolution);
  const willInsert =
    reconciliation.counts.new + flagged.filter((r) => drafts[r.clientRowKey]?.action === "separate").length;
  const unresolved = unresolvedCount(reconciliation, drafts);
  const nothingToSay = reconciliation.counts.exact_duplicate === 0 && flagged.length === 0;
  if (nothingToSay && manual) return null;

  return (
    <div className={`rounded border p-3 text-sm ${flagged.length > 0 ? "border-amber-300 bg-amber-50" : "border-journal-rule bg-journal-bg"}`}>
      <p className="font-medium">{rc.heading}</p>
      <p className="mt-1 text-xs text-journal-muted">{rc.explanation}</p>
      <p className="mt-2 text-xs">
        <Num>{reconciliation.counts.new}</Num> {rc.newCount} · <Num>{reconciliation.counts.exact_duplicate}</Num> {rc.exactCount}
        {" · "}
        <Num>{reconciliation.counts.probable_manual_match}</Num> {rc.probableCount} · <Num>{reconciliation.counts.ambiguous}</Num>{" "}
        {rc.ambiguousCount}
      </p>
      <p className="mt-1 text-xs font-medium">
        {rc.willInsertPrefix} <Num>{willInsert}</Num> {rc.willInsertSuffix}
      </p>
      {unresolved > 0 && <p className="mt-1 text-xs text-red-700">{rc.unresolvedNote}</p>}

      {flagged.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {flagged.map((row) => {
            const draft = drafts[row.clientRowKey];
            const exact = row.class === "exact_duplicate";
            const sameLabel = manual ? rc.manualSameChoice : rc.sameChoice;
            const separateLabel = manual || exact ? rc.manualSeparateChoice : rc.separateChoice;
            return (
              <div key={row.clientRowKey} className="flex flex-col gap-1 rounded border border-journal-rule bg-journal-surface p-2">
                <p className="text-xs font-medium">
                  {rc.rowPrefix} <Num>{Number(row.clientRowKey) + 1}</Num>: <Num>{rowFacts(row.incoming)}</Num>
                </p>
                <p className="text-xs text-journal-muted">
                  {exact ? (row.withinBatch ? rc.exactWithinBatchNote : rc.exactRowNote) : row.class === "ambiguous" ? rc.ambiguousRowNote : rc.probableRowNote}
                </p>
                {row.class === "probable_manual_match" && row.candidates[0] && (
                  <p className="text-xs text-journal-muted">
                    {rc.candidateLabel} <Num>{rowFacts(row.candidates[0])}</Num> ({row.candidates[0].source === "manual_entry" ? rc.manualSource : rc.csvSource})
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name={`rc-${reconciliation.mode}-${row.clientRowKey}`}
                    checked={draft?.action === "same"}
                    onChange={() =>
                      onChange(row.clientRowKey, {
                        action: "same",
                        existingTransactionId: row.class === "probable_manual_match" ? row.candidates[0]?.id : draft?.existingTransactionId,
                      })
                    }
                  />
                  {sameLabel}
                </label>
                {row.class === "ambiguous" && draft?.action === "same" && (
                  <select
                    className="rounded border border-journal-rule px-2 py-1 text-xs"
                    value={draft.existingTransactionId ?? ""}
                    onChange={(e) => onChange(row.clientRowKey, { action: "same", existingTransactionId: e.target.value || undefined })}
                  >
                    <option value="">{rc.chooseCandidate}</option>
                    {row.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {rowFacts(c)} ({c.source === "manual_entry" ? rc.manualSource : rc.csvSource})
                      </option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name={`rc-${reconciliation.mode}-${row.clientRowKey}`}
                    checked={draft?.action === "separate"}
                    onChange={() => onChange(row.clientRowKey, { action: "separate" })}
                  />
                  {separateLabel}
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Local to this page — not a shared component. Two separate things,
// don't conflate them (docs/backlog.md, Product decision 2026-09-08):
// (1) the server CONTRACT for "Tell me why" (interview.startTellMeWhy)
// is broad — any transaction the investor owns with
// source="manual_entry", no time limit, no batch check at all. (2) this
// UI only RENDERS the button here, right after a manual-entry submit,
// for a purely presentational reason: there's no "all my manual
// transactions" history screen yet to surface it from elsewhere. That's
// a UI gap to fill later, not a restriction this component is enforcing
// on purpose.
function TellMeWhyPanel({ transactionId }: { transactionId: string }) {
  const guard = useSubmitGuard();
  const [phase, setPhase] = useState<"idle" | "answering" | "done">("idle");
  // anchorTransactionId comes back from the server (Episode Journal V1): the
  // rationale is persisted against the episode's entry BUY, which may differ
  // from the manual row that was just entered (e.g. a manual SELL closing an
  // imported position) — same rule as /journal.
  const [session, setSession] = useState<{ sessionId: string; anchorTransactionId: string; questionText: string } | null>(null);
  const [answerText, setAnswerText] = useState("");

  const startMutation = trpc.interview.startTellMeWhy.useMutation();
  const answerMutation = trpc.interview.answer.useMutation();
  const completeMutation = trpc.interview.complete.useMutation();

  async function handleStart() {
    const result = await guard(
      () => startMutation.mutateAsync({ transactionId }),
      `tell-me-why-start-${transactionId}`
    );
    if (result) {
      setSession({ sessionId: result.sessionId, anchorTransactionId: result.transactionId, questionText: result.questionText });
      setPhase("answering");
    }
  }

  async function handleSave() {
    if (!session || answerText.trim() === "") return;
    const result = await guard(async () => {
      await answerMutation.mutateAsync({
        sessionId: session.sessionId,
        transactionId: session.anchorTransactionId,
        questionText: session.questionText,
        answerText: answerText.trim(),
      });
      await completeMutation.mutateAsync({ sessionId: session.sessionId });
      return true;
    }, `tell-me-why-save-${transactionId}`);
    if (result) setPhase("done");
  }

  if (phase === "idle") {
    return (
      <button
        onClick={handleStart}
        disabled={startMutation.isPending}
        className="mt-2 w-fit rounded border border-journal-rule px-2 py-1 text-xs"
      >
        {ttw.buttonLabel}
      </button>
    );
  }

  if (phase === "answering" && session) {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded border border-journal-rule p-2">
        <p className="text-xs font-medium">{session.questionText}</p>
        <textarea
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          placeholder={ttw.answerPlaceholder}
          rows={4}
          className="rounded border border-journal-rule px-2 py-1 text-xs"
        />
        <button
          onClick={handleSave}
          disabled={answerText.trim() === "" || answerMutation.isPending}
          className="w-fit rounded bg-journal-accent px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {answerMutation.isPending ? ttw.savingButton : ttw.saveButton}
        </button>
      </div>
    );
  }

  return <p className="mt-2 text-xs text-journal-muted">{ttw.savedConfirmation}</p>;
}
