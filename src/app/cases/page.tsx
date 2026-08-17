"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";

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
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Investment Cases</h1>
        <p className="text-sm text-neutral-500">
          Research a ticker directly, or promote one of your Ideas into a case.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="rounded border border-neutral-300 p-2 text-sm"
        />
        <button
          onClick={() => guard(() => create.mutateAsync({ ticker }))}
          disabled={ticker.trim() === "" || create.isPending}
          className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating..." : "New case"}
        </button>
      </div>
      {create.isError && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="flex flex-col gap-2">
        {list.data?.map((c) => (
          <Link
            key={c.id}
            href={`/cases/${c.id}`}
            className="rounded border border-neutral-200 p-3 text-sm hover:bg-neutral-50"
          >
            <span className="font-medium">{c.ticker}</span>{" "}
            <span className="text-xs text-neutral-400">
              {c.status} · {new Date(c.createdAt).toLocaleDateString()}
            </span>
          </Link>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-neutral-500">No cases yet.</p>}
      </div>
    </main>
  );
}
