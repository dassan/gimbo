-- Gimbo SQLite schema v12 (F-30/BX-07 — Receita "Quadrantes")
-- Adds the opt-in toggle for the Quadrantes recipe (plan/BUDGETS.md §5.6).
-- Applied incrementally on top of v11.

ALTER TABLE settings ADD COLUMN quadrantes_enabled INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 12;
