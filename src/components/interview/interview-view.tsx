"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/status";
import { EmptyState, HelpText } from "@/components/ui/states";
import { Provenance } from "@/components/ui/quote";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { actionRoleLabel, interviewPage as t } from "@/lib/i18n/strings";

// /interview — Frontend V1 unit 7C-F: the guided interview. The system picks
// structural historical actions; for each it shows only what was recorded up
// to that action and asks what drove it. Three layers never merge:
//   - FACTS: the backend's factsLine, verbatim, in a neutral record surface;
//   - QUESTION: system wording, plain text (never the investor-quote style);
//   - ANSWER: the investor's words, sent exactly as typed.
// Nothing here adds market data, results or any fact the backend withheld.
// Writes go through the injected actions; this component never retries one
// silently, and never sends an answer twice.

export interface InterviewQuestion {
  anchor: { transactionId: string; ticker: string; date: string; role: string };
  factsLine: string;
  questionText: string;
  questionSource: "ai" | "deterministic";
  anchorContextHash: string;
}

export interface InterviewSession {
  sessionId: string;
  questions: InterviewQuestion[];
}

export interface InterviewActions {
  /** Rejects with the server error (its data.code is read). */
  start: () => Promise<InterviewSession>;
  answer: (input: { sessionId: string; transactionId: string; questionText: string; answerText: string; anchorContextHash: string }) => Promise<void>;
  complete: (sessionId: string) => Promise<void>;
}

type Failure = { kind: "restart" | "refused" | "uncertain"; message: string };

const codeOf = (e: unknown) => (e as { data?: { code?: string } | null })?.data?.code;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
// The answer router's restart refusal (a changed point-in-time context). The
// message is the only signal the contract gives; it is matched, never parsed.
const isRestart = (e: unknown) => codeOf(e) === "BAD_REQUEST" && /history behind this question changed/i.test(messageOf(e));

/** dd/mm/yyyy from the anchor's YYYY-MM-DD, the same form the facts line uses. */
export const formatAnchorDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function InterviewView({ history, actions }: { history: Loadable<{ transactionCount: number }>; actions: InterviewActions }) {
  const guard = useSubmitGuard();
  // "done": the session was completed. "unconfirmed": the last step happened
  // (its answer, if any, was saved) but completing the session was not
  // confirmed. A terminal state of its own, never "done" plus a hidden error.
  const [phase, setPhase] = useState<"orientation" | "active" | "done" | "unconfirmed">("orientation");
  const [lastStep, setLastStep] = useState<"saved" | "skipped">("skipped");
  const [startState, setStartState] = useState<{ pending: boolean; error: null | "no_eligible" | "failed" }>({ pending: false, error: null });
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [previousDraft, setPreviousDraft] = useState<string | null>(null);
  const [counts, setCounts] = useState({ saved: 0, skipped: 0 });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function begin() {
    await guard(async () => {
      setStartState({ pending: true, error: null });
      try {
        const next = await actions.start();
        setSession(next);
        setIndex(0);
        setCounts({ saved: 0, skipped: 0 });
        setFailure(null);
        setPhase("active");
        setStartState({ pending: false, error: null });
      } catch (e) {
        setStartState({ pending: false, error: codeOf(e) === "BAD_REQUEST" ? "no_eligible" : "failed" });
      }
    }, "start");
  }

  // Restart after a changed context: a fresh session. The typed text is kept
  // aside, visible, and never attached to a new question by itself.
  async function restart() {
    if (draft.trim() !== "") setPreviousDraft(draft);
    setDraft("");
    setPhase("orientation");
    await begin();
  }

  async function finish(current: InterviewSession, what: "saved" | "skipped") {
    // The last answer (if any) is already saved. A failed complete is neither
    // retried nor followed by a resend: it ends in the "unconfirmed" state.
    // The last question stays on screen, pending, until complete settles:
    // no save or skip can fire a second answer or a second complete meanwhile.
    setLastStep(what);
    setPending(true);
    try {
      await actions.complete(current.sessionId);
      setPhase("done");
    } catch {
      setPhase("unconfirmed");
    } finally {
      setPending(false);
    }
  }

  // Back to the orientation screen: nothing is sent; a new session starts
  // only when the investor presses start again.
  function backToOrientation() {
    setSession(null);
    setPreviousDraft(null);
    setStartState({ pending: false, error: null });
    setPhase("orientation");
  }

  function advance(current: InterviewSession, what: "saved" | "skipped") {
    const next = index + 1;
    setDraft("");
    setFailure(null);
    if (next >= current.questions.length) {
      void finish(current, what);
      return;
    }
    setIndex(next);
    setAnnouncement(`${what === "saved" ? t.announceSaved : t.announceSkipped} ${t.progressPrefix} ${next + 1} ${t.progressMiddle} ${current.questions.length}`);
  }

  async function save() {
    if (!session || pending || draft.trim() === "") return;
    const q = session.questions[index]!;
    await guard(async () => {
      setPending(true);
      setFailure(null);
      try {
        // Sent exactly as typed, with the question and the opaque hash it came with.
        await actions.answer({ sessionId: session.sessionId, transactionId: q.anchor.transactionId, questionText: q.questionText, answerText: draft, anchorContextHash: q.anchorContextHash });
      } catch (e) {
        setFailure(isRestart(e) ? { kind: "restart", message: messageOf(e) } : codeOf(e) === "BAD_REQUEST" ? { kind: "refused", message: messageOf(e) } : { kind: "uncertain", message: messageOf(e) });
        setPending(false);
        return;
      }
      setPending(false);
      setCounts((c) => ({ ...c, saved: c.saved + 1 }));
      advance(session, "saved");
    }, "save");
  }

  function skip() {
    if (!session || pending) return;
    setCounts((c) => ({ ...c, skipped: c.skipped + 1 }));
    advance(session, "skipped");
  }

  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      {phase === "orientation" && <Orientation history={history} startState={startState} onStart={() => void begin()} previousDraft={previousDraft} />}
      {phase === "active" && session && (
        <QuestionScreen
          key={`${session.sessionId}:${index}`}
          question={session.questions[index]!}
          number={index + 1}
          total={session.questions.length}
          isLast={index + 1 === session.questions.length}
          draft={draft}
          onDraft={setDraft}
          pending={pending}
          failure={failure}
          onSave={() => void save()}
          onSkip={skip}
          onRestart={() => void restart()}
          previousDraft={previousDraft}
        />
      )}
      {phase === "done" && session && <Completion saved={counts.saved} skipped={counts.skipped} total={session.questions.length} />}
      {phase === "unconfirmed" && <CompletionUnconfirmed lastStep={lastStep} saved={counts.saved} skipped={counts.skipped} onBack={backToOrientation} />}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </PageShell>
  );
}

