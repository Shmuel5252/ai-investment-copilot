// Small formatting helpers the Decision regions share. Disclosure moved to
// src/components/ui/disclosure.tsx (unit 6A), ActionError to
// src/components/ui/action-error.tsx (unit 5).

export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
export const dateTime = (d: string | Date) => new Date(d).toLocaleString("he-IL");
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signedPct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
/** A label from a display map, or a dash for a value the map does not know. Never the raw value. */
export const labelOf = (map: Record<string, string>, value: string | null | undefined) => (value != null && map[value]) || "—";
/** Did the snapshot enter the system on a different calendar day than the decision date? */
export const isBackdated = (decisionDate: string | Date, recordedAt: string | Date) => day(decisionDate) !== day(recordedAt);
