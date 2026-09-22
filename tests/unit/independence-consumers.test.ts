import { describe, expect, it } from "vitest";
import { validateProposedHypotheses, type ValidatedHypothesis } from "@/lib/dna/validate-hypotheses";
import { validateProposedObservedPrinciples, type ValidatedObservedPrinciple } from "@/lib/strategy/validate-principles";
import { groundValidatedHypotheses } from "@/lib/dna/ground-evidence";
import { groundValidatedObservedPrinciples } from "@/lib/strategy/ground-evidence";
import { planGroundingRemediation } from "@/lib/dna/remediate-grounding";
import { planPrincipleGroundingRemediation } from "@/lib/strategy/remediate-grounding";
import { resolveHypothesisIdentities } from "@/lib/dna/resolve-hypothesis-identity";
import { resolveObservedPrincipleIdentities } from "@/lib/strategy/resolve-principle-identity";
import {
  assessCitations,
  createIndependenceResolver,
  type EffectiveLinkFact,
  type EvidenceCitation,
} from "@/lib/evidence/resolve-independence";
import { MP_ANSWERS, MP_TRADES, contextFromTrades, fixtureBasis } from "../helpers/independence";

// DNA and Strategy must be ONE algorithm end to end. Every assertion here
// feeds identical inputs through both domains' real production functions
// (only the AI-boundary callbacks are injected) and demands identical
// counts AND identical bases — and identical to what a bare
// assessCitations() says for the same surviving evidence.
const resolver = createIndependenceResolver(contextFromTrades(MP_TRADES, MP_ANSWERS));
const d = (text: string) => text;
const evidence = (...specs: [string, "supporting" | "contradicting"][]) =>
  specs.map(([interviewAnswerId, stance]) => ({ interviewAnswerId, stance, description: d("cited") }));
const asCitations = (rows: { interviewAnswerId: string; stance: "supporting" | "contradicting" }[]): EvidenceCitation[] =>
  rows.map((r) => ({ interviewAnswerId: r.interviewAnswerId, stance: r.stance }));

const REALLOCATION = evidence(["a-mp-s2", "supporting"], ["a-mrvl", "supporting"]);

describe("17. validation parity", () => {
  it("DNA and Strategy validators give identical counts, tier and basis for the same citations", () => {
    const dna = validateProposedHypotheses([{ statement: "claim", evidence: REALLOCATION }], resolver)[0]!;
    const strategy = validateProposedObservedPrinciples([{ statement: "claim", evidence: REALLOCATION }], resolver)[0]!;

    expect(dna.supportingCount).toBe(1);
    expect(dna.contradictingCount).toBe(0);
    expect(dna.evidenceStrength).toBe("insufficient_evidence");
    expect(dna.independenceBasis.supportingUpper).toBe(2);
    expect(strategy.supportingCount).toBe(dna.supportingCount);
    expect(strategy.contradictingCount).toBe(dna.contradictingCount);
    expect(strategy.evidenceStrength).toBe(dna.evidenceStrength);
    expect(strategy.independenceBasis).toEqual(dna.independenceBasis);
    expect(dna.independenceBasis).toEqual(assessCitations(resolver, asCitations(REALLOCATION)).independenceBasis);
  });

  it("the validators use the resolver's notion of a real answer (an unknown answer id is dropped in both)", () => {
    const rows = evidence(["a-mp-s2", "supporting"], ["ghost", "supporting"]);
    expect(validateProposedHypotheses([{ statement: "c", evidence: rows }], resolver)[0]?.evidence).toHaveLength(1);
    expect(validateProposedObservedPrinciples([{ statement: "c", evidence: rows }], resolver)[0]?.evidence).toHaveLength(1);
  });
});

