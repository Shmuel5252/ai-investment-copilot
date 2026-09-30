// The product's navigation, in the investor's language. Pure data plus one
// pure matcher, so it is unit-tested without a browser
// (tests/unit/shell-nav-config.test.ts) and shared by the desktop sidebar
// and the mobile drawer.
//
// Groups follow how the product is used (docs/architecture.md §2), not
// the backend's routers: the recurring decision loop first, then the
// investor's own profile, then the raw data that feeds it. Each label
// reuses its page's own title string where one exists, so the sidebar and
// the page heading can never disagree.
import {
  shell,
  ideasPage,
  casesListPage,
  decisionsListPage,
  dnaPage,
  strategyPage,
  importPage,
  interviewPage,
  journalPage,
} from "@/lib/i18n/strings";
import type { IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: shell.groupDecisions,
    items: [
      { href: "/", label: shell.navHome, icon: "home" },
      { href: "/ideas", label: ideasPage.title, icon: "idea" },
      { href: "/cases", label: casesListPage.title, icon: "case" },
      { href: "/decisions", label: decisionsListPage.title, icon: "decision" },
    ],
  },
  {
    label: shell.groupProfile,
    items: [
      { href: "/dna", label: dnaPage.title, icon: "dna" },
      { href: "/strategy", label: strategyPage.title, icon: "strategy" },
      { href: "/learning", label: shell.navLearning, icon: "learning" },
    ],
  },
  {
    label: shell.groupData,
    items: [
      { href: "/import", label: importPage.title, icon: "import" },
      { href: "/interview", label: interviewPage.title, icon: "interview" },
      { href: "/journal", label: journalPage.title, icon: "journal" },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

// Routes that render without the shell's chrome (no sidebar, no user menu).
export const BARE_ROUTES: readonly string[] = ["/login"];

// Active-route rule: exact match for the home route, prefix match for
// everything else so `/cases/123` lights up "תיקי מחקר". The prefix must
// end at a path boundary: `/decisions-archive` would not light `/decisions`.
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((route) => isActiveRoute(pathname, route));
}
