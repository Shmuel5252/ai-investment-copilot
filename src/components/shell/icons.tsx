// One authored icon set for the shell: 24-unit grid, 1.75px stroke, round
// caps and joins, currentColor. Drawn here rather than pulled from a
// library so every glyph shares one weight, and so no dependency is
// added for a dozen shapes. Decorative by default (aria-hidden); a label
// always sits beside the icon in text.
import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "idea"
  | "case"
  | "decision"
  | "dna"
  | "strategy"
  | "learning"
  | "import"
  | "interview"
  | "journal"
  | "menu"
  | "close"
  | "signOut"
  | "chevronStart";

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10.5V19h11v-8.5" />
    </>
  ),
  idea: (
    <>
      <path d="M9.5 18h5" />
      <path d="M10 21h4" />
      <path d="M8.5 13.5A5 5 0 1 1 15.5 13.5c-.7.7-1 1.5-1 2.5h-5c0-1-.3-1.8-1-2.5Z" />
    </>
  ),
  case: (
    <>
      <path d="M4 8.5h16v10H4z" />
      <path d="M9 8.5V6h6v2.5" />
      <path d="M4 13h16" />
    </>
  ),
  decision: (
    <>
      <path d="M6 4h12v16H6z" />
      <path d="M9 9h6M9 12.5h6M9 16h3" />
    </>
  ),
  dna: (
    <>
      <path d="M8 3c0 4 8 5 8 9s-8 5-8 9" />
      <path d="M16 3c0 4-8 5-8 9s8 5 8 9" />
      <path d="M9.5 8h5M9.5 16h5" />
    </>
  ),
  strategy: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m15 9-2 5-4 1 2-5z" />
    </>
  ),
  learning: (
    <>
      <path d="M4 6.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5v12c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" />
      <path d="M12 7v12" />
    </>
  ),
  import: (
    <>
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  interview: (
    <>
      <path d="M5 6h14v9H9l-4 3z" />
      <path d="M9 10.5h6" />
    </>
  ),
  journal: (
    <>
      <path d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1z" />
      <path d="M6 16a1 1 0 0 1 1-1h11" />
      <path d="M10 8h4" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  signOut: (
    <>
      <path d="M14 5h5v14h-5" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </>
  ),
  // "back / up" in RTL reading order points to the start edge, which is
  // the right edge; the glyph is drawn pointing right on purpose.
  chevronStart: <path d="m9 6 6 6-6 6" />,
};

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
