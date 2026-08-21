-- Gimbo SQLite schema v13 (M-72/PERFORMANCE.md — getTransactions() lento no cofre real)
-- Índice composto para servir ORDER BY t.date DESC, t.created_at DESC sem b-tree temporária de
-- desempate. idx_transactions_date (v1) sozinho só cobre a primeira coluna; medido com o cofre
-- real (~25 mil transações): ORDER BY de uma coluna ~5.8s, duas colunas ~20s (b-tree extra pra
-- desempatar created_at dentro de cada dia). Aplicado incrementalmente sobre o v12.

CREATE INDEX IF NOT EXISTS idx_transactions_date_created ON transactions(date DESC, created_at DESC);

PRAGMA user_version = 13;
