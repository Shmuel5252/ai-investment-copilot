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
  tellMeWhy as ttw,
  costBasisConfidenceLabel,
  common,
  nav,
} from "@/lib/i18n/strings";

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
  const [manualRows, setManualRows] = useState<ManualRowDraft[]>([emptyManualRow()]);

  const preview = trpc.import.preview.useQuery({ csvContent }, { enabled: csvContent.length > 0 });
  const validation = trpc.import.validate.useQuery(
    { csvContent, mapping },
    { enabled: step === "review" && csvContent.length > 0 }
  );
  const confirmImport = trpc.import.confirmImport.useMutation();
  const confirmManualEntry = trpc.import.confirmManualEntry.useMutation();

  // Same-day collision preview for manual entry — only fires once every
  // current row is complete enough to validate server-side (positional
  // index correlation with manualRows must stay exact, so partial rows
  // can't be filtered out before sending).
  const manualRowsComplete =
    manualRows.length > 0 &&
    manualRows.every(
      (r) => r.ticker.trim() !== "" && Number(r.quantity) > 0 && Number(r.price) > 0 && r.transactionDate !== ""
    );
  const manualCollisions = trpc.import.checkManualEntryCollisions.useQuery(
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
    const result = await guard(() => confirmManualEntry.mutateAsync({ rows }), "manual-entry");
    if (result) setManualRows([emptyManualRow()]);
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

              {validation.data.collisionGroups.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">{cr.heading}</p>
                  <p className="mt-1 text-xs text-journal-muted">{cr.explanation}</p>
                  <div className="mt-3 flex flex-col gap-3">
                    {validation.data.collisionGroups.map((group) => (
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
                        {group.incoming.map((inc) => (
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
                disabled={validation.data.invalidRows.length > 0 || confirmImport.isPending}
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

          {manualCollisions.data && manualCollisions.data.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium">{cr.heading}</p>
              <p className="mt-1 text-xs text-journal-muted">{cr.explanation}</p>
              <div className="mt-3 flex flex-col gap-3">
                {manualCollisions.data.map((group) => (
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
              disabled={confirmManualEntry.isPending}
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
  const [session, setSession] = useState<{ sessionId: string; questionText: string } | null>(null);
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
      setSession({ sessionId: result.sessionId, questionText: result.questionText });
      setPhase("answering");
    }
  }

  async function handleSave() {
    if (!session || answerText.trim() === "") return;
    const result = await guard(async () => {
      await answerMutation.mutateAsync({
        sessionId: session.sessionId,
        transactionId,
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
