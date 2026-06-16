import type { WrappedPrivateKey } from "./keys";

/**
 * IndexedDB for the local identity:
 *  - "identity": the wrapped (passphrase-encrypted) private key + public meta.
 *  - "unlocked": the unwrapped, NON-EXTRACTABLE CryptoKey, cached so it survives
 *    page reloads without re-entering the passphrase. It can be used but never
 *    exported, and is cleared on logout. Nothing here is ever uploaded.
 */

const DB_NAME = "privatechat";
const IDENTITY_STORE = "identity";
const UNLOCKED_STORE = "unlocked";
const VERSION = 2;

export type StoredIdentity = {
  userId: string;
  username: string;
  publicKeyBase64: string;
  wrapped: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE, { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains(UNLOCKED_STORE)) {
        db.createObjectStore(UNLOCKED_STORE, { keyPath: "userId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function saveIdentity(
  identity: Omit<StoredIdentity, "createdAt"> & { createdAt?: number },
): Promise<IDBValidKey> {
  const record: StoredIdentity = { createdAt: Date.now(), ...identity };
  return tx(IDENTITY_STORE, "readwrite", (store) => store.put(record));
}

export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  const result = await tx<StoredIdentity | undefined>(
    IDENTITY_STORE,
    "readonly",
    (store) => store.get(userId),
  );
  return result ?? null;
}

export function getWrappedKey(identity: StoredIdentity): WrappedPrivateKey {
  return { wrapped: identity.wrapped, salt: identity.salt, iv: identity.iv };
}

/* ----------------------- unwrapped key cache --------------------------- */

export function storeUnwrappedKey(
  userId: string,
  key: CryptoKey,
): Promise<IDBValidKey> {
  return tx(UNLOCKED_STORE, "readwrite", (store) => store.put({ userId, key }));
}

export async function loadUnwrappedKey(userId: string): Promise<CryptoKey | null> {
  const result = await tx<{ userId: string; key: CryptoKey } | undefined>(
    UNLOCKED_STORE,
    "readonly",
    (store) => store.get(userId),
  );
  return result?.key ?? null;
}

export function clearUnwrappedKeys(): Promise<void> {
  return tx<undefined>(UNLOCKED_STORE, "readwrite", (store) =>
    store.clear(),
  ).then(() => undefined);
}
