-- Gimbo SQLite schema v11 (F-30/BX-03 — Caixinhas)
-- Adds the budgets table and its transaction_budgets junction (N:N, mirrors transaction_tags).
-- Applied incrementally on top of v10.

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL,          -- 'expense' | 'income'
  target       REAL NOT NULL,
  period_mode  TEXT NOT NULL,          -- 'date' | 'range'
  period_date  TEXT,                   -- period_mode = 'date'
  period_start TEXT,                   -- period_mode = 'range'
  period_end   TEXT,                   -- period_mode = 'range'
  archived_at  TEXT,                   -- NULL = active (plan/BUDGETS.md §5.8)
  recipe_slug  TEXT,                   -- 'quadrantes'; NULL for manual budgets
  recipe_slot  INTEGER,                -- 1-4; only set alongside recipe_slug
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Junction table: many-to-many between transactions and budgets
CREATE TABLE IF NOT EXISTS transaction_budgets (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  budget_id      TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, budget_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_budgets_tx     ON transaction_budgets(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_budgets_budget ON transaction_budgets(budget_id);

PRAGMA user_version = 11;
