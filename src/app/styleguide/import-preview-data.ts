import { loaded, type Loadable } from "@/components/home/types";
import type {
  CorporateAction,
  HistoryData,
  ImportResultView,
  ManualResultView,
  ManualRowDraft,
  PreviewData,
  ValidationData,
  WriteError,
} from "@/components/import/types";
import type { ManualCheck } from "@/components/import/manual-entry";

// SYNTHETIC data for the /styleguide Import preview and the Import render
// tests. Invented tickers, file names, amounts, messages and dates; nothing
// here comes from the investor's records. Every enum value is one the
// schema allows; row keys follow the contract (String(rowIndex) for a file,
// String(position) for the manual form).

export type ImportPreviewState = "start" | "first" | "mapping" | "review" | "partial" | "done" | "manual" | "manual-done";
export const IMPORT_PREVIEW_STATES: readonly ImportPreviewState[] = ["start", "first", "mapping", "review", "partial", "done", "manual", "manual-done"];

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export const PREVIEW_HISTORY: HistoryData = {
  latestTransactionDate: "2026-09-18T00:00:00.000Z",
  transactionCount: 142,
  manualEntry: { count: 3, latestDate: "2026-08-02T00:00:00.000Z" },
  latestBatch: { id: "batch-sample", filename: "broker-sample.csv", uploadedAt: "2026-09-20T09:30:00.000Z", rowCount: 36, windowStart: "2026-07-01T00:00:00.000Z", windowEnd: "2026-09-18T00:00:00.000Z" },
  ageDays: 12,
};

export const EMPTY_HISTORY: HistoryData = {
  latestTransactionDate: null,
  transactionCount: 0,
  manualEntry: { count: 0, latestDate: null },
  latestBatch: null,
  ageDays: null,
};

export const PREVIEW_FILENAME = "broker-sample-2026.csv";

export const PREVIEW_PREVIEW: PreviewData = {
  headers: ["Date", "Symbol", "Action", "Qty", "Price", "Net Amount", "Fee", "Memo"],
  rowCount: 38,
  previewRows: [
    { Date: "2026-07-02", Symbol: "MNOP", Action: "BUY", Qty: "200", Price: "8.05", "Net Amount": "-1610.00", Fee: "0", Memo: "" },
    { Date: "2026-07-09", Symbol: "WXYZ", Action: "BUY", Qty: "30", Price: "74.20", "Net Amount": "-2226.00", Fee: "1.00", Memo: "sample memo" },
    { Date: "2026-07-15", Symbol: "", Action: "DEPOSIT", Qty: "", Price: "", "Net Amount": "5000.00", Fee: "", Memo: "" },
  ],
  suggestedMapping: { date: "Date", ticker: "Symbol", type: "Action", quantity: "Qty", price: "Price", amount: "Net Amount", commission: "Fee" },
};

const fact = (ticker: string, type: "buy" | "sell", date: string, quantity: string, price: string) => ({
  ticker,
  transactionType: type,
  transactionDate: D(date),
  quantity,
  price,
  amount: (Number(quantity) * Number(price) * (type === "buy" ? -1 : 1)).toFixed(2),
  source: "csv_import" as const,
});

export const PREVIEW_VALIDATION: ValidationData = {
  validCount: 36,
  invalidRows: [
    { rowIndex: 11, raw: {}, errors: ["Sample: unrecognized transaction type \"TRANSFER\""] },
    { rowIndex: 27, raw: {}, errors: ["Sample: missing date"] },
  ],
  detectedTickers: ["MNOP", "WXYZ", "QRST", "ABCD"],
  tickersNeedingOpeningState: ["QRST"],
  collisionGroups: [
    { ticker: "MNOP", transactionDate: D("2026-08-14"), existing: [], incoming: [{ clientRowKey: "4", ticker: "MNOP", transactionDate: D("2026-08-14") }, { clientRowKey: "5", ticker: "MNOP", transactionDate: D("2026-08-14") }] },
    {
      ticker: "WXYZ",
      transactionDate: D("2026-09-02"),
      existing: [{ id: "ex-w", ticker: "WXYZ", transactionDate: D("2026-09-02"), intraDayOrder: null, orderUnknownReason: null }],
      incoming: [{ clientRowKey: "9", ticker: "WXYZ", transactionDate: D("2026-09-02") }],
    },
  ],
  reconciliation: {
    mode: "csv_import",
    counts: { new: 32, exact_duplicate: 1, probable_manual_match: 1, ambiguous: 1, requiresResolution: 2 },
    rows: [
      { clientRowKey: "4", class: "new", identityKey: "k4", incoming: fact("MNOP", "buy", "2026-08-14", "50", "8.40"), matchedExistingId: null, withinBatch: false, candidates: [], requiresResolution: false },
      { clientRowKey: "5", class: "new", identityKey: "k5", incoming: fact("MNOP", "sell", "2026-08-14", "20", "8.55"), matchedExistingId: null, withinBatch: false, candidates: [], requiresResolution: false },
      { clientRowKey: "9", class: "new", identityKey: "k9", incoming: fact("WXYZ", "sell", "2026-09-02", "10", "80.10"), matchedExistingId: null, withinBatch: false, candidates: [], requiresResolution: false },
      {
        clientRowKey: "14",
        class: "probable_manual_match",
        identityKey: "k14",
        incoming: fact("ABCD", "buy", "2026-07-21", "100", "19.75"),
        matchedExistingId: null,
        withinBatch: false,
        candidates: [{ id: "man-1", ...fact("ABCD", "buy", "2026-07-21", "100", "19.70"), source: "manual_entry" }],
        requiresResolution: true,
      },
      {
        clientRowKey: "15",
        class: "ambiguous",
        identityKey: "k15",
        incoming: fact("ABCD", "sell", "2026-08-05", "40", "21.00"),
        matchedExistingId: null,
        withinBatch: false,
        candidates: [
          { id: "man-2", ...fact("ABCD", "sell", "2026-08-05", "40", "20.95"), source: "manual_entry" },
          { id: "man-3", ...fact("ABCD", "sell", "2026-08-05", "40", "21.05"), source: "manual_entry" },
        ],
        requiresResolution: true,
      },
      { clientRowKey: "20", class: "exact_duplicate", identityKey: "k20", incoming: fact("WXYZ", "buy", "2026-07-09", "30", "74.20"), matchedExistingId: "ex-dup", withinBatch: false, candidates: [], requiresResolution: false },
    ],
  },
} as unknown as ValidationData;

