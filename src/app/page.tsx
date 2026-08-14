"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";

export default function HomePage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">AI Investment Copilot</h1>
      {me.isLoading && <p>Loading...</p>}
      {me.data && (
        <p>
          Signed in as <strong>{me.data.displayName}</strong> ({me.data.email})
        </p>
      )}
      <p className="text-sm text-neutral-500">
        Project Foundation is up: Next.js + tRPC + Drizzle + auth are wired end to
        end. The Investment Memory itself (DNA, Strategy, Cases, Decisions...)
        is built in the tasks that follow — see CLAUDE.md.
      </p>
      <div className="flex gap-2">
        <Link href="/import" className="w-fit rounded bg-neutral-900 px-3 py-2 text-sm text-white">
          Import trade history
        </Link>
        <Link
          href="/interview"
          className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          Onboarding interview
        </Link>
        <Link href="/dna" className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm">
          Investor DNA
        </Link>
        <Link href="/strategy" className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm">
          Baseline Strategy
        </Link>
        <Link href="/ideas" className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm">
          Ideas
        </Link>
        <Link href="/cases" className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm">
          Investment Cases
        </Link>
      </div>
      <button
        onClick={() => logout.mutate()}
        className="w-fit rounded border border-neutral-300 px-3 py-2 text-sm"
      >
        Sign out
      </button>
    </main>
  );
}
