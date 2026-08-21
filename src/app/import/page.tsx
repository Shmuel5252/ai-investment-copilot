"use client";

import { useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/import/types";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { importFieldLabel, importPage as t, costBasisConfidenceLabel, common, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

type Step = "upload" | "mapping" | "review" | "done";

interface OpeningStateDraft {
  ticker: string;
  quantity: string;
  costBasisPerShare: string;
  costBasisConfidence: "known" | "approximate" | "unknown";
  asOfDate: string;
}

export default function ImportPage() {
  const guard = useSubmitGuard();
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<CanonicalField, string>>>({});
  const [openingStates, setOpeningStates] = useState<Record<string, OpeningStateDraft>>({});

  const preview = trpc.import.preview.useQuery({ csvContent }, { enabled: csvContent.length > 0 });
  const validation = trpc.import.validate.useQuery(
    { csvContent, mapping },
    { enabled: step === "review" && csvContent.length > 0 }
  );
  const confirmImport = trpc.import.confirmImport.useMutation();

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

    // The exact button a real double-click duplicated a full import
    // through (see git history) — guarded now, not just disabled-on-
    // isPending (see src/lib/use-submit-guard.ts for why that alone
    // wasn't enough).
    const result = await guard(() =>
      confirmImport.mutateAsync({ csvContent, mapping, filename, openingStates: openingStatesPayload })
    );
    if (result) setStep("done");
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

      {step === "upload" && (
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      )}

      {step === "mapping" && preview.data && (
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

      {step === "review" && (
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

      {step === "done" && confirmImport.data && (
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
    </main>
  );
}
