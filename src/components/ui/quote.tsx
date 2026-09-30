import { cx } from "./cx";
import { HelpText } from "./states";

// Two quiet ways of marking who owns a piece of text. Promoted from the Case
// page (Frontend V1 unit 3) when the Decision record needed the same marks.

// The investor's own words, verbatim: a rule at the start edge, the ink
// color, line breaks kept. Never translated, never trimmed.
export function Quote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <blockquote className={cx("whitespace-pre-wrap border-s-2 border-rule-strong ps-4 text-sm leading-relaxed text-ink", className)}>{children}</blockquote>;
}

// Where a region's content comes from, said once under its heading: investor
// words, fetched facts, computed numbers, AI analysis.
export function Provenance({ children, className }: { children: React.ReactNode; className?: string }) {
  return <HelpText className={className}>{children}</HelpText>;
}
