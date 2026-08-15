"use client";

import Link from "next/link";
import { trpc } from "@/trpc/react";

export default function DecisionsPage() {
  const list = trpc.decisions.list.useQuery();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold">Decisions</h1>
        <p className="text-sm text-neutral-500">
          Every recorded decision — immutable from the moment it was created. Record a new one from
          an Investment Case.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {list.data?.map((d) => (
          <Link
            key={d.id}
            href={`/decisions/${d.id}`}
            className="rounded border border-neutral-200 p-3 text-sm hover:bg-neutral-50"
          >
            <span className="font-medium">
              {d.decisionType} {d.ticker}
            </span>{" "}
            <span className="text-xs text-neutral-400">{new Date(d.decisionDate).toLocaleDateString()}</span>
          </Link>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-neutral-500">No decisions recorded yet.</p>}
      </div>
    </main>
  );
}
