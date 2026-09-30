"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageShell, PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { List } from "@/components/ui/list";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/status";
import { EmptyState, HelpText } from "@/components/ui/states";
import { ActionError } from "@/components/ui/action-error";
import { RegionBody } from "@/components/home/region";
import type { Loadable } from "@/components/home/types";
import { StatementRow } from "@/components/claims/statement-row";
import type { ClaimReach, ClaimVersion } from "@/components/claims/types";
import { dnaCreatedByLabel, dnaPage as t } from "@/lib/i18n/strings";

// /dna — Investor DNA (Frontend V1, unit 6A). A DNA statement is a claim
// about a possible recurring pattern, shown with the CURRENT strength of its
// evidence. The page organizes what the backend returns and judges nothing:
//   - the two groups are split by evidence.reach's visibleToAi, the
//     authoritative fact of whether the system uses a claim — never by a
//     threshold recomputed here; a statement with no reach record is shown
//     below the threshold with "not available", never as used;
//   - each group keeps the order dna.list returns, which carries no
//     ordering contract, so it is not described as newest-first or ranked.

export interface DnaStatementRow {
  id: string;
  versions: ClaimVersion[];
}
export interface GenerateResult {
  createdCount: number;
  versionedCount: number;
  unchangedCount: number;
  droppedCount: number;
}
export interface DnaActions {
  generate: { run: () => void; pending: boolean; error: string | null; result: GenerateResult | null };
  /** Resolves true once the statement was rejected; the row leaves only when the list refetches. */
  reject: { run: (dnaHypothesisId: string) => Promise<boolean>; pendingId: string | null; error: { id: string; message: string } | null };
}

/** Split by the authoritative reach fact, keeping the returned order in each part. */
export function groupByReach<S extends { id: string }>(statements: readonly S[], reachById: ReadonlyMap<string, Pick<ClaimReach, "visibleToAi">>) {
  return {
    used: statements.filter((s) => reachById.get(s.id)?.visibleToAi === true),
    below: statements.filter((s) => reachById.get(s.id)?.visibleToAi !== true),
  };
}

export function DnaView({
  statements,
  reach,
  actions,
  renderEvidence,
}: {
  statements: Loadable<DnaStatementRow[]>;
  /** evidence.reach claims for this domain, by claim id. */
  reach: Loadable<ReadonlyMap<string, ClaimReach>>;
  actions: DnaActions;
  renderEvidence: (dnaHypothesisId: string) => React.ReactNode;
}) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      <GeneratePanel generate={actions.generate} />
      <RegionBody q={statements} lines={5}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              title={t.emptyTitle}
              action={
                <ButtonLink href="/interview" size="sm">
                  {t.openInterview}
                </ButtonLink>
              }
            >
              {t.emptyHint}
            </EmptyState>
          ) : (
            <RegionBody q={reach} lines={3}>
              {(reachById) => <Groups rows={rows} reachById={reachById} reject={actions.reject} renderEvidence={renderEvidence} />}
            </RegionBody>
          )
        }
      </RegionBody>
      <Section id="rule" title={t.ruleTitle}>
        <HelpText>{t.ruleText}</HelpText>
      </Section>
    </PageShell>
  );
}

function GeneratePanel({ generate }: { generate: DnaActions["generate"] }) {
  const r = generate.result;
  const nothingNew = r !== null && r.createdCount === 0 && r.versionedCount === 0;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">{t.generateTitle}</h2>
        <HelpText>{t.generateHint}</HelpText>
        <Button variant="secondary" className="w-fit" onClick={generate.run} loading={generate.pending} loadingLabel={t.generatingButton}>
          {t.generateButton}
        </Button>
        {r && (
          <p role="status" className="text-sm text-ink-2">
            {nothingNew && <span className="block">{t.resultNothingNew}</span>}
            <Num>{r.createdCount}</Num> {t.resultCreated} · <Num>{r.versionedCount}</Num> {t.resultVersioned} · <Num>{r.unchangedCount}</Num> {t.resultUnchanged} · <Num>{r.droppedCount}</Num>{" "}
            {t.resultDropped}
          </p>
        )}
        <ActionError message={generate.error} />
      </div>
    </Card>
  );
}

function Groups({
  rows,
  reachById,
  reject,
  renderEvidence,
}: {
  rows: DnaStatementRow[];
  reachById: ReadonlyMap<string, ClaimReach>;
  reject: DnaActions["reject"];
  renderEvidence: (id: string) => React.ReactNode;
}) {
  const withVersion = rows.filter((r) => r.versions[0] !== undefined);
  const { used, below } = groupByReach(withVersion, reachById);
  const row = (s: DnaStatementRow) => (
    <StatementRow
      key={s.id}
      version={s.versions[0]!}
      reach={reachById.get(s.id)}
      createdByLabel={dnaCreatedByLabel}
      renderEvidence={() => renderEvidence(s.id)}
      footer={<RejectControl id={s.id} reject={reject} />}
    />
  );
  return (
    <>
      <Section id="used" title={t.usedTitle} count={used.length} hint={t.usedHint}>
        {used.length === 0 ? <p className="text-sm text-ink-2">{t.usedEmpty}</p> : <List label={t.usedTitle}>{used.map(row)}</List>}
      </Section>
      <Section id="below" title={t.belowTitle} count={below.length} hint={`${t.belowHint} ${t.orderHint}`}>
        {below.length === 0 ? <p className="text-sm text-ink-2">{t.belowEmpty}</p> : <List label={t.belowTitle}>{below.map(row)}</List>}
      </Section>
    </>
  );
}

// Disagreement is one-way today: no read path lists rejected statements and
// no action restores one. The confirmation says so before anything happens.
function RejectControl({ id, reject }: { id: string; reject: DnaActions["reject"] }) {
  const [confirming, setConfirming] = useState(false);
  const pending = reject.pendingId === id;
  if (!confirming) {
    return (
      <Button size="sm" variant="quiet" className="w-fit" onClick={() => setConfirming(true)}>
        {t.rejectButton}
      </Button>
    );
  }
  return (
    <Notice tone="neutral" title={t.rejectConfirmTitle}>
      <p>{t.rejectConfirmText}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="danger" onClick={() => void reject.run(id)} loading={pending} loadingLabel={t.rejecting}>
          {t.rejectConfirm}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setConfirming(false)} disabled={pending}>
          {t.rejectCancel}
        </Button>
      </div>
      {reject.error?.id === id && (
        <div className="mt-2">
          <ActionError message={reject.error.message} />
        </div>
      )}
    </Notice>
  );
}
