"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { dashboardPage as t, importPage, interviewPage, journalPage, dnaPage, strategyPage, ideasPage, casesListPage, decisionsListPage } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

// Reuses each destination page's own title string (imported above)
// rather than a second, parallel copy of the same eight labels — see
// dashboardPage's comment in strings.ts. Order matches the actual
// product flow (docs/architecture.md §2), not alphabetical.
const SECTIONS = [
  { href: "/import", label: importPage.title },
  { href: "/interview", label: interviewPage.title },
  // Episode Journal — its card also shows rationale coverage (derived
  // from production data by interview.journalCoverage, never hard-coded).
  { href: "/journal", label: journalPage.title },
  { href: "/dna", label: dnaPage.title },
  { href: "/strategy", label: strategyPage.title },
  { href: "/ideas", label: ideasPage.title },
  { href: "/cases", label: casesListPage.title },
  { href: "/decisions", label: decisionsListPage.title },
  // Learning Insights stays English on purpose — that page itself is
  // still English, deferred alongside Decision Review (open backlog
  // items) — see CLAUDE.md's "שפת תוכן" section.
  { href: "/learning", label: "Learning Insights" },
] as const;

export default function HomePage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const me = trpc.auth.me.useQuery();
  const coverage = trpc.interview.journalCoverage.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12 text-journal-ink`}
    >
      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>AI Investment Copilot</h1>
        {me.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
        {me.data && (
          <p className="text-sm text-journal-muted">
            {t.signedInAs} <strong className="text-journal-ink">{me.data.displayName}</strong> ({me.data.email})
          </p>
        )}
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg"
          >
            {s.label}
            {s.href === "/journal" && coverage.data && (
              <span className="text-xs text-journal-muted">
                {" — "}
                {journalPage.coveragePrefix} <Num>{coverage.data.covered}</Num> {journalPage.coverageMiddle}{" "}
                <Num>{coverage.data.total}</Num> {journalPage.coverageSuffix}
              </span>
            )}
          </Link>
        ))}
      </div>

      <button
        onClick={() => guard(() => logout.mutateAsync())}
        className="w-fit rounded border border-journal-rule px-3 py-2 text-sm text-journal-ink hover:bg-journal-bg"
      >
        {t.signOut}
      </button>
    </main>
  );
}
