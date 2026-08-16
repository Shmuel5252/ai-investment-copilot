import type { CanonicalField, ColumnMapping } from "./types";

// Deterministic best-guess column mapping from CSV header names to our
// canonical fields — plain string matching, not AI. Matching a header
// like "Trade Date" to `date` doesn't require judgment, just a synonym
// list; using an LLM call for this would be exactly the kind of
// AI-where-code-suffices the product principles rule out. The user
// reviews/adjusts the suggestion before anything is imported — this is a
// starting point, not a decision.
const SYNONYMS: Record<CanonicalField, string[]> = {
  date: ["date", "trade date", "transaction date", "settlement date", "run date"],
  ticker: ["ticker", "symbol", "security", "instrument"],
  type: ["type", "action", "transaction type", "activity", "description type"],
  quantity: ["quantity", "qty", "shares", "units"],
  price: ["price", "unit price", "share price", "trade price"],
  amount: ["amount", "total", "net amount", "value", "cash amount"],
  commission: ["commission", "commissions", "fee", "fees", "broker fee"],
  notes: ["notes", "memo", "description", "comment"],
};

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalizedHeaders = headers.map((h) => ({ original: h, normalized: normalize(h) }));

  for (const field of Object.keys(SYNONYMS) as CanonicalField[]) {
    const synonyms = SYNONYMS[field];

    // Exact match first, then substring match, so "Symbol" beats a
    // coincidental substring hit elsewhere.
    const exact = normalizedHeaders.find((h) => synonyms.includes(h.normalized));
    if (exact) {
      mapping[field] = exact.original;
      continue;
    }

    const partial = normalizedHeaders.find((h) =>
      synonyms.some((s) => h.normalized.includes(s))
    );
    if (partial) {
      mapping[field] = partial.original;
    }
  }

  return mapping;
}
