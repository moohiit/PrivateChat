import { jwtVerify } from "jose";

/**
 * Claims carried by the short-lived "connect token" that the Next.js (Vercel)
 * API mints after login and the browser passes to PartyKit on connect.
 * PartyKit verifies it here with the shared JWT secret — the relay never sees
 * a password, private key, or plaintext, only this identity assertion.
 */
export type ConnectClaims = {
  userId: string;
  username: string;
};

export async function verifyConnectToken(
  token: string,
  secret: string,
): Promise<ConnectClaims> {
  if (!token) throw new Error("missing token");
  if (!secret) throw new Error("missing JWT secret");

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);

  if (!payload.sub || typeof payload.username !== "string") {
    throw new Error("invalid token claims");
  }
  return { userId: payload.sub, username: payload.username };
}