describe("18. generation / grounding / remediation parity", () => {
  const supportedAll = async () => ({ verdict: "supported" as const, reason: "matches" });
  const texts = new Map(MP_ANSWERS.map((a) => [a.id, a.text ?? ""]));
  const hypothesis = (rows: ReturnType<typeof evidence>): ValidatedHypothesis => ({
    statement: "claim",
    evidence: rows,
    supportingCount: 99,
    contradictingCount: 0,
    evidenceStrength: "strong",
    independenceBasis: fixtureBasis(99, 0),
  });
  const principle = (rows: ReturnType<typeof evidence>): ValidatedObservedPrinciple => hypothesis(rows);

  it("grounding recounts from the SURVIVORS through the resolver in both domains, ignoring stale counts and stale bases", async () => {
    const rows = evidence(["a-mp-s2", "supporting"], ["a-mrvl", "supporting"], ["a-mp-buy", "supporting"]);
    const rejectMpBuy = async (input: { sourceAnswerText: string }) =>
      input.sourceAnswerText.includes("נכנסתי")
        ? { verdict: "unsupported" as const, reason: "no" }
        : { verdict: "supported" as const, reason: "ok" };

    const dna = (await groundValidatedHypotheses([hypothesis(rows)], texts, resolver, rejectMpBuy)).hypotheses[0]!;
    const strategy = (await groundValidatedObservedPrinciples([principle(rows)], texts, resolver, rejectMpBuy)).principles[0]!;

    expect(dna.supportingCount).toBe(1); // MP sale + MRVL buy = one weak-linked decision; the entry was rejected
    expect(dna.independenceBasis.groups.flatMap((g) => g.citations).sort()).toEqual(["answer:a-mp-s2", "answer:a-mrvl"]);
    expect({ ...strategy }).toEqual({ ...dna });
    expect(dna.independenceBasis).toEqual(assessCitations(resolver, asCitations(dna.evidence)).independenceBasis);
  });

  it("grounding with nothing rejected still collapses the reallocation (generation path)", async () => {
    const dna = (await groundValidatedHypotheses([hypothesis(REALLOCATION)], texts, resolver, supportedAll)).hypotheses[0]!;
    expect(dna.supportingCount).toBe(1);
    expect(dna.contradictingCount).toBe(0);
  });

  describe("remediation", () => {
    const raw = [
      { id: "e1", interviewAnswerId: "a-mp-s2", stance: "supporting" as const },
      { id: "e2", interviewAnswerId: "a-mrvl", stance: "supporting" as const },
      { id: "e3", interviewAnswerId: "a-mp-buy", stance: "supporting" as const },
    ];
    const rejectE3 = async (input: { sourceAnswerText: string }) =>
      input.sourceAnswerText.includes("נכנסתי")
        ? { verdict: "unsupported" as const, reason: "no" }
        : { verdict: "supported" as const, reason: "ok" };
    const common = { rawEvidence: raw, answerTextById: texts, independence: resolver, alreadyGroundedEvidenceIds: null };

    it("DNA and Strategy remediation plan the same counts and basis, and match the generation path for the same survivors", async () => {
      const dna = await planGroundingRemediation({ ...common, currentVersion: { id: "v1", statementText: "claim" } }, rejectE3);
      const strategy = await planPrincipleGroundingRemediation(
        { ...common, currentVersion: { id: "v1", statementText: "claim", principleType: "observed" } },
        rejectE3
      );
      if (dna.action !== "new_version" || strategy.action !== "new_version") throw new Error("expected new_version in both");

      expect(dna.version.supportingEvidenceCount).toBe(1);
      expect(strategy.version.supportingEvidenceCount).toBe(1);
      expect(strategy.version.independenceBasis).toEqual(dna.version.independenceBasis);
      expect(strategy.version.evidenceStrength).toBe(dna.version.evidenceStrength);

      // The generation path over the same survivors says exactly the same thing.
      const generation = assessCitations(resolver, [
        { interviewAnswerId: "a-mp-s2", stance: "supporting" },
        { interviewAnswerId: "a-mrvl", stance: "supporting" },
      ]);
      expect(dna.version.independenceBasis).toEqual(generation.independenceBasis);
      expect(dna.version.supportingEvidenceCount).toBe(generation.supportingCount);
    });

    it("evidence with no linked answer stays its own case (the e.id fallback) and is counted as unanchored", async () => {
      const withNote = [...raw, { id: "note-1", interviewAnswerId: null, stance: "supporting" as const }];
      const dna = await planGroundingRemediation(
        { ...common, rawEvidence: withNote, currentVersion: { id: "v1", statementText: "claim" } },
        rejectE3
      );
      if (dna.action !== "new_version") throw new Error("expected new_version");
      expect(dna.version.supportingEvidenceCount).toBe(2); // the weak-linked pair (1) + the unanchored note (1)
      expect(dna.version.independenceBasis.unanchoredCitations).toBe(1);
    });
  });
});

