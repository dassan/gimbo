-- Gimbo SQLite schema v9 (M-64 — original purchase date for installments)
-- Adds installment_purchase_date to the transactions table: the original purchase date
-- shared by every installment in the group, distinct from each installment's own due date
-- (`date`). Applied incrementally on top of v8.

ALTER TABLE transactions ADD COLUMN installment_purchase_date TEXT;

PRAGMA user_version = 9;
