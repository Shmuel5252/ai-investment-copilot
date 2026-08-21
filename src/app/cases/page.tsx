"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { casesListPage as t, caseStatusLabel, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

export default function CasesPage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const list = trpc.cases.list.useQuery();
  const create = trpc.cases.create.useMutation({
    onSuccess: (investmentCase) => {
      utils.cases.list.invalidate();
      router.push(`/cases/${investmentCase.id}`);
    },
  });
  const [ticker, setTicker] = useState("");

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

      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder={t.tickerPlaceholder}
          className="rounded border border-journal-rule bg-journal-surface p-2 text-sm"
        />
        <button
          onClick={() => guard(() => create.mutateAsync({ ticker }))}
          disabled={ticker.trim() === "" || create.isPending}
          className="rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? t.creatingButton : t.createButton}
        </button>
      </div>
      {create.isError && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="flex flex-col gap-2">
        {list.data?.map((c) => (
          <Link
            key={c.id}
            href={`/cases/${c.id}`}
            className="rounded border border-journal-rule bg-journal-surface p-3 text-sm hover:bg-journal-bg"
          >
            <span className="font-medium">{c.ticker}</span>{" "}
            <span className="text-xs text-journal-muted">
              {caseStatusLabel[c.status] ?? c.status} ·{" "}
              <Num>{new Date(c.createdAt).toLocaleDateString("he-IL")}</Num>
            </span>
          </Link>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-journal-muted">{t.noCasesYet}</p>}
      </div>
    </main>
  );
}
