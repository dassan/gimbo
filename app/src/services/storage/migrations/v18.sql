-- Gimbo SQLite schema v18 (M-101 — Simulações)
-- Adds the hypotheses table and its owned hypothesis_items (1:N, never linked to any real
-- Transaction/Account — see types/index.ts and CLAUDE.md decision log for why).
-- Applied incrementally on top of v17.

CREATE TABLE IF NOT EXISTS hypotheses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypothesis_items (
  id                TEXT PRIMARY KEY,
  hypothesis_id     TEXT NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,     -- 'ONE_TIME' | 'INSTALLMENT' | 'RECURRING' | 'CATEGORY_TARGET'
  description       TEXT NOT NULL,
  type              TEXT NOT NULL,     -- 'INCOME' | 'EXPENSE'
  amount            REAL NOT NULL,
  start_date        TEXT NOT NULL,
  installment_count INTEGER,           -- kind = 'INSTALLMENT'
  frequency         TEXT,              -- kind = 'RECURRING'
  end_date          TEXT,              -- kind = 'RECURRING', optional
  category_id       TEXT               -- kind = 'CATEGORY_TARGET'
);

CREATE INDEX IF NOT EXISTS idx_hypothesis_items_hypothesis ON hypothesis_items(hypothesis_id);

PRAGMA user_version = 18;
