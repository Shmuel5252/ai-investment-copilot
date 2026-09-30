import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { cx } from "./cx";

// The page header every redesigned screen shares: an optional back link,
// the serif title, a one-line description, and an actions slot at the end
// of the line. The title is the only serif on a screen; everything else is
// the sans, so hierarchy comes from face and size, not from ornament.
export function PageHeader({
  title,
  description,
  back,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  /** A short factual line under the title: dates, counts, status. Wrap values in <Num>. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-3 border-b border-rule pb-5", className)}>
      {back && (
        <Link href={back.href} className="flex w-fit items-center gap-1 text-sm text-muted hover:text-accent">
          <Icon name="chevronStart" size={14} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl font-bold leading-tight text-ink text-balance">{title}</h1>
          {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
          {description && <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// The content column of a redesigned page, with the shell's gutters. Pages
// render this INSIDE their own <main>. Nothing in the shell caps the width:
// the sidebar column is fixed and the content column is minmax(0, 1fr), so
// "full" really is the whole remaining width.
export function PageShell({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode;
  /** "wide" (80rem) for most product pages; "full" for dense tables and research views; "narrow" for prose-like screens. */
  width?: "wide" | "full" | "narrow";
  className?: string;
}) {
  return (
    <div className={cx("mx-auto flex w-full flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8", width === "full" ? "max-w-none" : width === "narrow" ? "max-w-3xl" : "max-w-7xl", className)}>
      {children}
    </div>
  );
}
