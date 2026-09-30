// Small formatting helpers the Case regions share. Quote and Provenance
// moved to src/components/ui/quote.tsx (unit 4), ActionError to
// src/components/ui/action-error.tsx (unit 5).

export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
export const dateTime = (d: string | Date) => new Date(d).toLocaleString("he-IL");
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n: number) => `${n.toFixed(1)}%`;
