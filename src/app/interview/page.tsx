"use client";

import { useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { interviewPage as t, nav } from "@/lib/i18n/strings";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

interface Question {
  transactionId: string;
  ticker: string | null;
  category: string;
  facts: string;
  questionText: string;
}

export default function InterviewPage() {
  const guard = useSubmitGuard();
  const [session, setSession] = useState<{ sessionId: string; questions: Question[] } | null>(
    null
  );
  const [index, setIndex] = useState(0);
  const [answerDraft, setAnswerDraft] = useState("");
  const [answeredCount, setAnsweredCount] = useState(0);
  const [done, setDone] = useState(false);

  const start = trpc.interview.start.useMutation({
    onSuccess: (data) => {
      setSession(data);
      setIndex(0);
      setAnsweredCount(0);
      setDone(false);
    },
  });
  const answer = trpc.interview.answer.useMutation();
  const complete = trpc.interview.complete.useMutation({
    onSuccess: () => setDone(true),
  });

  const currentQuestion = session?.questions[index];

  async function submitAnswer(skip: boolean) {
    if (!session || !currentQuestion) return;

    // Shared key across Next/Skip on purpose — both advance the same
    // session state, so a rapid click on one while the other is still
    // in flight needs to be blocked too, not just a repeat of the same
    // button.
    await guard(async () => {
      if (!skip && answerDraft.trim() !== "") {
        await answer.mutateAsync({
          sessionId: session.sessionId,
          transactionId: currentQuestion.transactionId,
          questionText: currentQuestion.questionText,
          answerText: answerDraft.trim(),
        });
        setAnsweredCount((c) => c + 1);
      }

      setAnswerDraft("");
      if (index + 1 < session.questions.length) {
        setIndex(index + 1);
      } else {
        await complete.mutateAsync({ sessionId: session.sessionId });
      }
    }, "submitAnswer");
  }

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

      {!session && !start.isPending && (
        <button
          onClick={() => guard(() => start.mutateAsync())}
          className="w-fit rounded bg-journal-accent px-3 py-2 text-sm text-white"
        >
          {t.startButton}
        </button>
      )}

      {start.isPending && <p className="text-sm">{t.preparingQuestions}</p>}
      {start.isError && <p className="text-sm text-red-600">{start.error.message}</p>}

      {session && !done && currentQuestion && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-journal-muted">
            {t.questionLabel} <Num>{index + 1}</Num> {t.ofLabel} <Num>{session.questions.length}</Num>
            {currentQuestion.ticker ? ` — ${currentQuestion.ticker}` : ""}
          </p>
          {/* questionText/facts come from a live AI call, not static UI
              copy — left as generated (typically English), same rule as
              a decision's own reasoning/thesis text elsewhere. */}
          <p className="text-lg font-medium">{currentQuestion.questionText}</p>
          <details className="text-xs text-journal-muted">
            <summary>{t.whyAskedThis}</summary>
            <p className="mt-1">{currentQuestion.facts}</p>
          </details>
          <textarea
            className="min-h-32 rounded border border-journal-rule bg-journal-surface p-2 text-sm"
            placeholder={t.answerPlaceholder}
            value={answerDraft}
            onChange={(e) => setAnswerDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => submitAnswer(false)}
              disabled={answerDraft.trim() === "" || answer.isPending}
              className="rounded bg-journal-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {index + 1 < session.questions.length ? t.nextButton : t.finishButton}
            </button>
            <button
              onClick={() => submitAnswer(true)}
              className="rounded border border-journal-rule px-3 py-2 text-sm"
            >
              {t.skipButton}
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="text-sm">
          {t.completePrefix} <Num>{answeredCount}</Num> {t.completeMiddle}{" "}
          <Num>{session?.questions.length}</Num> {t.completeSuffix}
        </p>
      )}
    </main>
  );
}
