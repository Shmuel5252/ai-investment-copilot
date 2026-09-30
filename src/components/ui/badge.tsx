import { cx } from "./cx";
import { evidenceStrengthLabel, evidenceTierHint } from "@/lib/i18n/strings";

export type Tone = "neutral" | "info" | "positive" | "caution" | "negative";

const TONE: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  positive: "bg-positive-soft text-positive",
  caution: "bg-caution-soft text-caution",
  negative: "bg-negative-soft text-negative",
};

// A small label on a soft field of its own hue. Tone carries meaning
// (status, stance, kind); a badge never carries a number that matters,
// and never stands alone without text.
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold leading-tight", TONE[tone], className)}>
      {children}
    </span>
  );
}

// Evidence Strength tiers as PRODUCT STATES. The value is the enum the
// backend computed (never touched here); the look is a fixed map from
// tier to tone, so "insufficient" reads as a calm, expected state and the
// scale up to "strong" is visible at a glance. `showHint` adds the
// one-line explanation from evidenceTierHint under the badge, for screens
// where the investor is reading a claim rather than scanning a list.
export type EvidenceTier = "insufficient_evidence" | "weak" | "moderate" | "strong";

export const EVIDENCE_TIER_TONE: Record<EvidenceTier, Tone> = {
  insufficient_evidence: "neutral",
  weak: "caution",
  moderate: "info",
  strong: "positive",
};

export const EVIDENCE_TIERS: readonly EvidenceTier[] = ["insufficient_evidence", "weak", "moderate", "strong"];

export function isEvidenceTier(value: unknown): value is EvidenceTier {
  return typeof value === "string" && (EVIDENCE_TIERS as readonly string[]).includes(value);
}

export function EvidenceTierBadge({ tier, showHint = false, className }: { tier: EvidenceTier | string | null | undefined; showHint?: boolean; className?: string }) {
  // an unknown or missing tier is shown as such, never guessed upward
  if (!isEvidenceTier(tier)) {
    return (
      <Badge tone="neutral" className={className}>
        —
      </Badge>
    );
  }
  const label = evidenceStrengthLabel[tier] ?? tier;
  return showHint ? (
    <div className={cx("flex flex-col items-start gap-1", className)}>
      <Badge tone={EVIDENCE_TIER_TONE[tier]}>
        <span className="text-muted">Evidence Strength:</span> {label}
      </Badge>
      <p className="max-w-[60ch] text-xs leading-relaxed text-muted">{evidenceTierHint[tier]}</p>
    </div>
  ) : (
    <Badge tone={EVIDENCE_TIER_TONE[tier]} className={className} title={evidenceTierHint[tier]}>
      {label}
    </Badge>
  );
}
