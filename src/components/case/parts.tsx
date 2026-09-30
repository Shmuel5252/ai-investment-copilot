import { Notice } from "@/components/ui/status";
import { HelpText } from "@/components/ui/states";
import { cx } from "@/components/ui/cx";
import { caseDetailPage as t } from "@/lib/i18n/strings";

// Small pieces the Case regions share. Feature-local on purpose: the design
// review named Provenance as a possible global primitive, not authorized yet.

// Where a region's content comes from, said once under its heading. The one
// quiet way each owner is marked: investor words, fetched facts, computed
// numbers, AI analysis.
export function Provenance({ children, className }: { children: React.ReactNode; className?: string }) {
  return <HelpText className={className}>{children}</HelpText>;
}

// The investor's own words, verbatim: a rule at the start edge, the ink
// color, line breaks kept. Never translated, never trimmed.
export function Quote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <blockquote className={cx("whitespace-pre-wrap border-s-2 border-rule-strong ps-4 text-sm leading-relaxed text-ink", className)}>{children}</blockquote>;
}

// A failed mutation: the human line first, the server's own message after it.
export function ActionError({ message, title = t.actionFailed }: { message: string | null; title?: string }) {
  if (!message) return null;
  return (
    <Notice tone="negative" title={title}>
      <bdi dir="ltr" className="text-xs">
        {message}
      </bdi>
    </Notice>
  );
}

export const day = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
export const dateTime = (d: string | Date) => new Date(d).toLocaleString("he-IL");
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n: number) => `${n.toFixed(1)}%`;
