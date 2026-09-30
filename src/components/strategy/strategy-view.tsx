"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, HelpText } from "@/components/ui/states";
import { Quote } from "@/components/ui/quote";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import { day, type Loadable } from "@/components/home/types";
import { StatementRow } from "@/components/claims/statement-row";
import type { ClaimReach, ClaimVersion } from "@/components/claims/types";
import { principleCreatedByLabel, strategyPage as t } from "@/lib/i18n/strings";

// /strategy — the investor's operating document (Frontend V1, unit 6B).
// Three kinds of principle that never merge: declared (adopted by the
// investor), validated (fixed system guardrails) and observed (system
// observations still being tested under the DNA evidence rules). The latest
// APPROVED version — the bundle decisions freeze — is shown apart from the
// LIVE principle list, which can move ahead of it.
//
// What the page can say about the two diverging: strategy.list does not
// return which principle versions an approved bundle holds. It does return
// the bundle's creation time and each principle's current version time.
// approveVersion reads the principle list BEFORE it opens the bundle's
// transaction, so every bundled version was created before the bundle; a
// current version created AFTER the bundle therefore cannot be in it. The
// page states exactly that set, and nothing about the other principles.

export interface PrincipleVersion extends ClaimVersion {
  principleType: string;
  rationaleText: string;
}
export interface PrincipleRow {
  id: string;
  versions: PrincipleVersion[];
}
export interface ApprovedVersion {
  versionNumber: number;
  createdAt: string | Date;
  changeSummary: string;
}
export interface DeclaredCandidate {
  statementText: string;
  rationaleText: string;
  citedAnswerIds: string[];
}
export interface GenerateResult {
  createdCount: number;
  versionedCount: number;
  unchangedCount: number;
  droppedCount: number;
}

export interface StrategyActions {
  approve: { run: (changeSummary: string) => Promise<boolean>; pending: boolean; error: string | null; approvedVersionNumber: number | null };
  propose: { run: () => void; pending: boolean; error: string | null; candidates: DeclaredCandidate[] | null; runId: number };
  /** Resolves true once saved. `index` identifies the candidate within the current proposal run. */
  confirm: { run: (index: number, candidate: DeclaredCandidate) => Promise<boolean>; pendingIndex: number | null; error: { index: number; message: string } | null };
  generate: { run: () => void; pending: boolean; error: string | null; result: GenerateResult | null };
}

/** Current principle versions created after the approved bundle — the ones that cannot be in it. */
export function newerThanApproval(principles: readonly PrincipleRow[], approved: ApprovedVersion | null): Set<string> {
  if (!approved) return new Set();
  const cut = new Date(approved.createdAt).getTime();
  return new Set(principles.filter((p) => p.versions[0] && new Date(p.versions[0].createdAt).getTime() > cut).map((p) => p.id));
}

/** Split by principle type, keeping the order strategy.list returns in each part. */
export function byType(principles: readonly PrincipleRow[]) {
  const of = (type: string) => principles.filter((p) => p.versions[0]?.principleType === type);
  return { declared: of("declared"), validated: of("validated"), observed: of("observed") };
}

const normalize = (s: string) => s.trim();

export function StrategyView({
  strategy,
  reach,
  actions,
  renderEvidence,
}: {
  strategy: Loadable<{ principles: PrincipleRow[]; latestVersion: ApprovedVersion | null }>;
  reach: Loadable<ReadonlyMap<string, ClaimReach>>;
  actions: StrategyActions;
  renderEvidence: (strategyPrincipleId: string) => React.ReactNode;
}) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <RegionBody q={strategy} lines={6}>
        {({ principles, latestVersion }) => {
          const newer = newerThanApproval(principles, latestVersion);
          const groups = byType(principles);
          const declaredTexts = new Set(groups.declared.map((p) => normalize(p.versions[0]!.statementText)));
          return (
            <>
              <Section id="approved" title={t.approvedTitle}>
                <ApprovedCard approved={latestVersion} newerCount={newer.size} approve={actions.approve} />
              </Section>

              <Section id="live" title={t.livePrinciplesTitle} hint={t.livePrinciplesHint}>
                <div className="flex flex-col gap-8">
                  <TypeSection id="declared" title={t.declaredTitle} hint={t.declaredHint} empty={t.declaredEmpty} count={groups.declared.length}>
                    {groups.declared.map((p) => (
                      <PlainPrinciple key={p.id} p={p} newer={newer.has(p.id)} adopted />
                    ))}
                  </TypeSection>
                  <TypeSection id="validated" title={t.validatedTitle} hint={t.validatedHint} empty={t.validatedEmpty} count={groups.validated.length}>
                    {groups.validated.map((p) => (
                      <PlainPrinciple key={p.id} p={p} newer={newer.has(p.id)} adopted={false} />
                    ))}
                  </TypeSection>
                  <TypeSection id="observed" title={t.observedTitle} hint={t.observedHint} empty={t.observedEmpty} count={groups.observed.length}>
                    {groups.observed.map((p) => (
                      <ObservedPrinciple key={p.id} p={p} newer={newer.has(p.id)} reach={reach} renderEvidence={renderEvidence} />
                    ))}
                  </TypeSection>
                </div>
              </Section>

              <DeclaredFlow key={actions.propose.runId} propose={actions.propose} confirm={actions.confirm} existingDeclared={declaredTexts} />
              <GeneratePanel generate={actions.generate} />
            </>
          );
        }}
      </RegionBody>
    </PageShell>
  );
}