function Orientation({
  history,
  startState,
  onStart,
  previousDraft,
}: {
  history: Loadable<{ transactionCount: number }>;
  startState: { pending: boolean; error: null | "no_eligible" | "failed" };
  onStart: () => void;
  previousDraft: string | null;
}) {
  return (
    <RegionBody q={history} lines={4}>
      {(h) =>
        h.transactionCount === 0 ? (
          <EmptyState title={t.noHistoryTitle} action={<ButtonLink href="/import" size="sm" variant="secondary">{t.importLink}</ButtonLink>}>
            {t.noHistoryBody}
          </EmptyState>
        ) : startState.error === "no_eligible" ? (
          <div className="flex flex-col gap-4">
            <EmptyState title={t.noEligibleTitle}>{t.noEligibleBody}</EmptyState>
            {previousDraft && <PreviousDraft text={previousDraft} />}
          </div>
        ) : (
          <Card className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-ink">{t.howTitle}</h2>
            <ul className="flex list-disc flex-col gap-2 ps-5 text-sm leading-relaxed text-ink-2">
              <li>{t.howSelect}</li>
              <li>{t.howFacts}</li>
              <li>{t.howAnswers}</li>
            </ul>
            {previousDraft && <PreviousDraft text={previousDraft} />}
            <div>
              <Button variant="primary" onClick={onStart} loading={startState.pending} loadingLabel={t.preparing}>
                {t.startButton}
              </Button>
            </div>
            {startState.error === "failed" && <Notice tone="negative">{t.startFailed}</Notice>}
          </Card>
        )
      }
    </RegionBody>
  );
}

function PreviousDraft({ text }: { text: string }) {
  return (
    <Disclosure summary={t.previousDraft} open>
      <p className="whitespace-pre-wrap rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink">{text}</p>
    </Disclosure>
  );
}

