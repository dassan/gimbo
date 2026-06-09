-- Gimbo SQLite schema v4 (Option 2 — invoice payment binding)
-- Adds reference_month to the transactions table so a CREDIT_PAYMENT records which
-- invoice period it settles ("YYYY-MM"). Applied incrementally on top of v3.

ALTER TABLE transactions ADD COLUMN reference_month TEXT;   -- CREDIT_PAYMENT: paid invoice period "YYYY-MM"

PRAGMA user_version = 4;
