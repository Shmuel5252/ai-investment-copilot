"use client";

import Link from "next/link";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { decisionsListPage as t, decisionTypeLabel, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

export default function DecisionsPage() {
  const list = trpc.decisions.list.useQuery();

  return (
    <main
      dir="rtl"
      lang="he"
      className={`${sansBody.className} mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12 text-journal-ink`}
    >
      <BackLink href="/" label={nav.home} />

      <div className="flex flex-col gap-2 border-b border-journal-rule pb-6">
        <h1 className={`${serifHeader.className} text-2xl font-bold`}>{t.title}</h1>
        <p className="text-sm text-journal-muted">{t.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        {list.data?.map((d) => (
          <Link
            key={d.id}
            href={`/decisions/${d.id}`}
            className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg"
          >
            <span className="font-medium">
              {decisionTypeLabel[d.decisionType] ?? d.decisionType} {d.ticker}
            </span>{" "}
            <span className="text-xs text-journal-muted">
              <Num>{new Date(d.decisionDate).toLocaleDateString("he-IL")}</Num>
            </span>
          </Link>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-journal-muted">{t.noDecisionsYet}</p>}
      </div>
    </main>
  );
}
