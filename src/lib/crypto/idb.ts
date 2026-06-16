import type { WrappedPrivateKey } from "./keys";

/**
 * Minimal IndexedDB store for the local identity: the wrapped (passphrase-
 * encrypted) private key plus public metadata. Keyed by userId so multiple
 * accounts can coexist on one browser. Nothing here is ever uploaded.
 */

const DB_NAME = "privatechat";
const STORE = "identity";
const VERSION = 1;

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "userId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function saveIdentity(
  identity: Omit<StoredIdentity, "createdAt"> & { createdAt?: number },
): Promise<IDBValidKey> {
  const record: StoredIdentity = {
    createdAt: Date.now(),
    ...identity,
  };
  return tx("readwrite", (store) => store.put(record));
}

export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  const result = await tx<StoredIdentity | undefined>("readonly", (store) =>
    store.get(userId),
  );
  return result ?? null;
}

export function getWrappedKey(identity: StoredIdentity): WrappedPrivateKey {
  return { wrapped: identity.wrapped, salt: identity.salt, iv: identity.iv };
}
