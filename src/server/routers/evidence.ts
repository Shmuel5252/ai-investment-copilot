import { router, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { loadEvidenceReach } from "@/lib/evidence/load-evidence-reach";
import { loadNextActions } from "@/lib/next-actions/load-next-actions";

// Evidence Reach V1 — read-only transparency: what the AI currently uses,
// why a claim is below the threshold, and the deterministic next actions.
// Nothing here writes, calls an AI, or changes any count.
export const evidenceRouter = router({
  reach: protectedProcedure.query(({ ctx }) => loadEvidenceReach(db, ctx.investorId)),
  nextActions: protectedProcedure.query(({ ctx }) => loadNextActions(db, ctx.investorId)),
});
