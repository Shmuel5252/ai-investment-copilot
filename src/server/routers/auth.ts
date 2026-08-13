import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import { investors } from "@/db/schema";
import { verifyPassword } from "../auth/password";

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const investor = await db.query.investors.findFirst({
        where: eq(investors.email, input.email),
      });

      // Same error for "no such user" and "wrong password" — don't leak
      // which one it was.
      const invalidCredentials = new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      });

      if (!investor) throw invalidCredentials;
      const valid = await verifyPassword(input.password, investor.passwordHash);
      if (!valid) throw invalidCredentials;

      ctx.session.investorId = investor.id;
      ctx.session.email = investor.email;
      await ctx.session.save();

      return { displayName: investor.displayName };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    ctx.session.destroy();
    return { ok: true };
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const investor = await db.query.investors.findFirst({
      where: eq(investors.id, ctx.investorId),
    });
    if (!investor) throw new TRPCError({ code: "UNAUTHORIZED" });
    return { id: investor.id, email: investor.email, displayName: investor.displayName };
  }),
});
