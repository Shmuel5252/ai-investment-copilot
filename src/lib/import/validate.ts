import type {
  CanonicalTransactionType,
  ColumnMapping,
  ImportValidationResult,
  InvalidRow,
  NormalizedTransactionRow,
} from "./types";

// Deterministic synonym table for the `type` column's *values* (not to
// be confused with suggest-mapping.ts, which matches column *headers*).
// Unrecognized values are a validation error, not a silent guess.
const TYPE_SYNONYMS: Record<CanonicalTransactionType, string[]> = {
  buy: ["buy", "purchase", "bought", "b"],
  sell: ["sell", "sale", "sold", "s"],
  dividend: ["dividend", "div"],
  deposit: ["deposit", "transfer in", "cash in", "contribution"],
  withdrawal: ["withdrawal", "withdraw", "transfer out", "cash out"],
  fee: ["fee", "commission", "charge"],
};

// Cash effect direction per type: negative = cash left the account.
// Whatever sign the source CSV used, we normalize to this convention
// (docs/data-model.md's transactions.amount contract) rather than
// trusting raw imported data to have gotten it right.
const CASH_DIRECTION: Record<CanonicalTransactionType, 1 | -1> = {
  buy: -1,
  sell: 1,
  dividend: 1,
  deposit: 1,
  withdrawal: -1,
  fee: -1,
};

function normalizeType(raw: string): CanonicalTransactionType | null {
  const normalized = raw.trim().toLowerCase();
  for (const [type, synonyms] of Object.entries(TYPE_SYNONYMS) as [
    CanonicalTransactionType,
    string[],
  ][]) {
    if (synonyms.includes(normalized)) return type;
  }
  return null;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  // Strip common formatting: thousands separators, currency symbols,
  // surrounding parens for negatives (e.g. "(1,234.56)" -> -1234.56).
  const trimmed = raw.trim();
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[(),$]/g, "").replace(/,/g, "");
  const value = Number(cleaned);
  if (Number.isNaN(value)) return null;
  return isParenNegative ? -Math.abs(value) : value;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): { ok: true; row: NormalizedTransactionRow } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const get = (field: keyof ColumnMapping) => {
    const column = mapping[field];
    return column ? raw[column] : undefined;
  };

  const date = parseDate(get("date"));
  if (!date) errors.push("date is missing or unparseable");

  const rawType = get("type");
  const transactionType = rawType ? normalizeType(rawType) : null;
  if (!rawType) errors.push("type column is not mapped or empty");
  else if (!transactionType) errors.push(`unrecognized transaction type: "${rawType}"`);

  const tickerRaw = get("ticker")?.trim();
  const ticker = tickerRaw ? tickerRaw.toUpperCase() : null;

  const quantity = parseNumber(get("quantity"));
  const price = parseNumber(get("price"));
  const amountRaw = parseNumber(get("amount"));
  const notes = get("notes")?.trim() || null;

  if (transactionType === "buy" || transactionType === "sell") {
    if (ticker === null) errors.push(`${transactionType} requires a ticker`);
    if (quantity === null) errors.push(`${transactionType} requires a quantity`);
    if (price === null && amountRaw === null) {
      errors.push(`${transactionType} requires either a price or an amount`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // transactionType/date/quantity guaranteed non-null past this point for
  // buy/sell by the checks above; TS doesn't know that, so re-derive
  // amount defensively rather than asserting.
  let amount: number;
  if (amountRaw !== null) {
    amount = Math.abs(amountRaw) * CASH_DIRECTION[transactionType!];
  } else if (quantity !== null && price !== null) {
    amount = Math.abs(quantity * price) * CASH_DIRECTION[transactionType!];
  } else {
    // Only reachable for dividend/deposit/withdrawal/fee with no amount
    // column mapped at all.
    return { ok: false, errors: ["amount is missing or unparseable"] };
  }

  return {
    ok: true,
    row: {
      rowIndex,
      ticker,
      transactionType: transactionType!,
      quantity,
      price,
      amount,
      transactionDate: date!,
      notes,
    },
  };
}

export function validateImportRows(
  rawRows: Record<string, string>[],
  mapping: ColumnMapping
): ImportValidationResult {
  const validRows: NormalizedTransactionRow[] = [];
  const invalidRows: InvalidRow[] = [];

  rawRows.forEach((raw, rowIndex) => {
    const result = normalizeRow(raw, mapping, rowIndex);
    if (result.ok) validRows.push(result.row);
    else invalidRows.push({ rowIndex, raw, errors: result.errors });
  });

  const detectedTickers = [...new Set(validRows.map((r) => r.ticker).filter((t): t is string => t !== null))].sort();

  return { validRows, invalidRows, detectedTickers };
}