describe("19. identity resolution under dependence: recording a citation is not proving a new independent case", () => {
  interface Outcome {
    action: "new_identity" | "new_version" | "no_new_information";
    newEvidenceAnswers?: string[];
    supporting?: number;
    contradicting?: number;
    supportingUpper?: number;
    hasBasis?: boolean;
  }
  type Domain = { name: string; run: (existing: string[], proposed: string[], independence: ReturnType<typeof createIndependenceResolver>) => Promise<Outcome> };
  const same = async () => ({ matchedId: "existing", reason: "same claim" });

  const domains: Domain[] = [
    {
      name: "DNA",
      run: async (existing, proposed, independence) => {
        const [r] = await resolveHypothesisIdentities(
          [{ statement: "claim", evidence: evidence(...proposed.map((p) => [p, "supporting"] as [string, "supporting"])), supportingCount: 0, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis() }],
          [{ id: "existing", statementText: "Existing claim.", rejectedEvidence: [], evidenceForCounting: existing.map((e) => ({ interviewAnswerId: e, stance: "supporting" as const })) }],
          independence,
          same
        );
        return r!.action === "no_new_information"
          ? { action: r!.action }
          : {
              action: r!.action,
              newEvidenceAnswers: r!.action === "new_version" ? r!.newEvidence.map((e) => e.interviewAnswerId) : r!.evidence.map((e) => e.interviewAnswerId),
              supporting: r!.supportingCount,
              contradicting: r!.contradictingCount,
              supportingUpper: r!.independenceBasis.supportingUpper,
              hasBasis: r!.independenceBasis.schemaVersion === 1,
            };
      },
    },
    {
      name: "Strategy",
      run: async (existing, proposed, independence) => {
        const [r] = await resolveObservedPrincipleIdentities(
          [{ statement: "claim", evidence: evidence(...proposed.map((p) => [p, "supporting"] as [string, "supporting"])), supportingCount: 0, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis() }],
          [{ id: "existing", statementText: "Existing claim.", rejectedEvidence: [], evidenceForCounting: existing.map((e) => ({ interviewAnswerId: e, stance: "supporting" as const })) }],
          independence,
          same
        );
        return r!.action === "no_new_information"
          ? { action: r!.action }
          : {
              action: r!.action,
              newEvidenceAnswers: r!.action === "new_version" ? r!.newEvidence.map((e) => e.interviewAnswerId) : r!.evidence.map((e) => e.interviewAnswerId),
              supporting: r!.supportingCount,
              contradicting: r!.contradictingCount,
              supportingUpper: r!.independenceBasis.supportingUpper,
              hasBasis: r!.independenceBasis.schemaVersion === 1,
            };
      },
    },
  ];

  const fact: EffectiveLinkFact = { id: "F1", verdict: "linked", transactionIds: ["mp-s2", "mrvl-buy"] };
  const withFact = createIndependenceResolver(contextFromTrades(MP_TRADES, MP_ANSWERS, [fact]));
  const unrelated = createIndependenceResolver(
    contextFromTrades([...MP_TRADES, { id: "far", ticker: "FAR", type: "buy", date: "2026-02-02" }], [...MP_ANSWERS, { id: "a-far", txn: "far", text: "" }])
  );

  describe.each(domains)("$name", ({ run }) => {
    it("a new citation in an already-counted STRONG group (same episode) mints no version", async () => {
      expect(await run(["a-mp-buy"], ["a-mp-s1"], resolver)).toEqual({ action: "no_new_information" });
    });

    it("a new citation joined to the existing evidence by a confirmed LinkFact mints no version", async () => {
      expect(await run(["a-mp-s2"], ["a-mrvl"], withFact)).toEqual({ action: "no_new_information" });
    });

    it("a new citation tied only by a WEAK edge is recorded and versioned, but S_lb does not rise (S_ub does)", async () => {
      const out = await run(["a-mp-s2"], ["a-mrvl"], resolver);
      expect(out.action).toBe("new_version");
      expect(out.newEvidenceAnswers).toEqual(["a-mrvl"]); // the evidence row is kept
      expect(out.supporting).toBe(1); // not counted as a second decision
      expect(out.supportingUpper).toBe(2);
      expect(out.hasBasis).toBe(true);
    });

    it("a genuinely independent new citation raises the count exactly", async () => {
      const out = await run(["a-mp-buy"], ["a-far"], unrelated);
      expect(out.action).toBe("new_version");
      expect(out.supporting).toBe(2);
      expect(out.supportingUpper).toBe(2);
    });

    it("a brand-new identity carries its basis", async () => {
      const [r] = await (
        run === domains[0]!.run
          ? resolveHypothesisIdentities(
              [{ statement: "claim", evidence: REALLOCATION, supportingCount: 0, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis() }],
              [],
              resolver,
              async () => ({ matchedId: null, reason: "new" })
            )
          : resolveObservedPrincipleIdentities(
              [{ statement: "claim", evidence: REALLOCATION, supportingCount: 0, contradictingCount: 0, evidenceStrength: "insufficient_evidence", independenceBasis: fixtureBasis() }],
              [],
              resolver,
              async () => ({ matchedId: null, reason: "new" })
            )
      );
      expect(r?.action).toBe("new_identity");
      if (r?.action !== "new_identity") return;
      expect(r.supportingCount).toBe(1);
      expect(r.independenceBasis.weakEdges).toHaveLength(1);
    });
  });
});
