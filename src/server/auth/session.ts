import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export interface SessionData {
  investorId?: string;
  email?: string;
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error(
    "SESSION_SECRET must be set to a random string of 32+ characters. See .env.example."
  );
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: "aic_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

// Call from Server Components, Server Actions, and Route Handlers.
export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
