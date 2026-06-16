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

/**
 * Claims in the conversation "ticket" minted by /api/conversation-token. Proves
 * the holder is a member of a specific conversation (membership verified by the
 * Vercel route recomputing the conversation id from the session user + peer).
 */
export type ConversationClaims = {
  userId: string;
  username: string;
  conversationId: string;
  peerId: string;
};

export async function verifyConversationTicket(
  token: string,
  secret: string,
): Promise<ConversationClaims> {
  if (!token) throw new Error("missing token");
  if (!secret) throw new Error("missing JWT secret");

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);

  if (
    !payload.sub ||
    typeof payload.username !== "string" ||
    typeof payload.cid !== "string" ||
    typeof payload.peer !== "string"
  ) {
    throw new Error("invalid ticket claims");
  }
  return {
    userId: payload.sub,
    username: payload.username,
    conversationId: payload.cid,
    peerId: payload.peer,
  };
}
