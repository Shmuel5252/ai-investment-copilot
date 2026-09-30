import { cx } from "./cx";

// The one bordered surface. "raised" adds the panel shadow for content that
// floats over the page (a drawer, a summary); the default sits flat on the
// paper with a rule. Never nest a Card in a Card.
export function Card({
  children,
  className,
  raised = false,
  padding = "md",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  raised?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "li";
}) {
  const pad = { none: "", sm: "p-3", md: "p-5", lg: "p-6" }[padding];
  return (
    <Tag className={cx("rounded-lg border border-rule bg-surface", raised && "shadow-panel", pad, className)}>{children}</Tag>
  );
}
