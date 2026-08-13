import { initTRPC, TRPCError } from "@trpc/server";
import { getSession } from "./auth/session";

export async function createTRPCContext() {
  const session = await getSession();
  return { session };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Requires a logged-in investor. This is a single-user product, but the
// procedure still checks the session rather than assuming — the DB layer
// should never be reachable from the API without an authenticated request.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session.investorId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      investorId: ctx.session.investorId,
    },
  });
});
