-- Gimbo SQLite schema v8 (HE-04 — LOAN account type)
-- Adds loanMetadata columns to the accounts table: non-card loans/financing as a
-- first-class liability. outstandingBalance is maintained by the user (mirrors the
-- Valuation pattern for STOCKS/CRYPTO/ASSET) — no automatic amortization in v1.
-- Applied incrementally on top of v7.

ALTER TABLE accounts ADD COLUMN loan_outstanding_balance REAL;     -- loanMetadata.outstandingBalance (LOAN only)
ALTER TABLE accounts ADD COLUMN loan_monthly_payment REAL;         -- loanMetadata.monthlyPayment
ALTER TABLE accounts ADD COLUMN loan_remaining_installments INTEGER; -- loanMetadata.remainingInstallments
ALTER TABLE accounts ADD COLUMN loan_interest_rate REAL;           -- loanMetadata.interestRate (optional, % a.m.)

PRAGMA user_version = 8;
