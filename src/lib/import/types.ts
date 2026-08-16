// Canonical fields our importer understands — the target of the column
// mapping step. `ticker` is optional (deposit/withdrawal have none);
// everything else is present-or-derivable per row (see validate.ts).
// `commission` is optional and never stored as its own column — it's
// folded into `amount` at normalize time (see validate.ts) so `amount`
// stays the single true net cash effect per docs/data-model.md's
// contract for that field, and a note is appended so the raw fact isn't
// silently lost. Added after a real user import: 85 of 153 real rows had
// a non-zero commission that was previously read from the CSV into
// nothing — CANONICAL_FIELDS had no "commission" entry at all, so
// validate.ts's `get("commission")` was never even called; the value was
// discarded before it reached the DB. Caught by a real balance mismatch,
// not a synthetic test — see tests/unit/import-validate.test.ts's
// commission tests for the permanent regression coverage.
export const CANONICAL_FIELDS = [
  "date",
  "ticker",
  "type",
  "quantity",
  "price",
  "amount",
  "commission",
  "notes",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

// Maps a canonical field to the header name of the user's CSV column
// that supplies it. Not every field needs a mapping (e.g. no `notes`
// column at all is fine).
export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export type CanonicalTransactionType =
  | "buy"
  | "sell"
  | "dividend"
  | "deposit"
  | "withdrawal"
  | "fee";

export interface NormalizedTransactionRow {
  rowIndex: number; // 0-based index into the parsed CSV rows, for error reporting
  ticker: string | null;
  transactionType: CanonicalTransactionType;
  quantity: number | null;
  price: number | null;
  amount: number; // sign-normalized: negative = cash out, positive = cash in
  transactionDate: Date;
  notes: string | null;
}

export interface InvalidRow {
  rowIndex: number;
  raw: Record<string, string>;
  errors: string[];
}

export interface ImportValidationResult {
  validRows: NormalizedTransactionRow[];
  invalidRows: InvalidRow[];
  detectedTickers: string[];
}
