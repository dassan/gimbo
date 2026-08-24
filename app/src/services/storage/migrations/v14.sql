-- Gimbo SQLite schema v14 (F-30/BX-12 — sugestão de meta por histórico, Quadrantes)
-- Adds the opt-in toggle for inferring a Quadrante's first-generation target from history
-- (plan/BUDGETS.md §5.9.1). Applied incrementally on top of v13.

ALTER TABLE settings ADD COLUMN quadrantes_infer_from_history INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 14;