// The latest approved bundle: a frozen record, with its drift and the
// approval form. Older versions exist but no read path returns them.
function ApprovedCard({ approved, newerCount, approve }: { approved: ApprovedVersion | null; newerCount: number; approve: StrategyActions["approve"] }) {
  return (
    <div className="flex flex-col gap-4">
      {approved ? (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink">
              {t.approvedVersionPrefix} <Num>{approved.versionNumber}</Num> · {t.approvedOnPrefix}
              <Num>{day(approved.createdAt)}</Num>
            </p>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted">{t.approvedSummaryLabel}</p>
              <Quote>{approved.changeSummary}</Quote>
            </div>
            <HelpText>{t.approvedFrozenNote}</HelpText>
            {newerCount > 0 && (
              <p className="border-t border-rule pt-3 text-sm text-ink-2">
                <Num>{newerCount}</Num> {t.driftMiddle}
              </p>
            )}
            <HelpText>{t.historyNote}</HelpText>
          </div>
        </Card>
      ) : (
        <EmptyState title={t.noApprovedTitle}>{t.noApprovedHint}</EmptyState>
      )}
      <ApproveForm approve={approve} />
    </div>
  );
}

// Click-only: pressing Enter in the summary never creates a version, and
// every approval is a new version, so the action stays deliberate.
function ApproveForm({ approve }: { approve: StrategyActions["approve"] }) {
  const [summary, setSummary] = useState("");
  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">{t.approveTitle}</h3>
        <HelpText>{t.approveHint}</HelpText>
        <Field label={t.summaryLabel} help={t.summaryHelp} required>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
        <Button
          variant="secondary"
          className="w-fit"
          onClick={async () => {
            if (await approve.run(summary)) setSummary("");
          }}
          disabled={summary.trim() === ""}
          loading={approve.pending}
          loadingLabel={t.approvingButton}
        >
          {t.approveButton}
        </Button>
        {approve.approvedVersionNumber !== null && (
          <p role="status" className="text-sm text-ink-2">
            {t.approvedAsPrefix} <Num>{approve.approvedVersionNumber}</Num>.
          </p>
        )}
        <ActionError message={approve.error} />
      </div>
    </Card>
  );
}

function TypeSection({ id, title, hint, empty, count, children }: { id: string; title: string; hint: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <Section id={id} title={title} count={count} hint={hint}>
      {count === 0 ? <p className="text-sm text-ink-2">{empty}</p> : <List label={title}>{children}</List>}
    </Section>
  );
}

function NewerMarker({ newer }: { newer: boolean }) {
  return newer ? <p className="text-xs text-ink-2">{t.driftMarker}</p> : null;
}

// Declared: the investor's adopted wording, quoted. Validated: the system's
// fixed guardrail, plain text with its origin. Neither carries a tier.
function PlainPrinciple({ p, newer, adopted }: { p: PrincipleRow; newer: boolean; adopted: boolean }) {
  const v = p.versions[0]!;
  return (
    <ListRow>
      <div className="flex flex-col gap-2">
        {adopted ? <Quote>{v.statementText}</Quote> : <p className="text-sm leading-relaxed text-ink">{v.statementText}</p>}
        {v.rationaleText && (
          <p className="text-xs text-ink-2">
            <span className="text-muted">{t.rationaleLabel}</span> {v.rationaleText}
          </p>
        )}
        <p className="text-xs text-muted">
          {adopted ? t.declaredOrigin : t.validatedOrigin} · <Num>{day(v.createdAt)}</Num>
        </p>
        <NewerMarker newer={newer} />
      </div>
    </ListRow>
  );
}

