"use client";

import { useState } from "react";
import { Num } from "@/components/num";
import { ListRow } from "@/components/ui/list";
import { EvidenceTierBadge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { dnaPage as t } from "@/lib/i18n/strings";
import { ReachLine } from "./reach-line";
import { VersionFacts } from "./evidence-disclosure";
import type { ClaimReach, ClaimVersion } from "./types";

// One claim: its stored wording first, then the current strength of its
// evidence as facts (tier, independent supporting cases, contradicting
// cases, cited statements) and whether the system uses it. Nothing here is
// a score: no percentage, no bar, no rank. The evidence behind it opens in
// place; the citations are mounted only once the reader opens it.
export function StatementRow({
  version,
  reach,
  createdByLabel,
  renderEvidence,
  footer,
}: {
  version: ClaimVersion;
  reach: ClaimReach | undefined;
  createdByLabel: Record<string, string>;
  /** The citation list, rendered only after the disclosure is first opened. */
  renderEvidence: () => React.ReactNode;
  /** Row actions below the evidence (e.g. disagreement). */
  footer?: React.ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <ListRow>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-ink">{version.statementText}</p>
          <EvidenceTierBadge tier={version.evidenceStrength} />
        </div>
        <p className="text-xs text-ink-2">
          <Num>{version.supportingEvidenceCount ?? 0}</Num> {t.supportingCasesSuffix} · <Num>{version.contradictingEvidenceCount ?? 0}</Num> {t.contradictingSuffix}
          {reach && (
            <>
              {" "}
              · <Num>{reach.citedStatementKeys.length}</Num> {t.citedSuffix}
            </>
          )}
        </p>
        <ReachLine reach={reach} />
        <Disclosure summary={t.evidenceTitle} onToggle={(open) => open && setOpened(true)}>
          <VersionFacts version={version} reach={reach} createdByLabel={createdByLabel} />
          {opened && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-ink-2">{t.citationsTitle}</p>
              {renderEvidence()}
            </div>
          )}
        </Disclosure>
        {footer}
      </div>
    </ListRow>
  );
}
