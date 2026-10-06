import { Num, shares } from "@/components/num";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, EvidenceTierBadge } from "@/components/ui/badge";
import { Status, Notice } from "@/components/ui/status";
import { Field, Input } from "@/components/ui/field";
import { KeyValues, Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { EmptyState, HelpText } from "@/components/ui/states";
import type { PortfolioFit } from "@/lib/portfolio/portfolio-fit";
import { caseDetailPage as t, evidenceStrengthLabel } from "@/lib/i18n/strings";
import { Provenance } from "@/components/ui/quote";
import { ActionError } from "@/components/ui/action-error";
import { pct, usd } from "./parts";
import type { CaseAction, PersonalFitEvidenceRefs, ProfileItem } from "./types";

// D and E: two different kinds of fit, side by side and never combined.
// Portfolio Fit is arithmetic over the imported trades; Personal Fit is an AI
// reading against the evidenced profile. Neither is graded or colored.

// D — manual only: nothing is computed on load, and before a computation in
// this visit the region says so instead of implying a stored result.
export function PortfolioFitRegion({
  fit,
  hasMarket,
  compute,
  sizeInput,
  onSizeInput,
  readOnly,
}: {
  fit: { data: PortfolioFit; sizeDollars: number | undefined } | undefined;
  hasMarket: boolean;
  compute: CaseAction<[sizeDollars: number | undefined]>;
  sizeInput: string;
  onSizeInput: (v: string) => void;
  readOnly: boolean;
}) {
  if (readOnly) return <HelpText>{t.decidedFitNote}</HelpText>;

  const parsed = sizeInput.trim() === "" ? undefined : Number(sizeInput);
  const sizeInvalid = parsed !== undefined && !(parsed > 0);

  return (
    <div className="flex flex-col gap-3">
      <Provenance>{t.portfolioFitProvenance}</Provenance>
      <Card padding="sm">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sizeInvalid) compute.run(parsed);
          }}
        >
          <Field label={t.hypotheticalSizeLabel} help={t.hypotheticalSizeHelp}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} invalid={invalid || sizeInvalid} dir="ltr" inputMode="decimal" value={sizeInput} onChange={(e) => onSizeInput(e.target.value)} />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="secondary" disabled={!hasMarket || sizeInvalid} loading={compute.pending} loadingLabel={t.computingButton}>
              {fit ? t.recomputeFitButton : t.computeFitButton}
            </Button>
            {fit ? <Status tone="info">{t.computedThisVisit}</Status> : <Status tone="neutral">{t.notComputedThisVisit}</Status>}
          </div>
          {!hasMarket && <HelpText>{t.fitNeedsMarket}</HelpText>}
          {hasMarket && !fit && <HelpText>{t.notComputedHint}</HelpText>}
        </form>
      </Card>
      <ActionError message={compute.error} />
      {fit && <PortfolioFitResult fit={fit.data} sizeDollars={fit.sizeDollars} />}
    </div>
  );
}

