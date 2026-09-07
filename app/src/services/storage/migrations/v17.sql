-- Gimbo SQLite schema v17 (M-96/M-97 — dispositivo de origem no audit_log + nome de dispositivo sincronizado)
-- devices: um dispositivo (deviceId do OPFS, lib/cloudSync/deviceId.ts) por linha, com nome
-- opcional dado pelo usuário. Sincroniza como accounts/budgets (union por id, LWW por updated_at)
-- em vez de viver dentro de settings, cujo merge é objeto-inteiro local-wins (merge.ts) e nunca
-- propagaria o nome dado por outro dispositivo.
CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- audit_log ganha o dispositivo de origem, para "Modificações Recentes" identificar quem fez o
-- quê. NULL em toda linha existente (entrada de antes deste campo existir).
ALTER TABLE audit_log ADD COLUMN device_id TEXT;

PRAGMA user_version = 17;
