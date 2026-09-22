"use client";

import { useState } from "react";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { trpc } from "@/trpc/react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Num } from "@/components/num";
import { BackLink } from "@/components/back-link";
import { journalPage as t, tellMeWhy as ttw, nav } from "@/lib/i18n/strings";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

const serifHeader = Frank_Ruhl_Libre({ subsets: ["latin", "hebrew"], weight: ["400", "700"], display: "swap" });
const sansBody = Assistant({ subsets: ["latin", "hebrew"], weight: ["400", "500", "600", "700"], display: "swap" });

type Journal = inferRouterOutputs<AppRouter>["interview"]["journal"];
type Episode = Journal["episodes"][number];

const formatDate = (d: string | Date) => new Date(d).toLocaleDateString("he-IL");
const formatQuantity = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(4).replace(/\.?0+$/, ""));

// Episode Journal V1 (docs/architecture.md §2.2). The server already
// withholds every post-decision fact for an episode without a rationale
// (`later` is null until one exists — src/lib/interview/journal.ts), so
// this page cannot show an outcome before the investor has written why;
// it only chooses how to present what it was sent.
export default function JournalPage() {
  const journal = trpc.interview.journal.useQuery();
  const episodes = journal.data?.episodes ?? [];
  const unanswered = episodes.filter((e) => e.rationale.status === "unanswered");
  const answered = episodes.filter((e) => e.rationale.status === "answered");

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
        {journal.data && (
          <p className="text-sm">
            {t.coveragePrefix} <Num>{journal.data.coverage.covered}</Num> {t.coverageMiddle}{" "}
            <Num>{journal.data.coverage.total}</Num> {t.coverageSuffix}
          </p>
        )}
      </div>

      {journal.isLoading && <p className="text-sm text-journal-muted">{t.loading}</p>}
      {journal.isError && <p className="text-sm text-red-600">{journal.error.message}</p>}
      {journal.data && episodes.length === 0 && <p className="text-sm text-journal-muted">{t.empty}</p>}

      {journal.data && episodes.length > 0 && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className={`${serifHeader.className} text-lg font-bold`}>
              {t.unansweredHeading} (<Num>{unanswered.length}</Num>)
            </h2>
            {unanswered.length === 0 && <p className="text-sm text-journal-muted">{t.allDocumented}</p>}
            {unanswered.map((e) => (
              <EpisodeCard key={e.key} episode={e} />
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={`${serifHeader.className} text-lg font-bold`}>
              {t.answeredHeading} (<Num>{answered.length}</Num>)
            </h2>
            {answered.map((e) => (
              <EpisodeCard key={e.key} episode={e} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function EpisodeCard({ episode }: { episode: Episode }) {
  const [showRationale, setShowRationale] = useState(false);
  // While an UPDATE is being written, the later/outcome facts are hidden
  // again: an update is a rationale being written too, and it must not be
  // composed with the outcome on screen (hindsight protection, decision 4/8).
  const [updating, setUpdating] = useState(false);
  const answered = episode.rationale.status === "answered";
  const latest = episode.rationale.answers.at(-1) ?? null;

  return (
    <div className="rounded border border-journal-rule bg-journal-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {t.episodeLabel} <Num>{episode.ticker}#{episode.episodeNumber}</Num>
        </p>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs ${
            episode.status === "open" ? "bg-blue-100 text-blue-800" : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {episode.status === "open" ? t.statusOpen : t.statusClosed}
        </span>
      </div>

      {/* Entry-time facts only — the same boundary the question builder keeps. */}
      <p className="mt-1 text-xs text-journal-muted">
        {episode.entry ? t.entryLabel : t.firstTransactionLabel}: <Num>{formatDate(episode.entry?.date ?? episode.firstDate)}</Num>
        {episode.entry && episode.entry.quantity !== null && episode.entry.price !== null && (
          <>
            {" · "}
            <Num>{formatQuantity(episode.entry.quantity)}</Num> {t.sharesAtLabel} <Num>${episode.entry.price.toFixed(2)}</Num>
          </>
        )}
        {" · "}
        <Num>{episode.buyCount}</Num> {t.buysLabel} · <Num>{episode.sellCount}</Num> {t.sellsLabel}
      </p>

      {!answered && !episode.anchorable && <p className="mt-2 text-xs text-journal-muted">{t.notAnchorable}</p>}
      {!answered && episode.anchorable && episode.entry && (
        <TellMeWhyPanel transactionId={episode.entry.transactionId} supersedesAnswerId={null} />
      )}

      {answered && latest && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-3">
            <button onClick={() => setShowRationale((s) => !s)} className="text-xs text-journal-accent underline">
              {showRationale ? t.hideRationale : t.showRationale}
            </button>
            <span className="text-xs text-journal-muted">
              {t.writtenOnLabel} <Num>{formatDate(latest.createdAt)}</Num>
            </span>
          </div>
          {showRationale && (
            <div className="flex flex-col gap-2 border-t border-journal-rule pt-2">
              {/* The investor's own words — content, never translated or reformatted. */}
              <p className="whitespace-pre-wrap text-sm">{latest.answerText}</p>
              {episode.entry && (
                <TellMeWhyPanel transactionId={episode.entry.transactionId} supersedesAnswerId={latest.id} onWritingChange={setUpdating} />
              )}
            </div>
          )}
          {episode.later && !updating && <LaterFacts episode={episode} />}
        </div>
      )}
    </div>
  );
}

// Post-decision facts, shown ONLY for an answered episode (the server never
// sends them otherwise) and labelled as later facts — never part of the
// rationale itself. All numbers are computePositions()'s own sellTrace.
function LaterFacts({ episode }: { episode: Episode }) {
  const later = episode.later;
  if (!later) return null;
  return (
    <div className="rounded border border-dashed border-journal-rule p-2 text-xs text-journal-muted">
      <p className="font-medium">{t.laterFactsHeading}</p>
      {episode.status === "open" && <p className="mt-1">{t.stillOpenNote}</p>}
      {later.exitDate && (
        <p className="mt-1">
          {t.exitLabel}: <Num>{formatDate(later.exitDate)}</Num>
          {later.holdingDays !== null && (
            <>
              {" · "}
              {t.holdingDaysLabel}: <Num>{later.holdingDays}</Num>
            </>
          )}
        </p>
      )}
      {later.sells.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {later.sells.map((s) => (
            <li key={s.transactionId}>
              {t.sellLabel} <Num>{formatDate(s.date)}</Num>: {t.realizedLabel}{" "}
              <Num>
                {s.realizedPnlPercent >= 0 ? "+" : ""}
                {s.realizedPnlPercent.toFixed(1)}%
              </Num>
              {!s.sufficientHoldings && <> ({t.insufficientHoldingsNote})</>}
            </li>
          ))}
        </ul>
      ) : (
        episode.status === "closed" && <p className="mt-1">{t.noSellTrace}</p>
      )}
    </div>
  );
}

// Same shape as the post-manual-entry panel on /import: start (server
// builds the deterministic question and picks the anchor), answer,
// complete. With supersedesAnswerId set, saving creates a NEW answer that
// supersedes the previous one — the original row is never edited.
function TellMeWhyPanel({
  transactionId,
  supersedesAnswerId,
  onWritingChange,
}: {
  transactionId: string;
  supersedesAnswerId: string | null;
  onWritingChange?: (writing: boolean) => void;
}) {
  const guard = useSubmitGuard();
  const utils = trpc.useUtils();
  const [phase, setPhaseState] = useState<"idle" | "answering" | "done">("idle");
  const setPhase = (next: "idle" | "answering" | "done") => {
    setPhaseState(next);
    onWritingChange?.(next === "answering");
  };
  const [session, setSession] = useState<{ sessionId: string; anchorTransactionId: string; questionText: string } | null>(null);
  const [answerText, setAnswerText] = useState("");

  const startMutation = trpc.interview.startTellMeWhy.useMutation();
  const answerMutation = trpc.interview.answer.useMutation();
  const completeMutation = trpc.interview.complete.useMutation();
  const key = `${supersedesAnswerId ? "update" : "tell"}-${transactionId}`;

  async function handleStart() {
    const result = await guard(() => startMutation.mutateAsync({ transactionId }), `${key}-start`);
    if (result) {
      setSession({ sessionId: result.sessionId, anchorTransactionId: result.transactionId, questionText: result.questionText });
      setPhase("answering");
    }
  }

  async function handleSave() {
    if (!session || answerText.trim() === "") return;
    const saved = await guard(async () => {
      await answerMutation.mutateAsync({
        sessionId: session.sessionId,
        transactionId: session.anchorTransactionId,
        questionText: session.questionText,
        answerText: answerText.trim(),
        supersedesAnswerId: supersedesAnswerId ?? undefined,
      });
      await completeMutation.mutateAsync({ sessionId: session.sessionId });
      return true;
    }, `${key}-save`);
    if (saved) {
      setPhase("done");
      await utils.interview.journal.invalidate();
      await utils.interview.journalCoverage.invalidate();
    }
  }

  if (phase === "idle") {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <button
          onClick={handleStart}
          disabled={startMutation.isPending}
          className={`w-fit rounded px-2 py-1 text-xs ${supersedesAnswerId ? "border border-journal-rule" : "bg-journal-accent text-white"} disabled:opacity-50`}
        >
          {supersedesAnswerId ? ttw.updateButton : ttw.buttonLabel}
        </button>
        {supersedesAnswerId && <p className="text-xs text-journal-muted">{ttw.updateHint}</p>}
        {startMutation.isError && <p className="text-xs text-red-600">{startMutation.error.message}</p>}
      </div>
    );
  }

  if (phase === "answering" && session) {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded border border-journal-rule p-2">
        <p className="text-xs text-journal-muted">{t.hindsightNote}</p>
        <p className="text-xs font-medium">{session.questionText}</p>
        <textarea
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
          placeholder={ttw.answerPlaceholder}
          rows={5}
          className="rounded border border-journal-rule px-2 py-1 text-xs"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={answerText.trim() === "" || answerMutation.isPending}
            className="w-fit rounded bg-journal-accent px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {answerMutation.isPending ? ttw.savingButton : ttw.saveButton}
          </button>
          <button onClick={() => setPhase("idle")} className="w-fit rounded border border-journal-rule px-2 py-1 text-xs">
            {ttw.cancelButton}
          </button>
        </div>
        {answerMutation.isError && <p className="text-xs text-red-600">{answerMutation.error.message}</p>}
      </div>
    );
  }

  return <p className="mt-2 text-xs text-journal-muted">{ttw.savedConfirmation}</p>;
}
