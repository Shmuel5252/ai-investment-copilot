"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { MobileNav } from "./mobile-nav";
import { isBareRoute } from "./nav-config";
import { shell } from "@/lib/i18n/strings";

// The one application shell (Frontend V1, unit 1). Desktop: a persistent
// sidebar on the start edge (right, in RTL) and a fluid content column.
// Narrow screens: a sticky top bar and a drawer. /login renders bare.
//
// Authentication is enforced elsewhere and stays there: src/proxy.ts
// redirects a signed-out browser to /login before any app route renders,
// and every tRPC procedure a page calls is a protectedProcedure. The shell
// only decides which chrome to draw around a route.
//
// Pages still render their own <main>; the shell wraps it in the content
// column and the skip link targets that column. A page-level PageHeader /
// PageShell (src/components/ui) is what the redesigned pages adopt one by
// one; the six pages redesigned before the shell keep their narrow column
// until their own unit.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-sm text-accent-ink focus:not-sr-only focus:fixed focus:left-1/2 focus:top-2 focus:-translate-x-1/2"
      >
        {shell.skipToContent}
      </a>

      {/* desktop sidebar */}
      <aside className="hidden border-e border-rule bg-surface-2 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-rule px-5 pb-4 pt-5">
          <Link href="/" className="block">
            <span className="block font-serif text-lg font-bold leading-tight text-ink">{shell.productName}</span>
          </Link>
          <p className="mt-1 text-xs leading-snug text-muted">{shell.productDescription}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <NavLinks />
        </div>
        <div className="border-t border-rule px-2 py-3">
          <UserMenu />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* mobile top bar */}
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-rule bg-surface-2/95 px-3 py-2 backdrop-blur lg:hidden">
          <MobileNav />
          <Link href="/" className="font-serif text-base font-bold text-ink">
            {shell.productName}
          </Link>
        </header>

        <div id="content" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
