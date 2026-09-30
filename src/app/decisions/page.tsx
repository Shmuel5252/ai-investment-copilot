"use client";

import { trpc } from "@/trpc/react";
import { DecisionsListView } from "@/components/decision/decisions-list-view";

// /decisions — Frontend V1, unit 4. The existing list query only.
export default function DecisionsPage() {
  const list = trpc.decisions.list.useQuery();
  return (
    <main>
      <DecisionsListView decisions={list} />
    </main>
  );
}
