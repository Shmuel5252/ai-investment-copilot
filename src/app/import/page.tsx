"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/import/types";

const FIELD_LABELS: Record<CanonicalField, string> = {
  date: "Date",
  ticker: "Ticker",
  type: "Type (buy/sell/dividend/...)",
  quantity: "Quantity",
  price: "Price",
  amount: "Amount",
  commission: "Commission (optional — folded into Amount)",
  notes: "Notes",
};

type Step = "upload" | "mapping" | "review" | "done";

interface OpeningStateDraft {
  ticker: string;
  quantity: string;
  costBasisPerShare: string;
  costBasisConfidence: "known" | "approximate" | "unknown";
  asOfDate: string;
}

export default function ImportPage() {
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

  function handleConfirm() {
    const openingStatesPayload = Object.values(openingStates)
      .filter((os) => os.quantity.trim() !== "")
      .map((os) => ({
        ticker: os.ticker,
        quantity: Number(os.quantity),
        costBasisPerShare: os.costBasisPerShare.trim() === "" ? null : Number(os.costBasisPerShare),
        costBasisConfidence: os.costBasisConfidence,
        asOfDate: new Date(os.asOfDate),
      }));

    confirmImport.mutate(
      { csvContent, mapping, filename, openingStates: openingStatesPayload },
      { onSuccess: () => setStep("done") }
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Trade History Import</h1>
        <p className="text-sm text-neutral-500">
          Upload a partial trade history (e.g. the last 6–12 months). If a position was opened
          before the window you upload, you&apos;ll be asked for its opening balance separately —
          we never assume the file is your whole portfolio.
        </p>
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
            {preview.data.rowCount} rows detected. Map your columns below (best guess pre-filled):
          </p>
          <table className="w-full text-sm">
            <tbody>
              {CANONICAL_FIELDS.map((field) => (
                <tr key={field}>
                  <td className="py-1 pr-4 font-medium">{FIELD_LABELS[field]}</td>
                  <td>
                    <select
                      className="rounded border border-neutral-300 px-2 py-1"
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))
                      }
                    >
                      <option value="">— not mapped —</option>
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

          <details className="text-xs text-neutral-500">
            <summary>Preview first rows</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-2">
              {JSON.stringify(preview.data.previewRows, null, 2)}
            </pre>
          </details>

          <button
            onClick={startReview}
            disabled={!mapping.date || !mapping.type}
            className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Validate
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          {validation.isLoading && <p>Validating...</p>}
          {validation.data && (
            <>
              <p className="text-sm">
                {validation.data.validCount} valid row(s), {validation.data.invalidRows.length}{" "}
                invalid row(s).
              </p>

              {validation.data.invalidRows.length > 0 && (
                <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
                  <p className="font-medium">Fix these rows in your CSV and re-upload:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {validation.data.invalidRows.slice(0, 10).map((r) => (
                      <li key={r.rowIndex}>
                        Row {r.rowIndex + 1}: {r.errors.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.data.tickersNeedingOpeningState.length > 0 && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium">
                    These tickers have a SELL that isn&apos;t explained by this file alone —
                    likely a position opened before the imported window. Enter what you held just
                    before the file&apos;s start date (self-reported, marked as such — not
                    derived from transaction history):
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
                    {validation.data.tickersNeedingOpeningState.map((ticker) => {
                      const draft = openingStates[ticker];
                      return (
                        <div key={ticker} className="flex flex-wrap items-center gap-2">
                          <span className="w-16 font-medium">{ticker}</span>
                          <input
                            type="number"
                            placeholder="Quantity"
                            className="w-24 rounded border border-neutral-300 px-2 py-1"
                            value={draft?.quantity ?? ""}
                            onChange={(e) => updateOpeningState(ticker, { quantity: e.target.value })}
                          />
                          <input
                            type="number"
                            placeholder="Cost basis/share"
                            className="w-32 rounded border border-neutral-300 px-2 py-1"
                            value={draft?.costBasisPerShare ?? ""}
                            onChange={(e) =>
                              updateOpeningState(ticker, { costBasisPerShare: e.target.value })
                            }
                          />
                          <select
                            className="rounded border border-neutral-300 px-2 py-1"
                            value={draft?.costBasisConfidence ?? "approximate"}
                            onChange={(e) =>
                              updateOpeningState(ticker, {
                                costBasisConfidence: e.target.value as OpeningStateDraft["costBasisConfidence"],
                              })
                            }
                          >
                            <option value="known">Known exactly</option>
                            <option value="approximate">Approximate</option>
                            <option value="unknown">Unknown</option>
                          </select>
                          <input
                            type="date"
                            className="rounded border border-neutral-300 px-2 py-1"
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
                className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {confirmImport.isPending ? "Importing..." : "Confirm Import"}
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
            Imported {confirmImport.data.importedCount} transaction(s).
          </p>
          <div>
            <p className="text-sm font-medium">Current positions:</p>
            <ul className="mt-1 text-sm">
              {confirmImport.data.positions.positions.map((p) => (
                <li key={p.ticker}>
                  {p.ticker}: {p.quantity} @ avg cost {p.costBasisPerShare?.toFixed(2)} (
                  {p.costBasisConfidence})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm">Cash: {confirmImport.data.positions.cash.toFixed(2)}</p>
          </div>
        </div>
      )}
    </main>
  );
}
