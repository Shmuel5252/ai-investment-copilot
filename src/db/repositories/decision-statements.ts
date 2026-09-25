import { asc, eq } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { decisions, decisionSnapshots } from "@/db/schema";
import { decisionStatementsOf, type DecisionStatement } from "@/lib/evidence/decision-statements";

// Evidence Reach V1 — every citable decision-time statement of one investor
// (src/lib/evidence/decision-statements.ts), read from the immutable
// DecisionSnapshot. Deterministic order: decision date, then id, then kind.
export async function listDecisionStatementsForInvestor(db: typeof Db, investorId: string): Promise<DecisionStatement[]> {
  const rows = await db
    .select({
      id: decisions.id,
      ticker: decisions.ticker,
      decisionType: decisions.decisionType,
      decisionDate: decisions.decisionDate,
      createdAt: decisions.createdAt,
      userReasoningText: decisionSnapshots.userReasoningText,
      risksConsideredText: decisionSnapshots.risksConsideredText,
      exitConditionsText: decisionSnapshots.exitConditionsText,
    })
    .from(decisions)
    .innerJoin(decisionSnapshots, eq(decisionSnapshots.decisionId, decisions.id))
    .where(eq(decisions.investorId, investorId))
    .orderBy(asc(decisions.decisionDate), asc(decisions.id));
  return rows.flatMap(decisionStatementsOf);
}
