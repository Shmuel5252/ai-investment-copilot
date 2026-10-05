// Small formatting helpers the Case regions share. Quote and Provenance
// moved to src/components/ui/quote.tsx (unit 4), ActionError to
// src/components/ui/action-error.tsx (unit 5).

export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
export const dateTime = (d: string | Date) => new Date(d).toLocaleString("he-IL");
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n: number) => `${n.toFixed(1)}%`;

// Market cap as a compact value ($4.90T, $84.20B, $512.30M); below a million
// the full figure. Display only — the stored and AI-visible value is untouched.
const COMPACT_UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];
export const compactUsd = (n: number) => {
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const [div, suffix] = COMPACT_UNITS[i]!;
    if (n < div) continue;
    const fixed = (n / div).toFixed(2);
    // 999.996M rounds to 1000.00M: show it in the next unit up instead.
    if (Number(fixed) >= 1000 && i > 0) return `$${(n / COMPACT_UNITS[i - 1]![0]).toFixed(2)}${COMPACT_UNITS[i - 1]![1]}`;
    return `$${fixed}${suffix}`;
  }
  return `$${n.toLocaleString("en-US")}`;
};

// FMP's dividendYieldTTM is stored as a ratio (0.0032 = 0.32%; checked against
// every cached payload, max 0.0076), shown here as a percent.
export const yieldPercent = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;
