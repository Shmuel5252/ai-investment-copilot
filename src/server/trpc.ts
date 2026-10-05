import { initTRPC, TRPCError } from "@trpc/server";
import { getSession } from "./auth/session";
import { aiTimeoutMessage } from "@/lib/ai/client";

export async function createTRPCContext() {
  const session = await getSession();
  return { session };
}

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// An AI timeout reaches the user as a clear message naming what was saved,
// not the SDK's generic "Request timed out.".
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error, path }) {
    const message = aiTimeoutMessage(error.cause, path);
    return message ? { ...shape, message } : shape;
  },
});

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
