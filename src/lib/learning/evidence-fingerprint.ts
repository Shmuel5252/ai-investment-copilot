// Evidence Reach V1 — OD-R1: the deterministic EFFECTIVE EVIDENCE-STATE
// fingerprint that decides whether a Learning synthesis run appends a version.
//
// One synthesis stream per (investor, family). A version is appended ONLY
// when the effective evidence state changes materially; wording alone never
// versions. "Material" is exactly a change of this fingerprint:
//
//   INPUT STATE  = the validated citations of the current synthesis:
//                  (decisionReviewId, stance) for every review the family
//                  offered and the model cited, each mapped to its Decision
//                  (the independent case key) by this investor's reviews.
//   FINGERPRINT  = "lef-v1:" + sorted, de-duplicated entries
//                  "<decisionId>|<decisionReviewId>|<stance>" joined by ";"
//                  — stable identifiers and stances only. No wording, no
//                  descriptions, no ordering, no timestamps, no counts.
//   DECISION     = fingerprint(new) === fingerprint(latest version)
//                  → no version (reported as unchanged; wordingDiffers when
//                    the model re-worded); otherwise → append a version.
//
// So a newly cited decision, a decision the synthesis no longer cites, a
// stance flip, a review replacement (a new review of an already-cited
// decision) and any other change of the cited-review set all version; a
// re-wording over the same set does not. Each version persists its entries
// and fingerprint in provenance_json, so the state that justified it is
// reconstructible without the identity's accumulated evidence rows.
export const LEARNING_EVIDENCE_FINGERPRINT_VERSION = "lef-v1" as const;

export interface FingerprintEntry {
  decisionId: string;
  decisionReviewId: string;
  stance: "supporting" | "contradicting";
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function learningEvidenceFingerprint(entries: readonly FingerprintEntry[]): string {
  const keys = [...new Set(entries.map((e) => `${e.decisionId}|${e.decisionReviewId}|${e.stance}`))].sort(cmp);
  return `${LEARNING_EVIDENCE_FINGERPRINT_VERSION}:${keys.join(";")}`;
}

/** The entries of a synthesis whose reviews map to this investor's decisions (unmapped reviews are not evidence). */
export function fingerprintEntriesOf(
  cited: readonly { decisionReviewId: string; stance: "supporting" | "contradicting" }[],
  reviewDecisionIds: ReadonlyMap<string, string>
): FingerprintEntry[] {
  const out: FingerprintEntry[] = [];
  for (const c of cited) {
    const decisionId = reviewDecisionIds.get(c.decisionReviewId);
    if (decisionId === undefined) continue;
    out.push({ decisionId, decisionReviewId: c.decisionReviewId, stance: c.stance });
  }
  return out;
}

/**
 * The fingerprint a persisted version was justified by: its own provenance
 * (`evidenceFingerprint`, or its `citedReviews` when they carry decision ids);
 * a legacy version with neither is fingerprinted from the identity's evidence
 * rows (the best reconstruction available — documented one-time re-baseline).
 */
export function fingerprintOfVersion(
  provenanceJson: unknown,
  legacyEntries: readonly FingerprintEntry[]
): { fingerprint: string; source: "provenance" | "legacy_rows" } {
  const p = provenanceJson as { evidenceFingerprint?: unknown; citedReviews?: unknown } | null;
  if (p && typeof p.evidenceFingerprint === "string" && p.evidenceFingerprint.startsWith(`${LEARNING_EVIDENCE_FINGERPRINT_VERSION}:`)) {
    return { fingerprint: p.evidenceFingerprint, source: "provenance" };
  }
  if (p && Array.isArray(p.citedReviews)) {
    const entries = p.citedReviews.filter(
      (c): c is FingerprintEntry =>
        !!c && typeof (c as FingerprintEntry).decisionId === "string" && typeof (c as FingerprintEntry).decisionReviewId === "string" &&
        ((c as FingerprintEntry).stance === "supporting" || (c as FingerprintEntry).stance === "contradicting")
    );
    if (entries.length > 0) return { fingerprint: learningEvidenceFingerprint(entries), source: "provenance" };
  }
  return { fingerprint: learningEvidenceFingerprint(legacyEntries), source: "legacy_rows" };
}
