"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

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
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Ideas</h1>
        <p className="text-sm text-neutral-500">
          A short note on a ticker you&apos;re curious about — promote it to a full Investment Case
          when you want to research it properly.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded border border-neutral-200 p-4">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="rounded border border-neutral-300 p-2 text-sm"
        />
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="What made you think of this?"
          className="min-h-20 rounded border border-neutral-300 p-2 text-sm"
        />
        <button
          onClick={() => guard(() => create.mutateAsync({ ticker, noteText }))}
          disabled={ticker.trim() === "" || noteText.trim() === "" || create.isPending}
          className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Saving..." : "Add idea"}
        </button>
        {create.isError && <p className="text-sm text-red-600">{create.error.message}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {list.data?.map((idea) => (
          <div key={idea.id} className="rounded border border-neutral-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{idea.ticker}</p>
              <span className="text-xs text-neutral-400">
                {new Date(idea.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-1 text-sm text-neutral-600">{idea.noteText}</p>
            <div className="mt-2">
              {idea.promotedToCaseId ? (
                <Link href={`/cases/${idea.promotedToCaseId}`} className="text-xs underline">
                  View case
                </Link>
              ) : (
                <button
                  onClick={() => guard(() => promote.mutateAsync({ ideaId: idea.id }), idea.id)}
                  disabled={promote.isPending}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                >
                  Promote to Investment Case
                </button>
              )}
            </div>
          </div>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-neutral-500">No ideas yet.</p>}
      </div>
    </main>
  );
}
