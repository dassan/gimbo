-- Gimbo SQLite schema v16 (CS-30/CS-31 — sync incremental, Fase 2)
-- Tabela de controle de hash por partição: uma linha por tabela pequena (partition_key = '') e
-- uma linha por (transactions, ano). Permite ao sync comparar hashes antes de ler/mesclar/
-- reescrever uma partição, pulando inteiramente as que baterem dos dois lados (local e peer).
-- row_count guardado ao lado do hash reduz o risco de falso positivo do XOR-fold (rowHash.ts):
-- uma partição só é tratada como "igual" se hash E contagem baterem.

CREATE TABLE IF NOT EXISTS table_hashes (
  table_name    TEXT NOT NULL,
  partition_key TEXT NOT NULL DEFAULT '',
  hash_value    INTEGER NOT NULL,
  row_count     INTEGER NOT NULL,
  PRIMARY KEY (table_name, partition_key)
);

PRAGMA user_version = 16;
