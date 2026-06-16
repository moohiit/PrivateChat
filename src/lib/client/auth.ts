"use client";

import {
  generateIdentityKeyPair,
  exportPublicKeyBase64,
  wrapPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto/keys";
import {
  saveIdentity,
  loadIdentity,
  getWrappedKey,
  storeUnwrappedKey,
  loadUnwrappedKey,
  clearUnwrappedKeys,
  type StoredIdentity,
} from "@/lib/crypto/idb";
import {
  setUnlockedKey,
  clearUnlockedKey,
  getUnlockedKey,
} from "@/lib/crypto/session-key";
import { clearConversationKeys } from "@/lib/crypto/keystore";
import { bytesToBase64, base64ToBytes } from "@/lib/crypto/encoding";

export type AuthResult = {
  userId: string;
  username: string;
};

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorMessage(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data?.error as string) ?? `request failed (${res.status})`;
}

type ServerBackup = {
  wrapped: string;
  salt: string;
  iv: string;
  publicKey: string;
};

/** Fetch the zero-knowledge encrypted key backup for the session user. */
async function fetchKeyBackup(): Promise<ServerBackup | null> {
  const res = await fetch("/api/auth/key-backup");
  if (!res.ok) return null;
  const { backup } = (await res.json()) as { backup: ServerBackup | null };
  return backup;
}

/** Restore the wrapped key from the server backup into local IndexedDB. */
async function restoreFromBackup(
  userId: string,
  username: string,
): Promise<StoredIdentity | null> {
  const backup = await fetchKeyBackup();
  if (!backup) return null;
  await saveIdentity({
    userId,
    username,
    publicKeyBase64: backup.publicKey,
    wrapped: base64ToBytes(backup.wrapped),
    salt: base64ToBytes(backup.salt),
    iv: base64ToBytes(backup.iv),
  });
  return loadIdentity(userId);
}

/**
 * Backfill the server backup from a local identity if the server has none yet
 * (for accounts created before key backup existed). Best-effort; never throws.
 */
async function backfillBackup(identity: StoredIdentity): Promise<void> {
  try {
    if (await fetchKeyBackup()) return;
    await postJson("/api/auth/key-backup", {
      wrapped: bytesToBase64(identity.wrapped),
      salt: bytesToBase64(identity.salt),
      iv: bytesToBase64(identity.iv),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Signup: generate the identity keypair in-browser, wrap the private key with
 * the passphrase, store it locally AND upload the wrapped (encrypted) blob as a
 * zero-knowledge backup so other devices can restore it. Only the public key and
 * ciphertext leave the browser — never the plaintext private key or passphrase
 * key.
 */
export async function signup(
  username: string,
  password: string,
): Promise<AuthResult> {
  const keyPair = await generateIdentityKeyPair();
  const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);
  const wrapped = await wrapPrivateKey(keyPair.privateKey, password);

  const res = await postJson("/api/auth/signup", {
    username,
    password,
    publicKey: publicKeyBase64,
    wrappedKey: {
      wrapped: bytesToBase64(wrapped.wrapped),
      salt: bytesToBase64(wrapped.salt),
      iv: bytesToBase64(wrapped.iv),
    },
  });
  if (!res.ok) throw new Error(await errorMessage(res));

  const { userId } = (await res.json()) as AuthResult;

  await saveIdentity({ userId, username, publicKeyBase64, ...wrapped });

  // Use the non-extractable unwrapped key everywhere (cache survives reloads).
  const privateKey = await unwrapPrivateKey(wrapped, password);
  setUnlockedKey(privateKey);
  await storeUnwrappedKey(userId, privateKey);
  return { userId, username };
}

/**
 * Login: authenticate, then unlock the private key. If this device has no local
 * key (new device/browser), restore it from the server's encrypted backup and
 * unwrap with the passphrase — enabling multi-device access.
 */
export async function login(
  username: string,
  password: string,
): Promise<AuthResult & { hasLocalKey: boolean }> {
  const res = await postJson("/api/auth/login", { username, password });
  if (!res.ok) throw new Error(await errorMessage(res));

  const { userId } = (await res.json()) as AuthResult;

  let identity = await loadIdentity(userId);
  if (!identity) {
    identity = await restoreFromBackup(userId, username);
  }
  if (!identity) {
    return { userId, username, hasLocalKey: false };
  }

  // Unwrap throws if the passphrase is wrong (AES-GCM auth failure).
  const privateKey = await unwrapPrivateKey(getWrappedKey(identity), password);
  setUnlockedKey(privateKey);
  await storeUnwrappedKey(userId, privateKey);
  await backfillBackup(identity);
  return { userId, username, hasLocalKey: true };
}

export type UnlockStatus = "ready" | "needs-passphrase" | "no-key";

/**
 * Ensure the private key is unlocked for this user without a fresh login.
 * Order: in-memory key -> IndexedDB unwrapped cache (survives reload) -> local
 * wrapped key -> server encrypted backup. Returns whether a passphrase unlock is
 * possible, or there is genuinely no key anywhere.
 */
export async function ensureUnlockedKey(
  userId: string,
  username: string,
): Promise<UnlockStatus> {
  if (getUnlockedKey()) return "ready";

  const cached = await loadUnwrappedKey(userId);
  if (cached) {
    setUnlockedKey(cached);
    return "ready";
  }

  let identity = await loadIdentity(userId);
  if (!identity) {
    identity = await restoreFromBackup(userId, username);
  }
  return identity ? "needs-passphrase" : "no-key";
}

/** Unlock the local private key with the passphrase (manual unlock gate). */
export async function unlockIdentity(
  userId: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const identity = await loadIdentity(userId);
  if (!identity) return { ok: false, error: "No key stored on this device." };
  try {
    const privateKey = await unwrapPrivateKey(getWrappedKey(identity), password);
    setUnlockedKey(privateKey);
    await storeUnwrappedKey(userId, privateKey);
    await backfillBackup(identity);
    return { ok: true };
  } catch {
    return { ok: false, error: "Wrong passphrase." };
  }
}

export async function logout(): Promise<void> {
  clearUnlockedKey();
  clearConversationKeys();
  await clearUnwrappedKeys();
  await postJson("/api/auth/logout", {});
}
