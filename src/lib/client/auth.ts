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
} from "@/lib/crypto/idb";
import { setUnlockedKey, clearUnlockedKey } from "@/lib/crypto/session-key";

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

  setUnlockedKey(keyPair.privateKey);
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
  return { userId, username, hasLocalKey: true };
}

export async function logout(): Promise<void> {
  clearUnlockedKey();
  await postJson("/api/auth/logout", {});
}
