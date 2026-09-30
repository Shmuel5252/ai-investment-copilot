import { cx } from "./cx";

// A titled region of a page. The heading is small and semibold, never a
// second serif; an optional count sits beside it and an optional action at
// the end of the line. Sections separate by space, not by boxes: a Card
// is for content that needs an edge (a record, a form), not for grouping.
export function Section({
  title,
  count,
  action,
  hint,
  children,
  id,
  className,
}: {
  title: React.ReactNode;
  /** A number beside the title. Rendered inside <Num> for you. */
  count?: number;
  action?: React.ReactNode;
  /** One explanatory line under the heading, in the investor's language. */
  hint?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {count !== undefined && (
            <span className="num rounded-sm bg-surface-3 px-1.5 text-xs font-semibold text-ink-2">
              <bdi dir="ltr">{count}</bdi>
            </span>
          )}
        </div>
        {action}
      </div>
      {hint && <p className="-mt-1 max-w-[65ch] text-sm text-muted">{hint}</p>}
      {children}
    </section>
  );
}
