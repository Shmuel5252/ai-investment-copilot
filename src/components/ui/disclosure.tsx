import { cx } from "./cx";

// Native <details> with a quiet summary: a chevron that turns when open, no
// browser marker. For reference material a reader opens on purpose; never
// for content that must stay visible. Promoted from the Decision page
// (Frontend V1 unit 6A) when the DNA evidence needed it. `onToggle` is
// optional and only reports the new state (e.g. to load content on first
// open); without it the element behaves exactly as before.
export function Disclosure({
  summary,
  children,
  open = false,
  className,
  onToggle,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  className?: string;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details open={open} className={cx("group", className)} onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}>
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
