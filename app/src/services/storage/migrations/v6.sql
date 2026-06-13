-- Gimbo SQLite schema v6 (M-42 — archived accounts)
-- Adds archived to the accounts table: hides the account from selectors/lists while it
-- keeps counting in balance/net-worth/liability totals. Applied incrementally on top of v5.

ALTER TABLE accounts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;   -- M-42: 1 = hidden from selectors/lists

PRAGMA user_version = 6;
