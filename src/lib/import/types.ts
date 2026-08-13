// Canonical fields our importer understands — the target of the column
// mapping step. `ticker` is optional (deposit/withdrawal have none);
// everything else is present-or-derivable per row (see validate.ts).
export const CANONICAL_FIELDS = [
  "date",
  "ticker",
  "type",
  "quantity",
  "price",
  "amount",
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
