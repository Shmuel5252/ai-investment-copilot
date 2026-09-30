import { cx } from "./cx";
import { Button } from "./button";
import { shell } from "@/lib/i18n/strings";

// The three states every data region has besides content. They share one
// quiet shape so a screen reads the same whether it is loading, empty or
// failed, and none of them looks like the interface broke.

// Empty: says what would be here and how it gets here. Never "nothing".
export function EmptyState({
  title = shell.emptyDefaultTitle,
  children,
  action,
  className,
}: {
  title?: React.ReactNode;
  /** What creates content here, in the investor's language. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-start gap-2 rounded-lg border border-dashed border-rule-strong px-5 py-6", className)}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="max-w-[60ch] text-sm leading-relaxed text-ink-2">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Loading: skeleton lines in the shape of the content, not a spinner in
// the middle of the region. `lines` approximates the rows expected.
export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cx("flex flex-col gap-2", className)}>
      <span className="sr-only">{shell.loading}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-3.5 animate-pulse rounded-sm bg-surface-3"
          style={{ width: `${[92, 76, 84, 60, 88][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

// Inline loading for a single value or a short row.
export function LoadingText({ children = shell.loading, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={cx("text-sm text-muted", className)}>
      {children}
    </p>
  );
}

// Error: names the problem and the way back, and says that nothing was
// written. `message` is the technical detail, kept small and after the
// human line; `onRetry` re-runs the query.
export function ErrorState({
  title = shell.loadFailedTitle,
  message,
  onRetry,
  className,
}: {
  title?: React.ReactNode;
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cx("flex flex-col items-start gap-2 rounded-lg bg-negative-soft px-5 py-4", className)}>
      <p className="text-sm font-semibold text-negative">{title}</p>
      <p className="text-sm text-ink-2">{shell.loadFailedHint}</p>
      {message && (
        <p className="text-xs text-muted">
          <bdi dir="ltr">{message}</bdi>
        </p>
      )}
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-1">
          {shell.retry}
        </Button>
      )}
    </div>
  );
}

// Explanatory text: what a number means, where a judgment comes from. The
// investor reads it once and then scans past it, so it is small and muted
// but still 4.5:1.
export function HelpText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cx("max-w-[65ch] text-xs leading-relaxed text-muted", className)}>{children}</p>;
}
