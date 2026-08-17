import { eq, desc } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import {
  strategyPrinciples,
  strategyPrincipleVersions,
  strategyVersions,
  strategyVersionPrinciples,
  evidence,
} from "@/db/schema";
import { DEFAULT_RISK_PRINCIPLES } from "@/lib/strategy/default-risk-principles";
import { slugifyPrincipleKey } from "@/lib/strategy/slugify";
import type { ValidatedDeclaredPrinciple, ValidatedObservedPrinciple } from "@/lib/strategy/validate-principles";

export type NewStrategyPrinciple = InferInsertModel<typeof strategyPrinciples>;
export type NewStrategyPrincipleVersion = InferInsertModel<typeof strategyPrincipleVersions>;
export type NewStrategyVersion = InferInsertModel<typeof strategyVersions>;

export async function insertStrategyPrinciple(db: typeof Db, values: NewStrategyPrinciple) {
  const [row] = await db.insert(strategyPrinciples).values(values).returning();
  return row!;
}

// Append-only.
export async function insertStrategyPrincipleVersion(
  db: typeof Db,
  values: NewStrategyPrincipleVersion
) {
  const [row] = await db.insert(strategyPrincipleVersions).values(values).returning();
  return row!;
}

// Bundles a new whole-strategy version together with the set of
// principle-versions active in it (new + carried-over unchanged ones) —
// see docs/data-model.md §0 "Whole-bundle Version". Append-only.
export async function insertStrategyVersion(
  db: typeof Db,
  values: NewStrategyVersion,
  principleVersionIds: string[]
) {
  return db.transaction(async (tx) => {
    const [version] = await tx.insert(strategyVersions).values(values).returning();
    if (principleVersionIds.length > 0) {
      await tx.insert(strategyVersionPrinciples).values(
        principleVersionIds.map((strategyPrincipleVersionId) => ({
          strategyVersionId: version!.id,
          strategyPrincipleVersionId,
        }))
      );
    }
    return version!;
  });
}

export async function getLatestStrategyVersion(db: typeof Db, investorId: string) {
  const [row] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.investorId, investorId))
    .orderBy(desc(strategyVersions.versionNumber))
    .limit(1);
  return row;
}

export async function getLatestStrategyPrincipleVersion(
  db: typeof Db,
  strategyPrincipleId: string
) {
  const [row] = await db
    .select()
    .from(strategyPrincipleVersions)
    .where(eq(strategyPrincipleVersions.strategyPrincipleId, strategyPrincipleId))
    .orderBy(desc(strategyPrincipleVersions.versionNumber))
    .limit(1);
  return row;
}

// The full set of principle-versions bundled into a given whole-strategy
// version — "what did the Strategy actually say at that point in time".
export async function getStrategyVersionPrinciples(db: typeof Db, strategyVersionId: string) {
  return db.query.strategyVersionPrinciples.findMany({
    where: (svp, { eq }) => eq(svp.strategyVersionId, strategyVersionId),
    with: { principleVersion: true },
  });
}

// All of an investor's principles (declared + observed + validated),
// each with its latest version only — "current version" = MAX(version_number)
// per principle, same rule as everywhere else in this codebase
// (docs/data-model.md §0). Mirrors listActiveDnaHypothesesForInvestor,
// minus a status filter: strategyPrinciples has no status column (see
// docs/architecture.md §2.4 — Correction, not a reject flag, is the
// disagreement mechanism for Strategy, and wiring that up is out of
// scope for this task).
export async function listStrategyPrinciplesForInvestor(db: typeof Db, investorId: string) {
  return db.query.strategyPrinciples.findMany({
    where: (p, { eq }) => eq(p.investorId, investorId),
    with: {
      versions: { orderBy: (v, { desc }) => desc(v.versionNumber), limit: 1 },
    },
    orderBy: (p, { asc }) => asc(p.createdAt),
  });
}

