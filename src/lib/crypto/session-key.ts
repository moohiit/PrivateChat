/**
 * Holds the unlocked ECDH private key for the current tab, in memory only.
 * Set on signup/login (after unwrapping), cleared on logout. Never persisted in
 * unwrapped form. Later phases (key agreement / messaging) read it from here.
 */

let unlockedPrivateKey: CryptoKey | null = null;

export function setUnlockedKey(key: CryptoKey): void {
  unlockedPrivateKey = key;
}

export function getUnlockedKey(): CryptoKey | null {
  return unlockedPrivateKey;
}

export function clearUnlockedKey(): void {
  unlockedPrivateKey = null;
}
