import { base64ToBytes, bytesToBase64 } from "./encoding";

/**
 * Per-conversation E2E crypto (Web Crypto, browser only).
 *
 * Key agreement: ECDH(P-256) between my private key and the peer's public key
 * yields a shared secret, which HKDF-SHA256 (salted by the conversationId)
 * stretches into a per-conversation AES-256-GCM key. Both sides compute the
 * exact same key without ever transmitting it.
 */

const HKDF_INFO = "privatechat/conversation/aesgcm/v1";

export function importPeerPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

export async function deriveConversationKey(
  myPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  conversationId: string,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    myPrivateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    shared,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(conversationId),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Human-verifiable safety number derived from both public keys (order-
 * independent). If two users read the same number aloud, there is no MITM on
 * the key exchange. 60 digits, grouped in fives (Signal-style).
 */
export async function computeSafetyNumber(
  publicKeyA: string,
  publicKeyB: string,
): Promise<string> {
  const [x, y] = [publicKeyA, publicKeyB].sort();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${x}|${y}`),
  );
  const bytes = new Uint8Array(hash);
  let digits = "";
  for (let i = 0; i < bytes.length && digits.length < 60; i++) {
    digits += bytes[i].toString().padStart(3, "0");
  }
  digits = digits.slice(0, 60);
  return (digits.match(/.{1,5}/g) ?? []).join(" ");
}

export type EncryptedPayload = { ciphertext: string; iv: string };

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ct)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptMessage(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) as BufferSource },
    key,
    base64ToBytes(payload.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
