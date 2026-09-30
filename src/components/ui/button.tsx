import Link from "next/link";
import { cx } from "./cx";
import { shell } from "@/lib/i18n/strings";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border border-transparent",
  secondary: "bg-surface text-ink border border-control hover:bg-surface-2",
  quiet: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-3 hover:text-ink",
  danger: "bg-surface text-negative border border-negative/40 hover:bg-negative-soft",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

const BASE =
  "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50";

// One button vocabulary for the whole product. "primary" is the one accent
// action on a screen; "secondary" is the default outlined control;
// "quiet" is for in-line, low-weight actions; "danger" is reserved for
// discarding or deleting something the investor typed.
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Replaces the label while `loading`; defaults to the shared "טוען..." */
  loadingLabel?: React.ReactNode;
}) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx(BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading ? (loadingLabel ?? shell.loading) : children}
    </button>
  );
}

// A link that looks like a button, for navigation that reads as an action.
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  href,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link href={href} className={cx(BASE, VARIANT[variant], SIZE[size], className)}>
      {children}
    </Link>
  );
}
