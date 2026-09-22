// Grounding checks are VERSION-scoped and a version with ZERO check rows
// falls back to "every raw citation is effective". A version appended by
// the ordinary generate path used to start with zero rows, so appending one
// after a remediation silently re-admitted every citation that remediation
// had rejected. This builds the check rows such a version must carry:
//   - the base version has NO checks (legacy / never remediated): nothing.
//     The approved zero-check fallback stays exactly as it was, and every
//     row of such an identity was grounded at generation time anyway.
//   - the base version has checks: every base verdict carried forward
//     unchanged (rejections included), plus a "supported" row for each
//     Evidence row this version ADDS — those just passed Evidence Grounding
//     in this very generation. The result is one row per Evidence row that
//     existed for the identity, so the all-or-nothing completeness the
//     effective-evidence rule depends on still holds.
export interface CheckRow {
  evidenceId: string;
  verdict: "supported" | "unsupported";
  reason: string;
}

export function checksForAppendedVersion(
  baseVersionId: string,
  baseChecks: readonly CheckRow[],
  addedEvidenceIds: readonly string[]
): CheckRow[] {
  if (baseChecks.length === 0) return [];
  const carried = baseChecks.map((check) => ({
    evidenceId: check.evidenceId,
    verdict: check.verdict,
    reason:
      `Carried forward unchanged from version ${baseVersionId}: this version only ADDS evidence that passed ` +
      `Evidence Grounding at generation time, so no earlier grounding verdict was re-judged. Original reason: ${check.reason}`,
  }));
  const added = addedEvidenceIds.map((evidenceId) => ({
    evidenceId,
    verdict: "supported" as const,
    reason:
      "Supported by Evidence Grounding at generation time; appended to an identity whose current version " +
      "already carried grounding checks.",
  }));
  return [...carried, ...added];
}
