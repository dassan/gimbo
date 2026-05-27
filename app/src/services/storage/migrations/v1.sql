-- Gimbo SQLite schema v1
-- Maps every field from the DataFile structure (schema v2) to SQLite tables.
-- WAL mode is enabled at runtime (not here) so the PRAGMA persists across sessions.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id                        TEXT PRIMARY KEY DEFAULT 'singleton',
  file_created_at           TEXT NOT NULL DEFAULT '',
  file_updated_at           TEXT NOT NULL DEFAULT '',
  audit_log_retention_limit INTEGER  -- NULL = unlimited
);

CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL,         -- AccountType enum value
  balance            REAL NOT NULL DEFAULT 0,
  include_in_balance INTEGER NOT NULL DEFAULT 1,  -- boolean (0|1)
  credit_limit       REAL,                  -- creditMetadata.limit   (CREDIT only)
  credit_closing_day INTEGER,               -- creditMetadata.closingDay
  credit_due_day     INTEGER,               -- creditMetadata.dueDay
  issuer_icon        TEXT,                  -- 'nubank' | 'itau' | 'generic' | ...
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES categories(id),
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL,                 -- 'INCOME' | 'EXPENSE'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES accounts(id),
  category_id           TEXT,              -- nullable for TRANSFER / CREDIT_PAYMENT
  amount                REAL NOT NULL,
  type                  TEXT NOT NULL,     -- TransactionType enum value
  description           TEXT NOT NULL DEFAULT '',
  date                  TEXT NOT NULL,     -- YYYY-MM-DD (ISO 8601 local date)
  is_paid               INTEGER NOT NULL DEFAULT 0,  -- boolean (0|1)
  transfer_account_id   TEXT,              -- CREDIT_PAYMENT: account that funds payment
  installment_parent_id TEXT,             -- UUID of first installment in the group
  installment_index     INTEGER,           -- 1-based index within the group
  installment_total     INTEGER,           -- total number of installments
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- Junction table: many-to-many between transactions and tags
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  action    TEXT NOT NULL,     -- 'CREATE' | 'UPDATE' | 'DELETE'
  entity    TEXT NOT NULL,     -- 'account' | 'category' | 'tag' | 'transaction' | 'user'
  entity_id TEXT NOT NULL,
  summary   TEXT NOT NULL      -- human-readable, generated in active locale at mutation time
);

-- Tombstones for entities explicitly deleted on this device (B-11)
CREATE TABLE IF NOT EXISTS deleted_ids (
  id TEXT PRIMARY KEY
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_transactions_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tx   ON transaction_tags(transaction_id);

PRAGMA user_version = 1;
