import { cx } from "./cx";
import type { Tone } from "./badge";

const DOT: Record<Tone, string> = {
  neutral: "bg-neutral",
  info: "bg-info",
  positive: "bg-positive",
  caution: "bg-caution",
  negative: "bg-negative",
};

// A status as a dot and a label, for rows and headers where a filled badge
// would be too loud. The dot is decorative; the label carries the meaning.
export function Status({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm text-ink-2", className)}>
      <span aria-hidden="true" className={cx("inline-block h-2 w-2 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

// A one-line note with a tone, for inline warnings and confirmations that
// belong next to the thing they describe. Not a toast, not a modal.
export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const field: Record<Tone, string> = {
    neutral: "bg-neutral-soft text-ink",
    info: "bg-info-soft text-ink",
    positive: "bg-positive-soft text-ink",
    caution: "bg-caution-soft text-ink",
    negative: "bg-negative-soft text-ink",
  };
  return (
    <div role={tone === "negative" ? "alert" : undefined} className={cx("rounded-md px-3.5 py-2.5 text-sm leading-relaxed", field[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title ? "mt-0.5" : null, "text-ink-2")}>{children}</div>}
    </div>
  );
}
