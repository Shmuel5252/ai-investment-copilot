"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, EvidenceTierBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/status";
import { Input } from "@/components/ui/field";
import { KeyValues, Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { HelpText } from "@/components/ui/states";
import { Provenance, Quote } from "@/components/ui/quote";
import { PriorRecordBriefView } from "@/components/prior-record-brief";
import type { PriorRecordBrief } from "@/lib/prior-record/prior-record";
import { citedFieldLabel, decisionPage as t, decisionTypeLabel, decisionsListPage, priorRecord as tPrior } from "@/lib/i18n/strings";
import { ActionError } from "@/components/ui/action-error";
import { Disclosure, dateTime, day, isBackdated, signedPct, usd } from "./parts";
import type { DecisionAction, DecisionRow, FrozenCaseCopy, FrozenPortfolioState, MarketContextRow, SnapshotRow } from "./types";

// A — the header: what was decided, when it was decided and when it was
// recorded, and the permanent-record status.
export function DecisionHeader({
  decision,
  snapshot,
  setReviewDate,
}: {
  decision: DecisionRow;
  snapshot: SnapshotRow | null;
  setReviewDate: DecisionAction<[date: string]>;
}) {
  const backdated = snapshot !== null && isBackdated(decision.decisionDate, snapshot.createdAt);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={{ href: "/decisions", label: decisionsListPage.title }}
        title={
          <>
            {decisionTypeLabel[decision.decisionType] ?? decision.decisionType} <Num>{decision.ticker}</Num>
          </>
        }
        meta={
          <>
            <Badge tone="neutral">{t.immutableBadge}</Badge> · {t.decidedOnPrefix}
            <Num>{day(decision.decisionDate)}</Num>
            {backdated && (
              <>
                {" · "}
                {t.recordedOnPrefix}
                <Num>{day(snapshot!.createdAt)}</Num>
              </>
            )}
            {snapshot && (
              <>
                {" · "}
                {t.priceAtRecordLabel} <Num>{usd(Number(snapshot.priceAtDecision))}</Num>
                {snapshot.size !== null && (
                  <>
                    {" · "}
                    {t.sizeLabel} <Num>{usd(Number(snapshot.size))}</Num>
                  </>
                )}
              </>
            )}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/cases/${decision.investmentCaseId}`} variant="secondary">
              {t.openCase}
            </ButtonLink>
            {snapshot && (
              <ButtonLink href="#review" variant="quiet">
                {t.goToReview}
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="-mt-2 text-sm text-ink-2">
        <ReviewHorizon reviewByDate={decision.reviewByDate} action={setReviewDate} />
      </div>
      {backdated && (
        <Notice tone="info" title={t.backdatedTitle}>
          {t.backdatedNote}
        </Notice>
      )}
    </div>
  );
}

// The review horizon: shown when set; a legacy decision without one may get
// it exactly once (decisions.setReviewByDate, NULL -> date only).
function ReviewHorizon({ reviewByDate, action }: { reviewByDate: string | Date | null; action: DecisionAction<[date: string]> }) {
  const [draft, setDraft] = useState("");
  if (reviewByDate) {
    return (
      <span>
        {t.reviewByPrefix} <Num>{day(reviewByDate)}</Num>
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span>{t.noReviewDate}</span>
        <Input type="date" aria-label={t.reviewDateLabel} className="max-w-44" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={() => void action.run(draft)} disabled={draft === ""} loading={action.pending} loadingLabel={t.settingReviewDateButton}>
          {t.setReviewDateButton}
        </Button>
      </div>
      <HelpText>{t.reviewDateSetOnceNote}</HelpText>
      <ActionError title={t.actionFailed} message={action.error} />
    </div>
  );
}

// B, C, D — THEN: the frozen record. The investor's own words first and
// largest; the AI's words from recording after them, marked as such; the
// frozen context as reference material behind disclosures.
export function ThenRecord({
  snapshot,
  marketContext,
  currentStrategyVersionId,
}: {
  snapshot: SnapshotRow;
  marketContext: MarketContextRow | null;
  /** undefined = not known right now (strategy.list loading or failed). */
  currentStrategyVersionId: string | null | undefined;
}) {
  const interpretation = snapshot.thesis?.aiInterpretationText ?? null;
  const assessment = snapshot.aiRealtimeAssessmentText;
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <InvestorText label={t.reasoningLabel} text={snapshot.userReasoningText} primary />
          <InvestorText label={t.risksLabel} text={snapshot.risksConsideredText} />
          <InvestorText label={t.exitConditionsLabel} text={snapshot.exitConditionsText} />
          <Provenance>{t.statementsNote}</Provenance>
        </div>

        {(interpretation || assessment) && (
          <div className="flex flex-col gap-3 border-t border-rule pt-4">
            <h3 className="text-sm font-semibold text-ink-2">{t.aiAtRecordTitle}</h3>
            <Provenance>{t.aiAtRecordNote}</Provenance>
            {interpretation && <AiText label={t.thesisInterpretationLabel} text={interpretation} />}
            {assessment && <AiText label={t.realtimeAssessmentLabel} text={assessment} />}
          </div>
        )}

        <div className="border-t border-rule pt-3">
          <Disclosure summary={t.frozenContextTitle}>
            <FrozenContext snapshot={snapshot} marketContext={marketContext} currentStrategyVersionId={currentStrategyVersionId} />
          </Disclosure>
        </div>
      </div>
    </Card>
  );
}

function InvestorText({ label, text, primary = false }: { label: string; text: string | null; primary?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-muted">{label}</h3>
      {text ? <Quote className={primary ? "text-base" : undefined}>{text}</Quote> : <p className="text-sm text-muted">{t.notWritten}</p>}
    </div>
  );
}

function AiText({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="text-sm leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

function FrozenContext({
  snapshot,
  marketContext,
  currentStrategyVersionId,
}: {
  snapshot: SnapshotRow;
  marketContext: MarketContextRow | null;
  currentStrategyVersionId: string | null | undefined;
}) {
  const portfolio = snapshot.portfolioStateJson as FrozenPortfolioState;
  const caseCopy = (snapshot.investmentCaseSnapshotJson ?? {}) as FrozenCaseCopy;
  const brief = snapshot.priorRecordJson as PriorRecordBrief | null;
  const strategyLine =
    currentStrategyVersionId === undefined ? t.strategyUnknown : currentStrategyVersionId === snapshot.strategyVersionId ? t.strategyIsCurrent : t.strategyIsOlder;

  return (
    <div className="flex flex-col gap-3 ps-4">
      <Disclosure summary={t.portfolioStateTitle}>
        <p className="text-sm">
          {t.cashLabel} <Num>{usd(portfolio.cash)}</Num>
        </p>
        {portfolio.positions.length > 0 ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t.tickerColumn}</Th>
                <Th numeric>{t.quantityColumn}</Th>
                <Th numeric>{t.avgCostColumn}</Th>
              </Tr>
            </THead>
            <TBody>
              {portfolio.positions.map((p) => (
                <Tr key={p.ticker}>
                  <Td>
                    <Num>{p.ticker}</Num>
                  </Td>
                  <Td numeric>
                    <Num>{p.quantity}</Num>
                  </Td>
                  <Td numeric muted={p.costBasisPerShare === null}>
                    {p.costBasisPerShare !== null ? <Num>{usd(p.costBasisPerShare)}</Num> : t.costUnknown}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <HelpText>{t.noOtherHoldings}</HelpText>
        )}
      </Disclosure>

      {marketContext && (
        <Disclosure summary={t.marketContextTitle}>
          <KeyValues
            items={[
              {
                label: "S&P 500",
                value: (
                  <>
                    <Num>{Number(marketContext.indexLevel).toFixed(2)}</Num> (<Num>{signedPct(Number(marketContext.indexChange1d), 2)}</Num> {t.indexChangeSuffix})
                  </>
                ),
              },
              ...(marketContext.volatilityIndexValue !== null ? [{ label: "VIX", value: <Num>{Number(marketContext.volatilityIndexValue).toFixed(2)}</Num> }] : []),
            ]}
          />
          <HelpText>
            {t.capturedPrefix}
            <Num>{dateTime(marketContext.capturedAt)}</Num>
          </HelpText>
        </Disclosure>
      )}

      {snapshot.dnaReferences.length > 0 && (
        <Disclosure summary={t.dnaTitle}>
          <HelpText>{t.dnaNote}</HelpText>
          <ul className="flex flex-col gap-2 text-sm">
            {snapshot.dnaReferences.map((ref) => (
              <li key={ref.dnaHypothesisVersionId} className="flex flex-col items-start gap-1">
                <span className="text-ink">{ref.dnaHypothesisVersion.statementText}</span>
                <EvidenceTierBadge tier={ref.dnaHypothesisVersion.evidenceStrength} />
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <Disclosure summary={t.strategyTitle}>
        <p className="text-sm text-ink-2">{strategyLine}</p>
        <HelpText>{t.strategyLimitation}</HelpText>
      </Disclosure>

      <Disclosure summary={t.caseCopyTitle}>
        <CaseCopy copy={caseCopy} />
      </Disclosure>

      <Disclosure summary={tPrior.frozenTitle}>
        {brief ? <PriorRecordBriefView brief={brief} frozen /> : <HelpText>{tPrior.legacyNote}</HelpText>}
      </Disclosure>
    </div>
  );
}

// The frozen case copy, only the parts a Review may cite. Its own AI and
// FMP text, as stored.
function CaseCopy({ copy }: { copy: FrozenCaseCopy }) {
  const m = copy.marketIntelligenceJson;
  // Labelled with the same names the Review citations use, so a citation
  // reads as a pointer to the section it names.
  const texts: [string, string | null | undefined][] = [
    [citedFieldLabel.caseBullCaseText!, copy.bullCaseText],
    [citedFieldLabel.caseBearCaseText!, copy.bearCaseText],
    [citedFieldLabel.caseCatalystsText!, copy.catalystsText],
    [citedFieldLabel.caseInvalidationConditionsText!, copy.invalidationConditionsText],
    [citedFieldLabel.caseMarketBlindspotText!, copy.marketBlindspotText],
    [citedFieldLabel.caseDevilsAdvocateText!, copy.devilsAdvocateText],
    [citedFieldLabel.casePersonalFitText!, copy.personalFitText],
    [citedFieldLabel.casePortfolioFitText!, copy.portfolioFitText],
  ];
  const present = texts.filter(([, v]) => v);
  if (!m && present.length === 0) return <HelpText>{t.caseCopyEmpty}</HelpText>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <HelpText>{t.caseCopyNote}</HelpText>
      {m && (
        <p className="text-ink-2">
          <span className="text-xs font-semibold text-muted">{citedFieldLabel.caseMarketIntelligence}: </span>
          <bdi>
            {m.companyName}
            {m.sector ? ` · ${m.sector}` : ""}
            {m.industry ? ` · ${m.industry}` : ""}
          </bdi>
          {m.price !== undefined && (
            <>
              {" · "}
              <Num>{usd(m.price)}</Num>
            </>
          )}
        </p>
      )}
      {present.map(([label, text]) => (
        <div key={label}>
          <p className="text-xs font-semibold text-muted">{label}</p>
          <p className="leading-relaxed text-ink-2">{text}</p>
        </div>
      ))}
    </div>
  );
}