function QuestionScreen({
  question,
  number,
  total,
  isLast,
  draft,
  onDraft,
  pending,
  failure,
  onSave,
  onSkip,
  onRestart,
  previousDraft,
}: {
  question: InterviewQuestion;
  number: number;
  total: number;
  isLast: boolean;
  draft: string;
  onDraft: (v: string) => void;
  pending: boolean;
  failure: Failure | null;
  onSave: () => void;
  onSkip: () => void;
  onRestart: () => void;
  previousDraft: string | null;
}) {
  const ids = useId();
  const factsId = `${ids}-facts`;
  const questionId = `${ids}-question`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Each question screen is keyed by session and index: focus its heading on arrival.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (failure) noticeRef.current?.focus();
  }, [failure]);

  const role = actionRoleLabel[question.anchor.role] ?? question.anchor.role;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p className="text-sm text-muted">
        {t.progressPrefix} <Num>{number}</Num> {t.progressMiddle} <Num>{total}</Num>
      </p>

      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">
        <span>{role}</span>
        <span aria-hidden="true" className="text-muted">·</span>
        <Num>{question.anchor.ticker}</Num>
        <span aria-hidden="true" className="text-muted">·</span>
        <Num>{formatAnchorDate(question.anchor.date)}</Num>
      </p>

      <section id={factsId} aria-labelledby={`${factsId}-title`} className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-4 py-3">
        <h3 id={`${factsId}-title`} className="text-xs font-semibold text-ink-2">
          {t.factsTitle}
        </h3>
        <p className="text-sm leading-relaxed text-ink">{question.factsLine}</p>
        <Provenance>{t.factsProvenance}</Provenance>
      </section>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-ink-2">{t.questionLabel}</p>
        <h2 id={questionId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {question.questionText}
        </h2>
        <Disclosure summary={t.aboutQuestion}>
          <HelpText>{question.questionSource === "ai" ? t.sourceAi : t.sourceDeterministic}</HelpText>
        </Disclosure>
      </div>

      {previousDraft && <PreviousDraft text={previousDraft} />}

      <Field label={t.answerLabel} help={t.answerHelp} required>
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={[describedBy, questionId, factsId].filter(Boolean).join(" ")} rows={6} value={draft} onChange={(e) => onDraft(e.target.value)} />
        )}
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button type="submit" variant="primary" disabled={draft.trim() === "" || failure?.kind === "restart"} loading={pending} loadingLabel={t.saving}>
          {isLast ? t.saveFinish : t.saveNext}
        </Button>
        <Button variant="quiet" onClick={onSkip} disabled={pending}>
          {t.skip}
        </Button>
      </div>
      <HelpText>{t.skipHelp}</HelpText>

      {failure && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          {failure.kind === "restart" ? (
            <Notice tone="caution">
              <div className="flex flex-col items-start gap-2">
                <p>{t.restartRequired}</p>
                <Button size="sm" variant="secondary" onClick={onRestart}>
                  {t.restartButton}
                </Button>
              </div>
            </Notice>
          ) : failure.kind === "uncertain" ? (
            <Notice tone="caution">
              <p>{t.uncertain}</p>
              <p className="text-xs">
                <bdi dir="ltr">{failure.message}</bdi>
              </p>
            </Notice>
          ) : (
            <ActionError title={t.refusedTitle} message={failure.message} />
          )}
        </div>
      )}
    </form>
  );
}

function Completion({ saved, skipped, total }: { saved: number; skipped: number; total: number }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {t.doneTitle}
      </h2>
      <p className="text-sm text-ink-2">
        {t.doneSavedPrefix} <Num>{saved}</Num> {t.doneSavedMiddle} <Num>{total}</Num> {t.doneSavedSuffix} · <Num>{skipped}</Num> {t.doneSkippedSuffix}
      </p>
      <p className="text-sm leading-relaxed text-ink-2">{t.doneBody}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/journal" size="sm" variant="secondary">
          {t.toJournal}
        </ButtonLink>
        <ButtonLink href="/dna" size="sm" variant="quiet">
          {t.toDna}
        </ButtonLink>
      </div>
    </Card>
  );
}

// The last step happened but completing the session was not confirmed. A
// calm caution, not an error: nothing was lost and nothing should be resent.
function CompletionUnconfirmed({ lastStep, saved, skipped, onBack }: { lastStep: "saved" | "skipped"; saved: number; skipped: number; onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <Card className="flex flex-col gap-3">
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {lastStep === "saved" ? t.unconfirmedSavedTitle : t.unconfirmedSkippedTitle}
      </h2>
      <Notice tone="caution">{lastStep === "saved" ? t.unconfirmedSavedBody : t.unconfirmedSkippedBody}</Notice>
      <p className="text-sm text-ink-2">
        {t.unconfirmedCountsPrefix} <Num>{saved}</Num> {t.unconfirmedCountsSaved} · <Num>{skipped}</Num> {t.doneSkippedSuffix}
      </p>
      <p className="text-sm text-ink-2">{t.unconfirmedNext}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/journal" size="sm" variant="secondary">
          {t.toJournal}
        </ButtonLink>
        <Button size="sm" variant="quiet" onClick={onBack}>
          {t.backToInterview}
        </Button>
      </div>
    </Card>
  );
}
