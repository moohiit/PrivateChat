import { bytesToBase64 } from "./encoding";

/**
 * Browser-side identity key management (Web Crypto). The ECDH P-256 private key
 * is generated here, used to derive per-conversation AES-GCM keys (Phase 4), and
 * NEVER leaves the device — it is wrapped with a passphrase-derived key and kept
 * in IndexedDB. Only the public key is uploaded to the server.
 */

const CURVE = "P-256";
const PBKDF2_ITERATIONS = 310_000;

export type WrappedPrivateKey = {
  wrapped: Uint8Array; // AES-GCM-wrapped PKCS8 private key
  salt: Uint8Array; // PBKDF2 salt
  iv: Uint8Array; // AES-GCM iv
};

export function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: CURVE },
    true, // extractable: required so we can wrap the private key
    ["deriveKey", "deriveBits"],
  ) as Promise<CryptoKeyPair>;
}

export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function wrapPrivateKey(
  privateKey: CryptoKey,
  passphrase: string,
): Promise<WrappedPrivateKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const wrapped = await crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, {
    name: "AES-GCM",
    iv: iv as BufferSource,
  });
  return { wrapped: new Uint8Array(wrapped), salt, iv };
}

/**
 * Unwrap the private key with the passphrase. Throws if the passphrase is wrong
 * (AES-GCM auth tag fails), which we use to confirm the passphrase on login.
 */
export async function unwrapPrivateKey(
  data: WrappedPrivateKey,
  passphrase: string,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(passphrase, data.salt);
  return crypto.subtle.unwrapKey(
    "pkcs8",
    data.wrapped as BufferSource,
    wrappingKey,
    { name: "AES-GCM", iv: data.iv as BufferSource },
    { name: "ECDH", namedCurve: CURVE },
    false, // not extractable once unwrapped
    ["deriveKey", "deriveBits"],
  );
}
