-- Gimbo SQLite schema v15 (F-30/BX-12 revisão — targetSource)
-- Tracks whether a recipe budget's target came from herança/sugestão ('auto') or a human edit
-- ('manual') — drives when the "sugerir meta pelo histórico" recompute is allowed to touch a
-- slot (plan/BUDGETS.md §5.9.1). Applied incrementally on top of v14.

ALTER TABLE budgets ADD COLUMN target_source TEXT;

PRAGMA user_version = 15;
