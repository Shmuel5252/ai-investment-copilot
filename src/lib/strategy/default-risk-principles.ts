// Fixed baseline risk principles (docs/architecture.md §2.4: "סט קבוע של
// עקרונות סיכון בסיסיים — קוד, מסומן ככזה"). These are generic
// risk-management guardrails, not a claim about how *this* investor
// actually behaves — that's what Observed principles are for. They exist
// so Baseline Strategy has a "validated" principle from day one instead
// of faking evidence-based confidence for a pattern nobody has actually
// confirmed yet (No Fake Certainty). Pure data, no AI involved; the
// investor can disagree with any of them once Corrections are wired up
// to Strategy (out of scope for this task — see docs/architecture.md §2.4
// Done bar, which only requires the baseline set to exist and be
// attributed).
export interface DefaultRiskPrinciple {
  key: string;
  statementText: string;
  rationaleText: string;
}

export const DEFAULT_RISK_PRINCIPLES: readonly DefaultRiskPrinciple[] = [
  {
    key: "define-exit-before-entry",
    statementText:
      "Define exit conditions — a target, a stop, or a specific thesis-invalidation trigger — before entering a position, not after.",
    rationaleText:
      "Baseline risk-management guardrail: without a plan set in advance, hold/sell decisions get made under emotional pressure in the moment instead of against a rule you set while thinking clearly.",
  },
  {
    key: "position-sizing-cap",
    statementText:
      "Avoid letting any single position grow large enough to dominate the portfolio without that being a deliberate, consciously sized decision.",
    rationaleText:
      "Baseline risk-management guardrail: concentration that accumulates by accident (a winner left to run, or repeated top-ups) carries the same risk as a deliberate large bet, without the deliberate reasoning behind it.",
  },
  {
    key: "no-averaging-down-without-thesis-recheck",
    statementText:
      "Don't add to a losing position on price alone — only after re-examining whether the original thesis still holds.",
    rationaleText:
      "Baseline risk-management guardrail: a lower cost basis isn't a reason by itself; adding to a position because it's cheaper, without checking whether the thesis broke, is how a bad decision compounds.",
  },
  {
    key: "avoid-correlated-concentration",
    statementText:
      "Watch for concentration across positions that would all move together on the same underlying risk (sector, theme, or macro driver), not just concentration in a single ticker.",
    rationaleText:
      "Baseline risk-management guardrail: a portfolio can look diversified by position count while still being one correlated bet in disguise.",
  },
] as const;
