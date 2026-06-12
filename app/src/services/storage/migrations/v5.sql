-- Gimbo SQLite schema v5 (CC-33 — resilient invoice due date)
-- Adds invoice_due_date to transactions: the authoritative due date ("YYYY-MM-DD") of the
-- invoice a CREDIT charge/credit is bound to, captured from the source. Lets historical
-- invoices stay anchored to their real due date even if the card's closing/due day later
-- changes (otherwise getEffectiveCashFlowDate re-derives it and drifts). Applied on top of v4.

ALTER TABLE transactions ADD COLUMN invoice_due_date TEXT;   -- CREDIT charge/credit: bound invoice due date "YYYY-MM-DD"

PRAGMA user_version = 5;
