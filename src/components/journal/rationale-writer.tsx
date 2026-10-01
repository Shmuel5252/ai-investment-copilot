"use client";

import { useState } from "react";
import { useSubmitGuard } from "@/lib/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { HelpText } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { ActionError } from "@/components/ui/action-error";
import { journalPage as t } from "@/lib/i18n/strings";

// The one rationale writer of the Journal (Frontend V1 unit 7A). It runs the
// existing "Tell me why" contract unchanged: `start` asks the server for the
// fixed question built in code from entry-time facts (no AI) and opens a
// session; `save` stores the investor's text as a new answer. An update is
// the same flow with `supersedes`: a NEW answer, the old row untouched.
//
// The pending guard below is UX only. interview.answer is not idempotent on
// the server; nothing here makes it so.

export interface TellMeWhySession {
  sessionId: string;
  /** The episode's entry BUY, as resolved by the server. */
  transactionId: string;
  questionText: string;
  /** Opaque: the hash of the entry facts at start, sent back with the answer so the server can refuse changed facts. */
  anchorContextHash: string;
}

export interface RationaleActions {
  /** Rejects with the server's message on failure. */
  start: (transactionId: string) => Promise<TellMeWhySession>;
  /** Rejects with the server's message when the answer could not be confirmed as saved. */
  save: (input: { session: TellMeWhySession; answerText: string; supersedesAnswerId?: string }) => Promise<void>;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RationaleWriter({
  transactionId,
  current,
  actions,
  onWritingChange,
}: {
  transactionId: string;
  /** Present for an update: the current effective answer, which the new one supersedes. */
  current?: { id: string; answerText: string };
  actions: RationaleActions;
  onWritingChange?: (writing: boolean) => void;
}) {
  const guard = useSubmitGuard();
  const [open, setOpenState] = useState(false);
  // Kept after closing, so reopening reuses the session the server already
  // opened instead of starting another one.
  const [session, setSession] = useState<TellMeWhySession | null>(null);
  const [text, setText] = useState(current?.answerText ?? "");
  const [pending, setPending] = useState<"start" | "save" | null>(null);
  const [error, setError] = useState<{ kind: "start" | "save"; message: string } | null>(null);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onWritingChange?.(next);
  };
  const isUpdate = current !== undefined;
  const unchanged = isUpdate && text === current.answerText;

  async function openWriter() {
    if (session) return setOpen(true);
    setError(null);
    await guard(async () => {
      setPending("start");
      try {
        setSession(await actions.start(transactionId));
        setOpen(true);
      } catch (e) {
        setError({ kind: "start", message: messageOf(e) });
      } finally {
        setPending(null);
      }
    }, "start");
  }

  async function save() {
    if (!session || text.trim() === "" || unchanged) return;
    setError(null);
    await guard(async () => {
      setPending("save");
      try {
        // Sent exactly as typed: the investor's words are not trimmed or reformatted.
        await actions.save({ session, answerText: text, supersedesAnswerId: current?.id });
        setOpen(false);
      } catch (e) {
        // The text stays. The session is dropped: reopening asks the server
        // again, so the investor sees current facts before trying to save;
        // nothing is retried silently.
        setError({ kind: "save", message: messageOf(e) });
        setSession(null);
        setOpen(false);
      } finally {
        setPending(null);
      }
    }, "save");
  }

  if (!open || !session) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant={isUpdate ? "quiet" : "primary"} onClick={openWriter} loading={pending === "start"} loadingLabel={t.openingButton}>
          {isUpdate ? t.updateButton : t.writeButton}
        </Button>
        {error?.kind === "start" && <ActionError message={error.message} />}
        {error?.kind === "save" && <ActionError title={t.saveFailedTitle} message={error.message} />}
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <Notice tone="neutral">{isUpdate ? t.updateHindsight : t.hindsightNote}</Notice>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-ink-2">{t.questionLabel}</p>
        <p className="text-sm leading-relaxed text-ink">{session.questionText}</p>
        <HelpText>{t.questionProvenance}</HelpText>
      </div>
      <Field label={t.answerLabel} help={isUpdate ? t.updateNote : t.saveNote} required>
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={6} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      {unchanged && <HelpText>{t.updateUnchanged}</HelpText>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={text.trim() === "" || unchanged || pending !== null} loading={pending === "save"} loadingLabel={t.savingButton}>
          {isUpdate ? t.updateSaveButton : t.saveButton}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)} disabled={pending !== null}>
          {t.closeButton}
        </Button>
      </div>
    </Card>
  );
}
