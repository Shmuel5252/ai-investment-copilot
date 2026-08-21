import Link from "next/link";

// Local, per-page "back" navigation — not a shared app shell/nav bar
// (deliberately deferred: see the redesign task notes on the Dashboard).
// The chevron points right, not left: in RTL reading order, "back/up"
// points toward the start of the line, which is the right edge — the
// mirror image of the left-pointing back arrow an LTR page would use.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex w-fit items-center gap-1.5 text-sm text-journal-muted hover:text-journal-accent">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 6 15 12 9 18" />
      </svg>
      {label}
    </Link>
  );
}
