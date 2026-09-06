// Single source of truth for the "this dollar amount is a size, not a
// price" clarification that must accompany a sizeDollars figure
// anywhere a per-share price is also mentioned in the same AI prompt —
// they're two different, unrelated numbers ($500 invested vs.
// $1278.83/share is completely normal, not an inconsistency).
//
// A live check once caught the model confusing them in
// src/lib/ai/decision.ts (inventing a "data mismatch" between the two
// and mislabeling sizeDollars as an entry price in an extracted
// Prediction). A second live check — on the real LLY Decision Review —
// found the identical confusion recurring independently in
// src/lib/ai/review.ts's Outcome formatting, which had never received
// the same fix: two separate implementations of the same "size vs.
// price" concept, only one of which got patched. The AI's own
// narrativeSummaryText wrote "the $500 entry" (should have been
// $1278.83) even though the correct price was present in the prompt in
// three separate places — the bug wasn't missing data, it was this
// exact unlabeled-adjacency pattern recurring in a second formatter no
// one thought to check.
//
// Never format a sizeDollars figure next to a per-share price in an AI
// prompt without going through this function.
export function formatSizeDollarsLine(
  label: string,
  sizeDollars: number,
  priceReference: "above" | "below"
): string {
  return `${label}: $${sizeDollars.toFixed(2)} (the dollar amount being invested — NOT a price; unrelated to the per-share Price ${priceReference})`;
}
