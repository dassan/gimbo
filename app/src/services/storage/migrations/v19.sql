-- Gimbo SQLite schema v19 — Transaction.notes
-- Free-text annotation per transaction, max 140 chars (enforced in the Zod schema, not here).
-- Applied incrementally on top of v18.

ALTER TABLE transactions ADD COLUMN notes TEXT;

PRAGMA user_version = 19;
