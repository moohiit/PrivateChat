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
} from "@/lib/crypto/idb";
import {
  setUnlockedKey,
  clearUnlockedKey,
  getUnlockedKey,
} from "@/lib/crypto/session-key";
import { clearConversationKeys } from "@/lib/crypto/keystore";

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

/**
 * Signup: generate the identity keypair in-browser, register the public key,
 * then wrap the private key with the passphrase and store it locally. The
 * private key never touches the network.
 */
export async function signup(
  username: string,
  password: string,
): Promise<AuthResult> {
  const keyPair = await generateIdentityKeyPair();
  const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

  const res = await postJson("/api/auth/signup", {
    username,
    password,
    publicKey: publicKeyBase64,
  });
  if (!res.ok) throw new Error(await errorMessage(res));

  const { userId } = (await res.json()) as AuthResult;

  const wrapped = await wrapPrivateKey(keyPair.privateKey, password);
  await saveIdentity({ userId, username, publicKeyBase64, ...wrapped });

  // Use the non-extractable unwrapped key everywhere (cache survives reloads).
  const privateKey = await unwrapPrivateKey(wrapped, password);
  setUnlockedKey(privateKey);
  await storeUnwrappedKey(userId, privateKey);
  return { userId, username };
}

/**
 * Login: authenticate to the server, then unlock the local private key if this
 * device has it. A device without the stored key (new device) can sign in but
 * cannot decrypt history — by design.
 */
export async function login(
  username: string,
  password: string,
): Promise<AuthResult & { hasLocalKey: boolean }> {
  const res = await postJson("/api/auth/login", { username, password });
  if (!res.ok) throw new Error(await errorMessage(res));

  const { userId } = (await res.json()) as AuthResult;

  const identity = await loadIdentity(userId);
  if (!identity) {
    return { userId, username, hasLocalKey: false };
  }

  // Unwrap throws if the passphrase is wrong (AES-GCM auth failure).
  const privateKey = await unwrapPrivateKey(getWrappedKey(identity), password);
  setUnlockedKey(privateKey);
  await storeUnwrappedKey(userId, privateKey);
  return { userId, username, hasLocalKey: true };
}

export type UnlockStatus = "ready" | "needs-passphrase" | "no-key";

/**
 * Ensure the private key is unlocked for this user without requiring a fresh
 * login. Called on app load: reuses the in-memory key, else the IndexedDB
 * unwrapped-key cache (survives reloads), else reports whether a passphrase
 * unlock is possible (wrapped key present) or the device simply has no key.
 */
export async function ensureUnlockedKey(userId: string): Promise<UnlockStatus> {
  if (getUnlockedKey()) return "ready";

  const cached = await loadUnwrappedKey(userId);
  if (cached) {
    setUnlockedKey(cached);
    return "ready";
  }

  const identity = await loadIdentity(userId);
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
