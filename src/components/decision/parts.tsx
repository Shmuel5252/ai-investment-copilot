import { cx } from "@/components/ui/cx";

// Small pieces the Decision regions share. Feature-local: a global Disclosure
// primitive was named as a candidate in the unit 3 review, not authorized.

// Native <details> with the same summary treatment the shared Prior Record
// block uses: a chevron that turns when open, no browser marker.
export function Disclosure({
  summary,
  children,
  open = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={cx("group", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-xs text-muted transition-transform group-open:-rotate-90">
          ‹
        </span>
        {summary}
      </summary>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </details>
  );
}

export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
export const dateTime = (d: string | Date) => new Date(d).toLocaleString("he-IL");
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signedPct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
/** A label from a display map, or a dash for a value the map does not know. Never the raw value. */
export const labelOf = (map: Record<string, string>, value: string | null | undefined) => (value != null && map[value]) || "—";
/** Did the snapshot enter the system on a different calendar day than the decision date? */
export const isBackdated = (decisionDate: string | Date, recordedAt: string | Date) => day(decisionDate) !== day(recordedAt);
