import { router, publicProcedure } from "../trpc";
import { authRouter } from "./auth";

export const appRouter = router({
  // Proves the DB round-trip works without requiring auth — useful for
  // deployment smoke checks. Real product routers get added here as each
  // Investment Memory task lands (dna, strategy, cases, decisions, ...).
  health: publicProcedure.query(() => ({ ok: true, timestamp: new Date().toISOString() })),
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
