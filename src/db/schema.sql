-- PrivateChat identity registry (Turso / libSQL).
-- This is the ONLY queryable persistent store. It holds public identity data
-- only: never private keys, plaintext, or message content.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,            -- opaque user id (e.g. uuid)
  username     TEXT NOT NULL UNIQUE,        -- unique handle others search by
  public_key   TEXT NOT NULL,              -- ECDH P-256 public key (base64 SPKI)
  pwd_hash     TEXT NOT NULL,              -- Argon2 hash of the passphrase
  created_at   INTEGER NOT NULL            -- unix epoch millis
);

-- Case-insensitive uniqueness/lookup on username.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
  ON users (username COLLATE NOCASE);

-- Public profile fields (optional). Like username/public_key these are public
-- identity data shown to peers — never message content. SQLite has no
-- "ADD COLUMN IF NOT EXISTS"; the migrator ignores duplicate-column errors.
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;       -- small base64 data URL (webp)

-- Zero-knowledge encrypted key backup: the private key, wrapped client-side with
-- a PBKDF2(passphrase)->AES-GCM key. The server stores only this ciphertext (it
-- never has the passphrase), enabling multi-device restore. Security rests on the
-- passphrase; a strong one is essential since this ciphertext is server-held.
CREATE TABLE IF NOT EXISTS key_backups (
  user_id   TEXT PRIMARY KEY REFERENCES users(id),
  wrapped   TEXT NOT NULL,  -- base64 AES-GCM-wrapped PKCS8 private key
  salt      TEXT NOT NULL,  -- base64 PBKDF2 salt
  iv        TEXT NOT NULL   -- base64 AES-GCM iv
);
