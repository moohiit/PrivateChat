"use client";

import PartySocket from "partysocket";

/**
 * Browser-side PartyKit connection helpers. Each (re)connect fetches a fresh
 * short-lived connect token from the Vercel API, so PartyKit can re-verify the
 * session even after the previous token expires.
 */

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";

async function getConnectToken(): Promise<string> {
  const res = await fetch("/api/connect-token", { method: "POST" });
  if (!res.ok) throw new Error("failed to obtain connect token");
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Connect to the shared presence lobby. */
export function createLobbySocket(): PartySocket {
  return new PartySocket({
    host: HOST,
    party: "lobby",
    room: "main",
    query: async () => ({ token: await getConnectToken() }),
  });
}

async function getConversationToken(peerUserId: string): Promise<string> {
  const res = await fetch("/api/conversation-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ peerUserId }),
  });
  if (!res.ok) throw new Error("failed to obtain conversation ticket");
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Connect to a conversation room (the "main" party), authorized per peer. */
export function createConversationSocket(
  conversationId: string,
  peerUserId: string,
): PartySocket {
  return new PartySocket({
    host: HOST,
    party: "main",
    room: conversationId,
    query: async () => ({ token: await getConversationToken(peerUserId) }),
  });
}
