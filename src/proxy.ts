import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/server/auth/session";

const PUBLIC_PATHS = ["/login", "/api/trpc"];

// Renamed from `middleware` to `proxy` per the Next.js 16 convention —
// this is an optimistic, redirect-only check. Real enforcement happens at
// the tRPC layer (protectedProcedure), which is the only place that can't
// be bypassed by hitting the API directly.
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();

  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (isPublic) return response;

  const session = await getIronSession<SessionData>(request, response, sessionOptions);
  if (!session.investorId) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Protect everything except static assets and the login page itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