function PortfolioFitResult({ fit, sizeDollars }: { fit: PortfolioFit; sizeDollars: number | undefined }) {
  const ofPortfolio = (n: number) => (
    <>
      <Num>{pct(n)}</Num> {t.ofPortfolioSuffix}
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      <Card padding="sm">
        <KeyValues
          items={[
            {
              label: t.totalPortfolioValueLabel,
              value: (
                <>
                  <Num>{usd(fit.totalPortfolioValueUsd)}</Num>
                  {fit.totalPortfolioValueApproximate && <span className="block text-xs text-muted">{t.approximateNote}</span>}
                </>
              ),
            },
            {
              label: t.existingHoldingLabel,
              value: (
                <>
                  <Num>{shares(fit.existingHoldingQuantity)}</Num> {t.sharesLabel} · <Num>{usd(fit.existingPositionValueUsd)}</Num>
                </>
              ),
            },
            { label: t.existingWeightLabel, value: ofPortfolio(fit.existingWeightPercent) },
            {
              label: t.cashLabel,
              value: (
                <>
                  <Num>{usd(fit.cashValueUsd)}</Num> · {ofPortfolio(fit.cashWeightPercent)}
                </>
              ),
            },
            { label: t.holdingsCountLabel, value: <Num>{fit.holdingsCount}</Num> },
            ...(fit.largestCurrentPositionTicker
              ? [
                  {
                    label: t.largestLabel,
                    value: (
                      <>
                        <Num>{fit.largestCurrentPositionTicker}</Num>
                        {fit.largestCurrentPositionWeightPercent !== null && <> · {ofPortfolio(fit.largestCurrentPositionWeightPercent)}</>}
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {fit.projectedWeightPercent !== null && (
        <Card padding="sm">
          <p className="mb-2 text-xs font-semibold text-ink-2">
            {t.projectedTitlePrefix} {sizeDollars !== undefined ? <Num>{usd(sizeDollars)}</Num> : null}
          </p>
          <KeyValues
            items={[
              { label: t.projectedValueLabel, value: fit.projectedPositionValueUsd !== null ? <Num>{usd(fit.projectedPositionValueUsd)}</Num> : "—" },
              { label: t.projectedWeightLabel, value: ofPortfolio(fit.projectedWeightPercent) },
              ...(fit.projectedCashValueUsd !== null && fit.projectedCashWeightPercent !== null
                ? [
                    {
                      label: t.projectedCashLabel,
                      value: (
                        <>
                          <Num>{usd(fit.projectedCashValueUsd)}</Num> · {ofPortfolio(fit.projectedCashWeightPercent)}
                        </>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}

      <ExposureTable title={t.sectorExposureTitle} current={fit.sectorExposure.map((e) => ({ label: e.sector, w: e.weightPercent }))} projected={fit.projectedSectorExposure?.map((e) => ({ label: e.sector, w: e.weightPercent })) ?? null} />
      <ExposureTable title={t.industryExposureTitle} current={fit.industryExposure.map((e) => ({ label: e.industry, w: e.weightPercent }))} projected={fit.projectedIndustryExposure?.map((e) => ({ label: e.industry, w: e.weightPercent })) ?? null} />

      {fit.warnings.length > 0 && (
        <Notice tone="caution" title={t.warningsTitle}>
          {/* computePortfolioFit()'s own sentences, verbatim (a protected calculation module; never translated here) */}
          <ul dir="ltr" lang="en" className="flex list-disc flex-col gap-1 ps-4 text-start text-xs">
            {fit.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

type Exposure = { label: string | null; w: number };

// Current and projected side by side, one row per bucket in either. The arrays
// computePortfolioFit() returns carry no order of their own, so the sort by
// current weight here is required, not cosmetic. Cash is never a bucket.
export function mergeExposure(current: Exposure[], projected: Exposure[] | null) {
  const key = (l: string | null) => l ?? "\u0000";
  const rows = new Map<string, { label: string | null; current: number | null; projected: number | null }>();
  for (const e of current) rows.set(key(e.label), { label: e.label, current: e.w, projected: null });
  for (const e of projected ?? []) {
    const row = rows.get(key(e.label)) ?? { label: e.label, current: null, projected: null };
    row.projected = e.w;
    rows.set(key(e.label), row);
  }
  return [...rows.values()].sort((a, b) => (b.current ?? -1) - (a.current ?? -1) || (b.projected ?? 0) - (a.projected ?? 0));
}

function ExposureTable({ title, current, projected }: { title: string; current: Exposure[]; projected: Exposure[] | null }) {
  const rows = mergeExposure(current, projected);
  if (rows.length === 0) return null;
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{title}</Th>
          <Th numeric>{t.currentColumn}</Th>
          {projected && <Th numeric>{t.projectedColumn}</Th>}
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.label ?? ""}>
            <Td>{r.label === null ? <span className="text-muted">{t.unclassifiedLabel}</span> : <bdi>{r.label}</bdi>}</Td>
            <Td numeric>{r.current === null ? "—" : <Num>{pct(r.current)}</Num>}</Td>
            {projected && <Td numeric>{r.projected === null ? "—" : <Num>{pct(r.projected)}</Num>}</Td>}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

// E — the stored Personal Fit text and the profile items it cites, each with
// its DNA / Strategy identity and its Evidence Strength. When nothing it says
// points at an evidenced item, the region says that plainly.
export function PersonalFitRegion({
  text,
  refs,
  dna,
  strategy,
  hasMarket,
  generate,
  readOnly,
}: {
  text: string | null;
  refs: PersonalFitEvidenceRefs | null;
  dna: ProfileItem[];
  strategy: ProfileItem[];
  hasMarket: boolean;
  generate: CaseAction;
  readOnly: boolean;
}) {
  const button = !readOnly && (
    <Button size="sm" variant="secondary" onClick={() => generate.run()} disabled={!hasMarket} loading={generate.pending} loadingLabel={t.generatingPersonalFit}>
      {text ? t.regeneratePersonalFit : t.generatePersonalFit}
    </Button>
  );

  if (!text) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState title={t.personalFitEmptyTitle} action={button || undefined}>
          {t.personalFitEmpty}
          {!hasMarket && !readOnly && <> {t.personalFitNeedsMarket}</>}
        </EmptyState>
        <ActionError message={generate.error} />
      </div>
    );
  }

  const byId = (list: ProfileItem[]) => new Map(list.map((i) => [i.id, i]));
  const dnaById = byId(dna);
  const strategyById = byId(strategy);
  const traceable = refs?.hasTraceableEvidence === true;
  const cited = traceable
    ? [
        ...refs!.dnaHypothesisIds.map((id) => ({ tag: "DNA", id, item: dnaById.get(id) })),
        ...refs!.strategyPrincipleIds.map((id) => ({ tag: "Strategy", id, item: strategyById.get(id) })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <Provenance>{t.personalFitProvenance}</Provenance>
      <Card padding="sm">
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          <p className="text-ink">{text}</p>
          {!traceable && (
            <div className="flex flex-col items-start gap-1.5 border-t border-rule pt-3">
              <Badge tone="neutral">{evidenceStrengthLabel.insufficient_evidence}</Badge>
              <HelpText>{t.untraceable}</HelpText>
            </div>
          )}
          {cited.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-rule pt-3">
              <p className="text-xs font-semibold text-ink-2">{t.citedTitle}</p>
              <ul className="flex flex-col gap-2">
                {cited.map((c) => (
                  <li key={`${c.tag}:${c.id}`} className="flex flex-col gap-1">
                    <span className="text-sm text-ink">
                      <span className="text-xs font-semibold text-muted">[{c.tag}]</span> {c.item?.statementText ?? <bdi dir="ltr">{c.id}</bdi>}
                    </span>
                    <EvidenceTierBadge tier={c.item?.evidenceStrength} className="w-fit" />
                  </li>
                ))}
              </ul>
              <HelpText>{t.citedTierNote}</HelpText>
            </div>
          )}
        </div>
      </Card>
      {button && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HelpText>{t.personalFitRegenerateWarning}</HelpText>
          {button}
        </div>
      )}
      <ActionError message={generate.error} />
    </div>
  );
}
