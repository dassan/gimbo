-- Gimbo SQLite schema v10 (HE-14 — emergency reserve account marker)
-- Adds is_reserve to the accounts table: marks a RETAIL/SAVINGS account as part of the
-- user's emergency reserve (Account.reserveMetadata). Applied incrementally on top of v9.

ALTER TABLE accounts ADD COLUMN is_reserve INTEGER; -- reserveMetadata presence (RETAIL/SAVINGS only)

PRAGMA user_version = 10;
