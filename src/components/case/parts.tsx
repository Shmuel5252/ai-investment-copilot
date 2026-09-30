import { Notice } from "@/components/ui/status";
import { caseDetailPage as t } from "@/lib/i18n/strings";

// Small pieces the Case regions share. Quote and Provenance moved to
// src/components/ui/quote.tsx in Frontend V1 unit 4.

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
