"use client";

import { trpc } from "@/trpc/react";
import { HomeView } from "@/components/home/home-view";

// Home — Frontend V1, unit 2. This file only runs the existing queries; the
// regions, their order and the one presentation join live in
// src/components/home. No procedure here is new, and nothing on this page
// writes, ranks or calls an AI.
export default function HomePage() {
  // The zone every date on this page is rendered in — the server places
  // decision/review instants on this same calendar (no defaulted zone).
  const attention = trpc.decisions.attention.useQuery({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const nextActions = trpc.evidence.nextActions.useQuery();
  const conditions = trpc.predictions.openReentryConditions.useQuery();
  const cases = trpc.cases.list.useQuery();
  const ideas = trpc.ideas.list.useQuery();
  const reach = trpc.evidence.reach.useQuery();
  // History freshness (History Refresh V1) — the latest persisted
  // transaction date, never a claim about the live portfolio.
  const history = trpc.import.history.useQuery();
  const coverage = trpc.interview.journalCoverage.useQuery();

  return (
    <main>
      <HomeView data={{ attention, nextActions, conditions, cases, ideas, reach, history, coverage }} />
    </main>
  );
}
