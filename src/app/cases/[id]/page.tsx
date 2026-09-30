"use client";

import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { CaseView } from "@/components/case/case-view";
import type { CaseAction, CaseViewData, ProfileItem } from "@/components/case/types";
import type { Loadable } from "@/components/home/types";

// The Case / research file — Frontend V1, unit 3. This file only runs the
// existing queries and mutations; the regions live in src/components/case.
// No procedure here is new. Portfolio Fit is computed only when the investor
// asks (never on load) and is never stored; the three writes keep their
// existing semantics, and recording goes through decisions.create unchanged.
export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();

  const investmentCase = trpc.cases.get.useQuery({ caseId: id });
  // The original idea note is read from the existing idea list and matched
  // on the case's own ideaId (no backend join for the page's convenience).
  const ideas = trpc.ideas.list.useQuery();
  const origin = trpc.cases.originCondition.useQuery({ caseId: id });
  // Prior Record Brief V1: facts only, as of now; frozen server-side at recording.
  const priorRecord = trpc.cases.priorRecord.useQuery({ caseId: id });
  const dnaList = trpc.dna.list.useQuery();
  const strategyList = trpc.strategy.list.useQuery();
  const existingDecision = trpc.decisions.getForCase.useQuery({ caseId: id });

  const invalidateCase = () => utils.cases.get.invalidate({ caseId: id });
  const fetchMarketData = trpc.cases.fetchMarketIntelligence.useMutation({ onSuccess: invalidateCase });
  const generatePersonalFit = trpc.cases.generatePersonalFit.useMutation({ onSuccess: invalidateCase });
  const generateSynthesis = trpc.cases.generateSynthesis.useMutation({ onSuccess: invalidateCase });
  const computeFit = trpc.cases.computePortfolioFit.useMutation();
  const recordDecision = trpc.decisions.create.useMutation({
    onSuccess: (result) => router.push(`/decisions/${result.decision.id}`),
  });

  const intelligence = investmentCase.data?.marketIntelligenceJson;
  const action = <A extends unknown[]>(m: { isPending: boolean; error: { message: string } | null }, key: string, run: (...args: A) => Promise<unknown>): CaseAction<A> => ({
    // the failure is shown from the mutation's own error state
    run: (...args: A) => void guard(() => run(...args), key).catch(() => undefined),
    pending: m.isPending,
    error: m.error?.message ?? null,
  });

  const profile = (h: { id: string; versions: { statementText: string; evidenceStrength: string | null }[] }): ProfileItem => ({
    id: h.id,
    statementText: h.versions[0]?.statementText,
    evidenceStrength: h.versions[0]?.evidenceStrength ?? undefined,
  });
  const map = <T, U>(q: Loadable<T>, f: (d: T) => U): Loadable<U> => ({ ...q, data: q.data === undefined ? undefined : f(q.data) });

  const data: CaseViewData = {
    investmentCase,
    ideas,
    origin,
    priorRecord,
    dna: map(dnaList, (list) => list.map(profile)),
    strategy: map(strategyList, (s) => ({ principles: s.principles.map(profile), hasApprovedVersion: s.latestVersion !== null })),
    existingDecision: map(existingDecision, (d) => d ?? null),
    // The result of the last computation in THIS visit, with the size it used.
    fit: computeFit.data ? { data: computeFit.data, sizeDollars: computeFit.variables?.sizeDollars } : undefined,
  };

  return (
    <main>
      <CaseView
        data={data}
        actions={{
          fetchMarket: action(fetchMarketData, "fetchMarketData", () => fetchMarketData.mutateAsync({ caseId: id, forceRefresh: !!intelligence })),
          computeFit: action(computeFit, "computeFit", (sizeDollars: number | undefined) => computeFit.mutateAsync({ caseId: id, sizeDollars })),
          personalFit: action(generatePersonalFit, "generatePersonalFit", () => generatePersonalFit.mutateAsync({ caseId: id })),
          reading: action(generateSynthesis, "generateSynthesis", (sizeDollars: number | undefined) => generateSynthesis.mutateAsync({ caseId: id, sizeDollars })),
          record: action(recordDecision, "recordDecision", (input) => recordDecision.mutateAsync({ caseId: id, ...input })),
        }}
      />
    </main>
  );
}
