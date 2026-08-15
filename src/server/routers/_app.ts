import { router, publicProcedure } from "../trpc";
import { authRouter } from "./auth";
import { importRouter } from "./import";
import { interviewRouter } from "./interview";
import { dnaRouter } from "./dna";
import { strategyRouter } from "./strategy";
import { ideasRouter } from "./ideas";
import { casesRouter } from "./cases";
import { decisionsRouter } from "./decisions";

export const appRouter = router({
  // Proves the DB round-trip works without requiring auth — useful for
  // deployment smoke checks. Real product routers get added here as each
  // Investment Memory task lands (dna, strategy, cases, decisions, ...).
  health: publicProcedure.query(() => ({ ok: true, timestamp: new Date().toISOString() })),
  auth: authRouter,
  import: importRouter,
  interview: interviewRouter,
  dna: dnaRouter,
  strategy: strategyRouter,
  ideas: ideasRouter,
  cases: casesRouter,
  decisions: decisionsRouter,
});

export type AppRouter = typeof appRouter;