// Observed: the Unit 6A claim row, unchanged — tier, counts, reach and the
// evidence disclosure. No disagreement action exists for principles.
function ObservedPrinciple({
  p,
  newer,
  reach,
  renderEvidence,
}: {
  p: PrincipleRow;
  newer: boolean;
  reach: Loadable<ReadonlyMap<string, ClaimReach>>;
  renderEvidence: (id: string) => React.ReactNode;
}) {
  return (
    <StatementRow
      version={p.versions[0]!}
      reach={reach.data?.get(p.id)}
      createdByLabel={principleCreatedByLabel}
      renderEvidence={() => renderEvidence(p.id)}
      footer={<NewerMarker newer={newer} />}
    />
  );
}

// AI proposes → the investor reviews and may edit → the investor confirms.
// A candidate whose wording equals an existing declared principle is not
// offered for confirmation (the backend would store a second identical one).
function DeclaredFlow({
  propose,
  confirm,
  existingDeclared,
}: {
  propose: StrategyActions["propose"];
  confirm: StrategyActions["confirm"];
  existingDeclared: ReadonlySet<string>;
}) {
  const candidates = propose.candidates;
  return (
    <Section id="propose" title={t.proposeTitle}>
      <Card padding="sm">
        <div className="flex flex-col gap-3">
          <HelpText>{t.proposeHint}</HelpText>
          <Button variant="secondary" className="w-fit" onClick={propose.run} loading={propose.pending} loadingLabel={t.proposingButton}>
            {t.proposeButton}
          </Button>
          <ActionError message={propose.error} />
          {candidates && candidates.length === 0 && <p role="status" className="text-sm text-ink-2">{t.proposeNone}</p>}
        </div>
      </Card>
      {candidates && candidates.length > 0 && (
        <List label={t.candidatesTitle}>
          {candidates.map((c, i) => (
            <CandidateRow key={i} index={i} candidate={c} confirm={confirm} existingDeclared={existingDeclared} />
          ))}
        </List>
      )}
    </Section>
  );
}

function CandidateRow({
  index,
  candidate,
  confirm,
  existingDeclared,
}: {
  index: number;
  candidate: DeclaredCandidate;
  confirm: StrategyActions["confirm"];
  existingDeclared: ReadonlySet<string>;
}) {
  const [text, setText] = useState(candidate.statementText);
  const [done, setDone] = useState(false);
  const pending = confirm.pendingIndex === index;
  const duplicate = existingDeclared.has(normalize(text));
  return (
    <ListRow>
      <div className="flex flex-col gap-2">
        <Field label={t.candidateLabel} help={t.candidateHelp}>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} className="min-h-20" value={text} disabled={done} onChange={(e) => setText(e.target.value)} />}
        </Field>
        {candidate.rationaleText && (
          <p className="text-xs text-ink-2">
            <span className="text-muted">{t.candidateRationaleLabel}</span> {candidate.rationaleText}
          </p>
        )}
        {done ? (
          <p role="status" className="text-sm text-ink-2">
            {t.confirmed}
          </p>
        ) : duplicate ? (
          <p className="text-sm text-ink-2">{t.duplicateNote}</p>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="w-fit"
            onClick={async () => {
              if (await confirm.run(index, { ...candidate, statementText: text.trim() })) setDone(true);
            }}
            disabled={text.trim() === "" || (confirm.pendingIndex !== null && !pending)}
            loading={pending}
            loadingLabel={t.confirmingButton}
          >
            {t.confirmButton}
          </Button>
        )}
        {confirm.error?.index === index && <ActionError message={confirm.error.message} />}
      </div>
    </ListRow>
  );
}

function GeneratePanel({ generate }: { generate: StrategyActions["generate"] }) {
  const r = generate.result;
  const nothingNew = r !== null && r.createdCount === 0 && r.versionedCount === 0;
  return (
    <Section id="generate" title={t.generateTitle}>
      <Card padding="sm">
        <div className="flex flex-col gap-3">
          <HelpText>{t.generateHint}</HelpText>
          <Button variant="secondary" className="w-fit" onClick={generate.run} loading={generate.pending} loadingLabel={t.generatingButton}>
            {t.generateButton}
          </Button>
          {r && (
            <p role="status" className="text-sm text-ink-2">
              {nothingNew && <span className="block">{t.resultNothingNew}</span>}
              <Num>{r.createdCount}</Num> {t.resultCreated} · <Num>{r.versionedCount}</Num> {t.resultVersioned} · <Num>{r.unchangedCount}</Num> {t.resultUnchanged} ·{" "}
              <Num>{r.droppedCount}</Num> {t.resultDropped}
            </p>
          )}
          <ActionError message={generate.error} />
        </div>
      </Card>
    </Section>
  );
}
