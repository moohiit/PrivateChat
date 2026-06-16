import { db } from "./db";

/**
 * Identity registry access. This is the only table in the system; it stores
 * public identity data only (never private keys or plaintext).
 */

export type UserRow = {
  id: string;
  username: string;
  public_key: string;
  pwd_hash: string;
  created_at: number;
};

export type PublicUser = {
  userId: string;
  username: string;
  publicKey: string;
};

export function toPublicUser(row: UserRow): PublicUser {
  return { userId: row.id, username: row.username, publicKey: row.public_key };
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const res = await db.execute({
    sql: "SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
    args: [username],
  });
  return (res.rows[0] as unknown as UserRow) ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const res = await db.execute({
    sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (res.rows[0] as unknown as UserRow) ?? null;
}

export async function createUser(input: {
  id: string;
  username: string;
  publicKey: string;
  pwdHash: string;
  createdAt: number;
}): Promise<void> {
  await db.execute({
    sql: "INSERT INTO users (id, username, public_key, pwd_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [input.id, input.username, input.publicKey, input.pwdHash, input.createdAt],
  });
}
