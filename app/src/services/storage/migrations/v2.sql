-- Gimbo SQLite schema v2 (NW-08)
-- Adds the valuations table for market-value snapshots of investment accounts.
-- Applied incrementally on top of v1 (CURRENT_SCHEMA_VERSION = 1).

CREATE TABLE IF NOT EXISTS valuations (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  date         TEXT NOT NULL,   -- YYYY-MM-DD (ISO 8601 local date)
  market_value REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_valuations_account ON valuations(account_id);
CREATE INDEX IF NOT EXISTS idx_valuations_date    ON valuations(date);

PRAGMA user_version = 2;
