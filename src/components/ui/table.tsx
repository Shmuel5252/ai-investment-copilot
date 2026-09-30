import { cx } from "./cx";

// Dense, readable tables for financial rows. The head sits on the second
// neutral layer; body rows separate by a rule, hover lifts them onto the
// surface. The whole table sets tabular figures (`num`), and numeric cells
// are aligned to the end edge; wrap each value in <Num> at the call site so a
// negative sign or a date never flips inside Hebrew text.
export function Table({ children, className, caption }: { children: React.ReactNode; className?: string; caption?: React.ReactNode }) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-rule bg-surface", className)}>
      <table className="num w-full border-collapse text-sm">
        {caption && <caption className="px-3 py-2 text-start text-xs text-muted">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-surface-2 text-xs font-semibold text-ink-2">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-rule">{children}</tbody>;
}

export function Tr({ children, className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cx("hover:bg-paper", className)} {...rest}>
      {children}
    </tr>
  );
}

export function Th({ children, numeric = false, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th scope="col" className={cx("px-3 py-2 font-semibold", numeric ? "text-end" : "text-start", className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, numeric = false, muted = false, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; muted?: boolean }) {
  return (
    <td className={cx("px-3 py-2 align-top", numeric && "num text-end", muted && "text-muted", className)} {...rest}>
      {children}
    </td>
  );
}

// Label/value pairs for a record: a definition list laid out as a compact
// grid. Values that are numbers, tickers or dates go through <Num>.
export function KeyValues({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cx("num grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="min-w-0 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
