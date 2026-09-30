"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { DecisionView } from "@/components/decision/decision-view";
import type { DecisionAction, DecisionViewData } from "@/components/decision/types";
import type { Loadable } from "@/components/home/types";

// The Decision record + Review — Frontend V1, unit 4. This file only runs the
// existing queries and mutations; the regions live in src/components/decision.
// No procedure is new and every mutation input is unchanged. The Review
// submission key logic is the Decision Review Integrity V1 logic, moved here
// as is.
export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  // The zone every date is rendered in; monitoring and execution candidates
  // place instants on this same calendar.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const record = trpc.decisions.get.useQuery({ decisionId: id });
  const pendingPredictions = trpc.reviews.pendingPredictions.useQuery({ decisionId: id });
  const reviews = trpc.reviews.listForDecision.useQuery({ decisionId: id });
  const laterContexts = trpc.decisions.listLaterContext.useQuery({ decisionId: id });
  const attention = trpc.decisions.attention.useQuery({ timeZone });
  const execution = trpc.executions.candidates.useQuery({ decisionId: id, timeZone });
  const strategy = trpc.strategy.list.useQuery();
  const cases = trpc.cases.list.useQuery();

  // Decision Review Integrity V1 — one UUID per explicit review submission:
  // kept across failed/retried attempts of the same submission (the server
  // replays an already-saved one), replaced only after a confirmed success
  // so the next deliberate review is a new submission.
  const [reviewSubmissionKey, setReviewSubmissionKey] = useState(() => crypto.randomUUID());
  const generateReview = trpc.reviews.generate.useMutation({
    onSuccess: () => {
      utils.reviews.listForDecision.invalidate({ decisionId: id });
      utils.reviews.pendingPredictions.invalidate({ decisionId: id });
      utils.decisions.get.invalidate({ decisionId: id });
      setReviewSubmissionKey(crypto.randomUUID());
    },
    // A conflict means the stored state moved (or this submission was already
    // saved) — show the current reviews/predictions; nothing was written.
    onError: () => {
      utils.reviews.listForDecision.invalidate({ decisionId: id });
      utils.reviews.pendingPredictions.invalidate({ decisionId: id });
    },
  });
  const submitCorrection = trpc.reviews.correct.useMutation();
  const addLaterContext = trpc.decisions.addLaterContext.useMutation({
    onSuccess: () => utils.decisions.listLaterContext.invalidate({ decisionId: id }),
  });
  const setReviewByDate = trpc.decisions.setReviewByDate.useMutation({
    onSuccess: () => utils.decisions.get.invalidate({ decisionId: id }),
  });
  const assert = trpc.executions.assert.useMutation({
    onSuccess: () => utils.executions.candidates.invalidate({ decisionId: id, timeZone }),
  });
  const resolveCondition = trpc.predictions.resolveReentryCondition.useMutation({
    onSuccess: () => {
      utils.decisions.get.invalidate({ decisionId: id });
      utils.reviews.pendingPredictions.invalidate({ decisionId: id });
      utils.predictions.openReentryConditions.invalidate();
    },
  });
  const openCase = trpc.cases.createFromCondition.useMutation({
    onSuccess: (c) => router.push(`/cases/${c.id}`),
  });

  // run() resolves true only when the write was saved; the failure itself is
  // shown from the mutation's own error state.
  const action = <A extends unknown[]>(m: { isPending: boolean; error: { message: string } | null }, key: string, run: (...args: A) => Promise<unknown>): DecisionAction<A> => ({
    run: async (...args: A) => {
      try {
        return (await guard(() => run(...args), key)) !== undefined;
      } catch {
        return false;
      }
    },
    pending: m.isPending,
    error: m.error?.message ?? null,
  });
  const map = <T, U>(q: Loadable<T>, f: (d: T) => U): Loadable<U> => ({ ...q, data: q.data === undefined ? undefined : f(q.data) });

  const data: DecisionViewData = {
    record,
    reviews,
    pendingPredictions,
    laterContexts,
    today: map(attention, (a) => ({ item: a.items.find((i) => i.decisionId === id) ?? null, historyThrough: a.historyThrough })),
    execution,
    currentStrategyVersionId: map(strategy, (s) => s.latestVersion?.id ?? null),
    reconsiderationCases: (cases.data ?? []).flatMap((c) => (c.originPredictionId ? [{ id: c.id, originPredictionId: c.originPredictionId }] : [])),
  };

  return (
    <main>
      <DecisionView
        data={data}
        actions={{
          setReviewDate: action(setReviewByDate, "set-review-date", (date: string) => setReviewByDate.mutateAsync({ decisionId: id, reviewByDate: new Date(date) })),
          addLaterContext: action(addLaterContext, "add-later-context", (text: string) => addLaterContext.mutateAsync({ decisionId: id, text })),
          runReview: action(generateReview, "run-review", (predictionResolutions) =>
            generateReview.mutateAsync({ decisionId: id, idempotencyKey: reviewSubmissionKey, predictionResolutions })
          ),
          disagree: action(submitCorrection, "disagree", (reviewDimensionId: string, userArgumentText: string) => submitCorrection.mutateAsync({ reviewDimensionId, userArgumentText })),
          markExecution: {
            run: (c, verdict) =>
              void guard(
                () =>
                  assert.mutateAsync({
                    decisionId: id,
                    transactionId: c.transactionId,
                    verdict,
                    timeZone,
                    supersedesFactId: c.assertion?.factId,
                    shownBasis: { group: c.group, transactionType: c.transactionType, transactionDate: c.transactionDate, quantity: c.quantity, price: c.price },
                  }),
                `mark-${c.transactionId}-${verdict}`
              ).catch(() => undefined),
            pending: assert.isPending,
            error: assert.error?.message ?? null,
          },
          conditions: {
            resolve: {
              run: (predictionId, status, note) =>
                void guard(() => resolveCondition.mutateAsync({ predictionId, status, note }), `resolve-${predictionId}`).catch(() => undefined),
              pending: resolveCondition.isPending,
              error: resolveCondition.error?.message ?? null,
            },
            openCase: {
              run: (predictionId) => void guard(() => openCase.mutateAsync({ predictionId }), `open-case-${predictionId}`).catch(() => undefined),
              pending: openCase.isPending,
              error: openCase.error?.message ?? null,
            },
          },
        }}
      />
    </main>
  );
}
