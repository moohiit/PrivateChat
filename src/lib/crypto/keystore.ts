/**
 * In-memory store of derived per-conversation AES-GCM keys, keyed by
 * conversationId. Lives only for the tab's lifetime; never persisted. Phase 5
 * messaging reads keys from here to encrypt/decrypt.
 */

const conversationKeys = new Map<string, CryptoKey>();

export function putConversationKey(conversationId: string, key: CryptoKey): void {
  conversationKeys.set(conversationId, key);
}

export function getConversationKey(conversationId: string): CryptoKey | null {
  return conversationKeys.get(conversationId) ?? null;
}

export function clearConversationKeys(): void {
  conversationKeys.clear();
}
