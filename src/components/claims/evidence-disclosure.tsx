import Link from "next/link";
import { Num } from "@/components/num";
import { List, ListRow } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { HelpText, Skeleton, ErrorState } from "@/components/ui/states";
import { day, type Loadable } from "@/components/home/types";
import {
  decisionStatementKindLabel,
  decisionTypeLabel,
  dnaPage as t,
  evidenceSourceLabel,
  evidenceStanceLabel,
  evidenceStrengthLabel,
} from "@/lib/i18n/strings";
import type { ClaimReach, ClaimVersion, DecisionRef, EvidenceRow } from "./types";

// What stands behind one claim: the facts of its current version, its reach
// facts, and its effective citations. Only what the read paths return is
// shown — a missing provenance or independence record is said as missing,
// and an interview answer's own text is never shown because no read path
// returns it. Citations keep their returned order; contradicting ones stay
// in place, never grouped away.

/** Which kind of source a citation points at, from the one source key it carries. */
export function sourceKindOf(e: EvidenceRow): string {
  if (e.interviewAnswerId) return "interview_answer";
  if (e.decisionId) return "decision_statement";
  if (e.decisionReviewId) return "decision_review";
  if (e.transactionId) return "transaction";
  if (e.sourceLearningInsightId) return "learning_insight";
  if (e.manualNoteText) return "manual_note";
  return "none";
}

interface Basis {
  exact?: boolean;
  supportingUpper?: number;
}
interface Provenance {
  generatedAt?: string;
}

export function VersionFacts({ version, reach, createdByLabel }: { version: ClaimVersion; reach: ClaimReach | undefined; createdByLabel: Record<string, string> }) {
  const basis = (version.independenceBasisJson ?? null) as Basis | null;
  const provenance = (version.provenanceJson ?? null) as Provenance | null;
  return (
    <div className="flex flex-col gap-1.5 text-xs text-ink-2">
      <p>
        {t.versionPrefix} <Num>{version.versionNumber}</Num> · {t.versionCreatedPrefix}
        <Num>{day(version.createdAt)}</Num> · {createdByLabel[version.createdBy] ?? "—"}
      </p>
      {version.changeReason && (
        <p>
          <span className="text-muted">{t.changeReasonLabel}</span> {version.changeReason}
        </p>
      )}
      <p className="text-muted">
        {provenance?.generatedAt ? (
          <>
            {t.provenanceGeneratedPrefix}
            <Num>{day(provenance.generatedAt)}</Num>
          </>
        ) : (
          t.provenanceMissing
        )}
      </p>
      {basis === null ? (
        <p className="text-muted">{t.basisMissing}</p>
      ) : (
        basis.exact === false &&
        typeof basis.supportingUpper === "number" && (
          <p className="text-muted">
            {t.basisRangePrefix} <Num>{basis.supportingUpper}</Num> {t.basisRangeSuffix}
          </p>
        )
      )}
      {reach && (
        <>
          <p className="text-muted">
            {t.sourcesPrefix} <Num>{reach.sources.interviewAnswers}</Num> {t.interviewAnswers} · <Num>{reach.sources.decisionStatements}</Num> {t.decisionStatements}
          </p>
          {reach.distance && (
            <p className="text-muted">
              {t.distancePrefix} {evidenceStrengthLabel[reach.distance.nextTier] ?? "—"} {t.distanceMiddle} <Num>{reach.distance.additionalSupportingCases}</Num> {t.distanceSuffix}
            </p>
          )}
          {reach.unresolvedDecisionIds.length > 0 && (
            <p className="text-muted">
              <Num>{reach.unresolvedDecisionIds.length}</Num> {t.unresolvedSuffix}
            </p>
          )}
        </>
      )}
      <HelpText>{t.casesNote}</HelpText>
    </div>
  );
}

export function EvidenceList({ evidence, decisions }: { evidence: Loadable<EvidenceRow[]>; decisions: readonly DecisionRef[] }) {
  if (evidence.isError) return <ErrorState title={t.evidenceFailed} message={evidence.error?.message ?? null} onRetry={evidence.refetch ? () => void evidence.refetch!() : undefined} />;
  if (evidence.data === undefined) return <Skeleton lines={3} />;
  if (evidence.data.length === 0) return <p className="text-sm text-ink-2">{t.citationsEmpty}</p>;
  return (
    <List label={t.citationsTitle}>
      {evidence.data.map((e) => (
        <CitationRow key={e.id} e={e} decision={e.decisionId ? decisions.find((d) => d.id === e.decisionId) : undefined} />
      ))}
    </List>
  );
}

function CitationRow({ e, decision }: { e: EvidenceRow; decision: DecisionRef | undefined }) {
  const kind = sourceKindOf(e);
  return (
    <ListRow>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={e.stance === "contradicting" ? "negative" : "positive"}>{evidenceStanceLabel[e.stance] ?? "—"}</Badge>
          <span className="text-ink-2">
            {evidenceSourceLabel[kind] ?? "—"}
            {kind === "decision_statement" && e.decisionStatementKind && <> · {decisionStatementKindLabel[e.decisionStatementKind] ?? "—"}</>}
          </span>
          {decision && (
            <span className="text-muted">
              {decisionTypeLabel[decision.decisionType] ?? "—"} <Num>{decision.ticker}</Num> · <Num>{day(decision.decisionDate)}</Num>
            </span>
          )}
          <span className="text-muted">
            <Num>{day(e.createdAt)}</Num>
          </span>
        </div>
        <div>
          <p className="text-xs text-muted">{t.aiSummaryLabel}</p>
          <p className="text-sm text-ink-2">{e.description}</p>
        </div>
        {kind === "interview_answer" && <HelpText>{t.answerTextUnavailable}</HelpText>}
        {kind === "decision_statement" && e.decisionId && (
          <Link href={`/decisions/${e.decisionId}`} className="w-fit text-xs text-accent underline">
            {t.openDecision}
          </Link>
        )}
      </div>
    </ListRow>
  );
}
