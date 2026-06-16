import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id hashing for the passphrase verifier stored in Turso.
 * Server-only (native module). The passphrase travels over HTTPS and is hashed
 * here; the private key is wrapped client-side and never reaches the server, so
 * this hash alone cannot decrypt anyone's messages.
 */

const OPTS = {
  // Reasonable interactive-login cost; tune if needed.
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export function verifyPassword(stored: string, password: string): Promise<boolean> {
  return verify(stored, password, OPTS);
}
