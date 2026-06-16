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
