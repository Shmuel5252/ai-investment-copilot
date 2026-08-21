"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { ideasPage as t, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

export default function IdeasPage() {
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const list = trpc.ideas.list.useQuery();
  const create = trpc.ideas.create.useMutation({
    onSuccess: () => {
      setTicker("");
      setNoteText("");
      utils.ideas.list.invalidate();
    },
  });
  const promote = trpc.ideas.promote.useMutation({
    onSuccess: (investmentCase) => {
      utils.ideas.list.invalidate();
      router.push(`/cases/${investmentCase.id}`);
    },
  });

  const [ticker, setTicker] = useState("");
  const [noteText, setNoteText] = useState("");

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

      <div className="flex flex-col gap-2 rounded border border-journal-rule bg-journal-surface p-4">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder={t.tickerPlaceholder}
          className="rounded border border-journal-rule p-2 text-sm"
        />
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={t.notePlaceholder}
          className="min-h-20 rounded border border-journal-rule p-2 text-sm"
        />
        <button
          onClick={() => guard(() => create.mutateAsync({ ticker, noteText }))}
          disabled={ticker.trim() === "" || noteText.trim() === "" || create.isPending}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? t.savingButton : t.addButton}
        </button>
        {create.isError && <p className="text-sm text-red-600">{create.error.message}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {list.data?.map((idea) => (
          <div key={idea.id} className="rounded border border-journal-rule bg-journal-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{idea.ticker}</p>
              <span className="text-xs text-journal-muted">
                <Num>{new Date(idea.createdAt).toLocaleDateString("he-IL")}</Num>
              </span>
            </div>
            {/* noteText is the investor's own words — never translated. */}
            <p className="mt-1 text-sm text-journal-muted">{idea.noteText}</p>
            <div className="mt-2">
              {idea.promotedToCaseId ? (
                <Link href={`/cases/${idea.promotedToCaseId}`} className="text-xs text-journal-accent underline">
                  {t.viewCase}
                </Link>
              ) : (
                <button
                  onClick={() => guard(() => promote.mutateAsync({ ideaId: idea.id }), idea.id)}
                  disabled={promote.isPending}
                  className="rounded border border-journal-rule px-2 py-1 text-xs disabled:opacity-50"
                >
                  {t.promoteButton}
                </button>
              )}
            </div>
          </div>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-journal-muted">{t.noIdeasYet}</p>}
      </div>
    </main>
  );
}
