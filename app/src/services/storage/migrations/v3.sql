-- Gimbo SQLite schema v3 (M-35)
-- Adds recurrence columns to the transactions table for recurring INCOME/EXPENSE series.
-- Applied incrementally on top of v2.

ALTER TABLE transactions ADD COLUMN recurrence_parent_id TEXT;   -- UUID of the first occurrence in the series
ALTER TABLE transactions ADD COLUMN recurrence_frequency TEXT;   -- 'weekly' | 'biweekly' | 'monthly'
ALTER TABLE transactions ADD COLUMN recurrence_end_date  TEXT;   -- YYYY-MM-DD, optional series end

CREATE INDEX IF NOT EXISTS idx_transactions_recurrence ON transactions(recurrence_parent_id);

PRAGMA user_version = 3;
