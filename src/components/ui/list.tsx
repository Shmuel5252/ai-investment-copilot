import { cx } from "./cx";

// A bordered list whose rows separate by a rule — the row form of Card, for
// records that carry a line or two of prose and a few actions. Use it where
// a Card per item would stack into a wall of boxes and a Table would force
// prose into cells. Rows are <li>; the actions slot sits at the end edge (the
// left edge in RTL) on wide screens and drops under the content when narrow.
export function List({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cx("divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-surface", className)}>
      {children}
    </ul>
  );
}

export function ListRow({
  children,
  actions,
  actionsBelow = false,
  className,
}: {
  children: React.ReactNode;
  /** Controls for this row: links or buttons. Rendered after the content in reading order. */
  actions?: React.ReactNode;
  /** Put the actions under the content at every width: for rows with several actions or long content. */
  actionsBelow?: boolean;
  className?: string;
}) {
  return (
    <li className={cx("flex flex-col gap-3 px-4 py-3", !actionsBelow && "sm:flex-row sm:items-start sm:justify-between sm:gap-6", className)}>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {actions && <div className={cx("flex flex-wrap items-center gap-2", actionsBelow ? "border-t border-rule pt-3" : "sm:max-w-[50%] sm:justify-end")}>{actions}</div>}
    </li>
  );
}