/** The review once the investor has fixed the file: nothing invalid, both decisions answered. */
export const PREVIEW_VALIDATION_CLEAN: ValidationData = { ...PREVIEW_VALIDATION, validCount: 38, invalidRows: [] };
export const PREVIEW_RESOLVED = {
  "14": { action: "same" as const, existingTransactionId: "man-1" },
  "15": { action: "separate" as const },
};

export const PREVIEW_UNCERTAIN: WriteError = { message: "Sample: server error after the transactions were saved", refused: false };

export const PREVIEW_RESULT: ImportResultView = {
  importedCount: 35,
  skippedExactCount: 1,
  skippedSameCount: 1,
  separateCount: 1,
  positions: {
    positions: [
      { ticker: "MNOP", quantity: 230, costBasisPerShare: 8.12, costBasisConfidence: "known" },
      { ticker: "QRST", quantity: 12.5, costBasisPerShare: 131.4, costBasisConfidence: "approximate" },
      { ticker: "WXYZ", quantity: 20, costBasisPerShare: null, costBasisConfidence: "unknown" },
    ],
    cash: 1520.4,
  },
} as ImportResultView;

export const PREVIEW_MANUAL_ROWS: ManualRowDraft[] = [
  { ticker: "HIJK", transactionType: "buy", quantity: "15", price: "210", transactionDate: "2026-09-10", notes: "", intraDayOrder: "" },
  { ticker: "HIJK", transactionType: "buy", quantity: "15", price: "210", transactionDate: "2026-09-10", notes: "", intraDayOrder: "" },
];

const manualFact = (quantity: string) => ({ ...fact("HIJK", "buy", "2026-09-10", quantity, "210"), source: "manual_entry" as const });

export const PREVIEW_MANUAL_CHECK: ManualCheck = {
  collisionGroups: [
    { ticker: "HIJK", transactionDate: D("2026-09-10"), existing: [], incoming: [{ clientRowKey: "0", ticker: "HIJK", transactionDate: D("2026-09-10") }, { clientRowKey: "1", ticker: "HIJK", transactionDate: D("2026-09-10") }] },
  ],
  reconciliation: {
    mode: "manual_entry",
    counts: { new: 1, exact_duplicate: 1, probable_manual_match: 0, ambiguous: 0, requiresResolution: 1 },
    rows: [
      { clientRowKey: "0", class: "new", identityKey: "m0", incoming: manualFact("15"), matchedExistingId: null, withinBatch: false, candidates: [], requiresResolution: false },
      { clientRowKey: "1", class: "exact_duplicate", identityKey: "m0", incoming: manualFact("15"), matchedExistingId: null, withinBatch: true, candidates: [], requiresResolution: true },
    ],
  },
} as unknown as ManualCheck;

export const PREVIEW_MANUAL_RESULT: ManualResultView = {
  transactions: [
    { id: "t-1", ticker: "HIJK", transactionType: "buy", quantity: "15", price: "210", transactionDate: "2026-09-10T00:00:00.000Z" },
    { id: "t-2", ticker: "HIJK", transactionType: "buy", quantity: "15", price: "210", transactionDate: "2026-09-10T00:00:00.000Z" },
  ],
  skippedCount: 0,
  positions: { positions: [{ ticker: "HIJK", quantity: 30, costBasisPerShare: 210, costBasisConfidence: "known" }], cash: 0 },
};

export const PREVIEW_SPLITS: CorporateAction[] = [
  {
    id: "split-1",
    investorId: "investor-sample",
    ticker: "QRST",
    kind: "stock_split",
    effectiveDate: D("2026-06-10"),
    ratioNumerator: 4,
    ratioDenominator: 1,
    source: "issuer_disclosure",
    evidence: "Sample: the company announced a 4-for-1 split, trading adjusted from 10/06/2026.",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
  },
] as unknown as CorporateAction[];

export const previewHistory = (state: ImportPreviewState): Loadable<HistoryData> => loaded(state === "first" ? EMPTY_HISTORY : PREVIEW_HISTORY);
