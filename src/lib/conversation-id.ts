import { createHmac } from "node:crypto";

/**
 * Stable, unguessable conversation id: HMAC-SHA256(secret, sorted(a,b)) hex,
 * truncated to 32 chars.
 *
 * MUST stay byte-identical to the lobby's Web Crypto implementation in
 * party/lobby.ts (same input `sorted(a,b).join(":")`, hex, slice(0, 32)) so the
 * id derived at accept-time matches the one the conversation room authorizes.
 * The cross-implementation match is asserted in scripts/crypto-check.ts.
 */
export function conversationId(secret: string, a: string, b: string): string {
  const pair = [a, b].sort().join(":");
  return createHmac("sha256", secret).update(pair).digest("hex").slice(0, 32);
}
