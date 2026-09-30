"use client";

import { useState } from "react";
import Link from "next/link";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, HelpText } from "@/components/ui/states";
import { Quote } from "@/components/ui/quote";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { caseStatusLabel, ideasPage as t } from "@/lib/i18n/strings";

// /ideas — the ideas notebook (Frontend V1, unit 5). An idea is a dated note,
// in the investor's own words, about what drew their attention to a ticker:
// not a recommendation, not evidence, not a ranked opportunity. The page
// only organizes what the backend returns:
//   - the two lists are split by promotedToCaseId and nothing else;
//   - each keeps the order ideas.list returns (newest written first);
//   - the only derived facts are lookups in cases.list: the case a promoted
//     idea became, and an existing case on an unpromoted idea's ticker.
// No price, company, score, age threshold or ranking appears anywhere.

export interface IdeaRow {
  id: string;
  ticker: string;
  noteText: string;
  createdAt: string | Date;
  promotedToCaseId: string | null;
}
export interface CaseRow {
  id: string;
  ticker: string;
  status: string;
  createdAt: string | Date;
}

export interface IdeasActions {
  /** Resolves true when the idea was saved, so the form clears only then. */
  create: { run: (ticker: string, noteText: string) => Promise<boolean>; pending: boolean; error: string | null };
  /** error names the idea whose promotion failed, so it shows on that row only. */
  promote: { run: (ideaId: string) => void; pendingIdeaId: string | null; error: { ideaId: string; message: string } | null };
}

/** Split by the one lifecycle fact the backend has, keeping the returned order in each part. */
export function partitionIdeas<I extends Pick<IdeaRow, "promotedToCaseId">>(ideas: readonly I[]) {
  return { unresearched: ideas.filter((i) => i.promotedToCaseId === null), researched: ideas.filter((i) => i.promotedToCaseId !== null) };
}

/**
 * An existing case for the same ticker: the FIRST match in the order
 * cases.list returns (newest created first). Not a "best" case, just a
 * deterministic pointer; there is no other rule.
 */
export function existingCaseFor<C extends Pick<CaseRow, "ticker">>(ticker: string, cases: readonly C[]): C | undefined {
  return cases.find((c) => c.ticker === ticker);
}

export function IdeasView({ ideas, cases, actions }: { ideas: Loadable<IdeaRow[]>; cases: Loadable<CaseRow[]>; actions: IdeasActions }) {
  // A case lookup that fails or is still loading only removes the joined
  // facts; the ideas themselves never wait for it.
  const caseRows = cases.data ?? [];
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <CaptureForm create={actions.create} />
      <RegionBody q={ideas} lines={4}>
        {(rows) => (rows.length === 0 ? <EmptyState title={t.emptyTitle}>{t.emptyHint}</EmptyState> : <Notebook rows={rows} cases={caseRows} promote={actions.promote} />)}
      </RegionBody>
    </PageShell>
  );
}

function CaptureForm({ create }: { create: IdeasActions["create"] }) {
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const ready = ticker.trim() !== "" && note.trim() !== "";
  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || create.pending) return;
          if (await create.run(ticker, note)) {
            setTicker("");
            setNote("");
          }
        }}
      >
        <h2 className="text-base font-semibold text-ink">{t.captureTitle}</h2>
        <Field label={t.tickerLabel} help={t.tickerHelp} required>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} dir="ltr" className="max-w-48" value={ticker} onChange={(e) => setTicker(e.target.value)} />}
        </Field>
        <Field label={t.noteLabel} help={t.noteHelp} required>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex flex-col items-start gap-2">
          <Button type="submit" variant="primary" disabled={!ready} loading={create.pending} loadingLabel={t.savingButton}>
            {t.saveButton}
          </Button>
          <ActionError message={create.error} />
        </div>
      </form>
    </Card>
  );
}

function Notebook({ rows, cases, promote }: { rows: IdeaRow[]; cases: CaseRow[]; promote: IdeasActions["promote"] }) {
  const { unresearched, researched } = partitionIdeas(rows);
  return (
    <>
      <Section id="unresearched" title={t.unresearchedTitle} count={unresearched.length} hint={t.orderHint}>
        {unresearched.length === 0 ? (
          <p className="text-sm text-ink-2">{t.allResearched}</p>
        ) : (
          <List label={t.unresearchedTitle}>
            {unresearched.map((idea) => (
              <UnresearchedRow key={idea.id} idea={idea} existing={existingCaseFor(idea.ticker, cases)} promote={promote} />
            ))}
          </List>
        )}
      </Section>

      <Section id="researched" title={t.researchedTitle} count={researched.length} hint={t.orderHint}>
        {researched.length === 0 ? (
          <p className="text-sm text-ink-2">{t.noneResearched}</p>
        ) : (
          <List label={t.researchedTitle}>
            {researched.map((idea) => (
              <ResearchedRow key={idea.id} idea={idea} linked={cases.find((c) => c.id === idea.promotedToCaseId)} />
            ))}
          </List>
        )}
      </Section>
    </>
  );
}

// The note leads; the ticker and date follow as muted metadata.
function NoteBody({ idea }: { idea: IdeaRow }) {
  return (
    <>
      <Quote>{idea.noteText}</Quote>
      <p className="text-xs text-muted">
        <Num>{idea.ticker}</Num> · {t.writtenOnPrefix}
        <Num>{day(idea.createdAt)}</Num>
      </p>
    </>
  );
}

function UnresearchedRow({ idea, existing, promote }: { idea: IdeaRow; existing: CaseRow | undefined; promote: IdeasActions["promote"] }) {
  const pending = promote.pendingIdeaId === idea.id;
  return (
    <ListRow
      actionsBelow
      actions={
        <Button size="sm" variant="secondary" onClick={() => promote.run(idea.id)} disabled={promote.pendingIdeaId !== null && !pending} loading={pending} loadingLabel={t.promotingButton}>
          {t.promoteButton}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <NoteBody idea={idea} />
        {existing && (
          <p className="text-xs text-ink-2">
            {t.existingCaseFact} ·{" "}
            <Link href={`/cases/${existing.id}`} className="text-accent underline">
              {t.openExistingCase}
            </Link>
          </p>
        )}
        <HelpText>{t.promoteHelp}</HelpText>
        {promote.error?.ideaId === idea.id && <ActionError message={promote.error.message} />}
      </div>
    </ListRow>
  );
}

function ResearchedRow({ idea, linked }: { idea: IdeaRow; linked: CaseRow | undefined }) {
  return (
    <ListRow
      actions={
        <ButtonLink href={`/cases/${idea.promotedToCaseId}`} size="sm" variant="quiet">
          {t.openCase}
        </ButtonLink>
      }
    >
      <div className="flex flex-col gap-2">
        <NoteBody idea={idea} />
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
          {linked ? (
            <>
              <span>
                {t.becameCasePrefix}
                <Num>{day(linked.createdAt)}</Num>
              </span>
              <Badge tone={linked.status === "researching" ? "info" : "neutral"}>{caseStatusLabel[linked.status] ?? "—"}</Badge>
            </>
          ) : (
            <span>{t.becameCase}</span>
          )}
        </p>
      </div>
    </ListRow>
  );
}
