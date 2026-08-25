-- Databáze ACCOUNTS_DB pro účty appky (e-mail + magic link).
-- Odděleno od KV úložiště ROZPOCET, kde žijí data na starém sync kódu —
-- viz "Klíčová rozhodnutí" v CLAUDE.md. Nasazení:
--   npx wrangler d1 execute rozpocet-accounts --remote --file=./d1-schema.sql

CREATE TABLE users (
  id            TEXT PRIMARY KEY,              -- crypto.randomUUID()
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE magic_links (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL,                 -- sha256 hex, raw token se nikdy neukládá
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,               -- created_at + 15 min
  used_at       INTEGER,                        -- NULL = ještě nepoužito
  requested_ip  TEXT
);
CREATE INDEX idx_magic_links_token_hash ON magic_links(token_hash);
CREATE INDEX idx_magic_links_user_id ON magic_links(user_id);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,               -- created_at + 60 dní, prodlužuje se použitím
  last_seen_at  INTEGER,
  revoked_at    INTEGER,                        -- vyplněno = odhlášeno
  user_agent    TEXT
);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
