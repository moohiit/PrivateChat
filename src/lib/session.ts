import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Session = an HS256 JWT in an httpOnly cookie, signed with JWT_SECRET.
 * The short-lived "connect token" minted for PartyKit uses the SAME secret, so
 * the PartyKit server (party/auth.ts) can verify it without a shared service.
 */

const COOKIE = "pc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secret(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export type SessionUser = { userId: string; username: string };

async function sign(user: SessionUser, ttl: string): Promise<string> {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await sign(user, "7d");
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.username !== "string") return null;
    return { userId: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Short-lived token the browser passes to PartyKit on connect. */
export async function mintConnectToken(user: SessionUser): Promise<string> {
  return sign(user, "5m");
}
