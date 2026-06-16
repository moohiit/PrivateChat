import { createClient, type Client } from "@libsql/client";
import { env } from "./env";

/**
 * Turso (libSQL) client — the ONLY queryable database in the system, and it
 * holds only the identity registry (username -> public key). Persisted message
 * ciphertext lives in PartyKit Durable Object storage, never here.
 *
 * Cached on globalThis so Next.js hot-reload / serverless reuse doesn't open a
 * new connection per invocation.
 */

const globalForDb = globalThis as unknown as { __db?: Client };

export const db: Client =
  globalForDb.__db ??
  createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN || undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__db = db;