// Fixed baseline risk principles (docs/architecture.md §2.4) — code
// only, no AI, no user approval needed since these aren't a claim about
// this investor. Idempotent by `key`, enforced by the DB's own unique
// (investor_id, key) constraint via onConflictDoNothing — not an
// application-level "check existing, then insert" pre-check. A real bug
// caught live: that pre-check pattern is a TOCTOU race (two
// near-simultaneous calls — e.g. React StrictMode's intentional
// double-invoke of a mount effect in dev — can both see "nothing exists
// yet" before either commits, and both insert), which is exactly what
// happened and produced real duplicate rows on a real account. The
// unique constraint is what actually makes this safe; onConflictDoNothing
// just lets a real conflict resolve to "already there" instead of an
// error.
export async function ensureDefaultRiskPrinciples(db: typeof Db, investorId: string) {
  const created = [];
  for (const def of DEFAULT_RISK_PRINCIPLES) {
    const result = await db.transaction(async (tx) => {
      const [principle] = await tx
        .insert(strategyPrinciples)
        .values({ investorId, key: def.key })
        .onConflictDoNothing({ target: [strategyPrinciples.investorId, strategyPrinciples.key] })
        .returning();
      if (!principle) return null; // real conflict at the DB — this default already exists
      const [version] = await tx
        .insert(strategyPrincipleVersions)
        .values({
          strategyPrincipleId: principle.id,
          versionNumber: 1,
          principleType: "validated",
          statementText: def.statementText,
          rationaleText: def.rationaleText,
          createdBy: "system_default",
        })
        .returning();
      return { principle, version: version! };
    });
    if (result) created.push(result);
  }
  return created;
}

// Declared principle — the investor's own stated rule, transcribed by AI
// and confirmed by the user before anything is written (docs/architecture.md
// §2.4: "AI מחלץ, משתמש מאשר" — unlike Observed/DNA, approval gates
// creation itself, not just post-hoc rejection). The citing answer(s)
// become supporting Evidence, same mechanism as everywhere else, giving
// even a verbatim declaration real Traceability rather than just trusting
// the transcription.
export async function insertDeclaredPrinciple(
  db: typeof Db,
  investorId: string,
  principle: ValidatedDeclaredPrinciple
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .insert(strategyPrinciples)
      .values({ investorId, key: slugifyPrincipleKey(principle.statementText) })
      .returning();
    const [version] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId: identity!.id,
        versionNumber: 1,
        principleType: "declared",
        statementText: principle.statementText,
        rationaleText: principle.rationaleText,
        createdBy: "user_declared",
      })
      .returning();

    await tx.insert(evidence).values(
      principle.citedAnswerIds.map((interviewAnswerId) => ({
        strategyPrincipleId: identity!.id,
        stance: "supporting" as const,
        interviewAnswerId,
        description: "You stated this directly in the onboarding interview.",
      }))
    );

    return { principle: identity!, version: version! };
  });
}

// Observed principle — "same Evidence engine as DNA" (docs/architecture.md
// §2.4): written immediately with evidenceStrength always computed in
// code from the *validated* counts (never trusted from the AI), mirroring
// insertDnaHypothesisWithEvidence exactly. Called only with output from
// validateProposedObservedPrinciples().
export async function insertObservedPrincipleWithEvidence(
  db: typeof Db,
  investorId: string,
  principle: ValidatedObservedPrinciple
) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .insert(strategyPrinciples)
      .values({ investorId, key: slugifyPrincipleKey(principle.statement) })
      .returning();
    const [version] = await tx
      .insert(strategyPrincipleVersions)
      .values({
        strategyPrincipleId: identity!.id,
        versionNumber: 1,
        principleType: "observed",
        statementText: principle.statement,
        rationaleText: "Observed as a pattern across your interview answers, not stated directly.",
        createdBy: "ai_observed",
        evidenceStrength: principle.evidenceStrength,
        supportingEvidenceCount: principle.supportingCount,
        contradictingEvidenceCount: principle.contradictingCount,
      })
      .returning();

    await tx.insert(evidence).values(
      principle.evidence.map((e) => ({
        strategyPrincipleId: identity!.id,
        stance: e.stance,
        interviewAnswerId: e.interviewAnswerId,
        description: e.description,
      }))
    );

    return { principle: identity!, version: version! };
  });
}

// "User approves a change -> new [whole-Strategy] version"
// (docs/architecture.md §2.4). Bundles the *current* latest version of
// every one of the investor's principles (declared + observed + validated
// alike, including carried-over ones nothing changed about) into one new
// StrategyVersion — docs/data-model.md §0 "Whole-bundle Version".
export async function approveStrategyVersion(
  db: typeof Db,
  investorId: string,
  changeSummary: string
) {
  const principles = await listStrategyPrinciplesForInvestor(db, investorId);
  const principleVersionIds = principles
    .map((p) => p.versions[0]?.id)
    .filter((id): id is string => !!id);

  const latest = await getLatestStrategyVersion(db, investorId);
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  return insertStrategyVersion(db, { investorId, versionNumber, changeSummary }, principleVersionIds);
}
