/// <reference lib="webworker" />
// This file runs as a Dedicated Web Worker. TypeScript sees both DOM and
// WebWorker libs; `declare const self` below resolves the `self` ambiguity.
declare const self: DedicatedWorkerGlobalScope

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
import * as SQLite from 'wa-sqlite'
// @ts-expect-error – JavaScript VFS without ambient declarations
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js'
import v1Schema from './migrations/v1.sql?raw'
import v2Schema from './migrations/v2.sql?raw'
import v3Schema from './migrations/v3.sql?raw'
import v4Schema from './migrations/v4.sql?raw'
import v5Schema from './migrations/v5.sql?raw'
import v6Schema from './migrations/v6.sql?raw'
import v7Schema from './migrations/v7.sql?raw'
import v8Schema from './migrations/v8.sql?raw'
import v9Schema from './migrations/v9.sql?raw'
import v10Schema from './migrations/v10.sql?raw'
import v11Schema from './migrations/v11.sql?raw'
import v12Schema from './migrations/v12.sql?raw'
import v13Schema from './migrations/v13.sql?raw'
import v14Schema from './migrations/v14.sql?raw'
import v15Schema from './migrations/v15.sql?raw'
import v16Schema from './migrations/v16.sql?raw'
import { ERR_DB_UNREADABLE, ERR_SCHEMA_TOO_NEW } from './errors'
import {
  hashRow,
  combineHashes,
  accountRowKey,
  categoryRowKey,
  tagRowKey,
  budgetRowKey,
  valuationRowKey,
  savedPeriodRowKey,
  auditEntryRowKey,
  deletedIdRowKey,
  transactionRowKey,
} from '@/lib/storage/rowHash'

// ─── Protocol types ───────────────────────────────────────────────────────────

type WorkerRequest = {
  id: string
  method: string
  args: unknown[]
}

type WorkerResponse = {
  id: string
  result?: unknown
  error?: string
  perf?: { metric: string; ms: number }
}

// ─── DataFile subset used by replaceAll ───────────────────────────────────────

type RawUser = { name: string; createdAt: string; updatedAt: string }
type RawSettings = {
  fileCreatedAt: string
  fileUpdatedAt: string
  auditLogRetentionLimit: number | null
  quadrantesEnabled: boolean
  quadrantesInferFromHistory: boolean
}
// Exported (type-only elsewhere) so lib/storage/rowHash.ts can compute a canonical hash key per
// row without duplicating these shapes — CS-30/CS-31 Fase 2.
export type RawAccount = {
  id: string
  name: string
  type: string
  balance: number
  includeInBalance: boolean
  creditMetadata?: { limit: number; closingDay: number; dueDay: number }
  loanMetadata?: {
    outstandingBalance: number
    monthlyPayment: number
    remainingInstallments: number
    interestRate?: number
  }
  reserveMetadata?: Record<string, never>
  issuerIcon?: string
  archived?: boolean
  updatedAt?: string
}
export type RawCategory = {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: string
  updatedAt?: string
}
export type RawTag = { id: string; name: string; color: string; updatedAt?: string }
export type RawTransaction = {
  id: string
  accountId: string
  categoryId: string
  amount: number
  type: string
  description: string
  date: string
  isPaid: boolean
  tags: string[]
  installment?: { parentId: string; currentIndex: number; total: number; purchaseDate?: string }
  recurrence?: { frequency: string; parentId: string; endDate?: string }
  transferAccountId?: string
  referenceMonth?: string
  invoiceDueDate?: string
  updatedAt?: string
  createdAt?: string
  budgetIds?: string[]
}
export type RawAuditEntry = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string
  summary: string
}
export type RawValuation = {
  id: string
  accountId: string
  date: string
  marketValue: number
}
export type RawSavedPeriod = {
  id: string
  name: string
  start: string
  end: string
}
export type RawBudget = {
  id: string
  name: string
  emoji: string
  color: string
  kind: string
  target: number
  period: { mode: 'date'; date: string } | { mode: 'range'; start: string; end: string }
  archivedAt?: string
  recipeSlug?: string
  recipeSlot?: number
  updatedAt?: string
  createdAt?: string
  targetSource?: string
}
type RawDataFile = {
  user: RawUser
  settings: RawSettings
  accounts: RawAccount[]
  categories: RawCategory[]
  tags: RawTag[]
  transactions: RawTransaction[]
  valuations: RawValuation[]
  auditLog: RawAuditEntry[]
  deletedIds: string[]
  savedPeriods: RawSavedPeriod[]
  budgets: RawBudget[]
}

// ─── SQLite state ─────────────────────────────────────────────────────────────

// `SQLiteAPI` is declared globally by wa-sqlite's ambient types.
let sqlite3: SQLiteAPI
let db: number // opaque database pointer returned by open_v2

// SEC-06: só o resgate consulta isto. `db`/`sqlite3` ficam indefinidos se o `init()` falhar, e é
// exatamente nesse cenário que o resgate precisa rodar — daí uma flag em vez de checar `db`.
let dbReady = false

// M-73/PERFORMANCE.md: teto real de parâmetros ligados que esta build do SQLite aceita numa
// query só — descoberto no init() via sqlite3.limit(), não chutado, com 10% de margem. Usado
// pra dimensionar os lotes de applyTransactionDelta(). Fallback conservador se a consulta falhar
// ou devolver algo implausível.
let maxBoundParams = 900

// SQLITE_LIMIT_VARIABLE_NUMBER — constante pública da API C do SQLite (não muda entre versões),
// não reexportada pelo módulo principal do wa-sqlite (só por sqlite-constants.js, que não
// importamos só por isto). Ver node_modules/wa-sqlite/src/sqlite-constants.js.
const SQLITE_LIMIT_VARIABLE_NUMBER = 9

const DB_FILENAME = 'gimbo.db'

// Highest PRAGMA user_version this build knows how to migrate. CS-15 (folderSyncService)
// compares a peer's raw version against this before attempting to read it — a peer ahead of
// this number was written by a newer app build and must be skipped, not partially migrated.
// Bump this alongside every new migrations/vN.sql (same trap as data/sync_gimbo.py — see
// CLAUDE.md "Armadilha recorrente").
const MAX_KNOWN_DB_VERSION = 16

// ─── Initialization ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // SQLiteESMFactory returns the opaque Emscripten module typed as `any`.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const module = await SQLiteESMFactory()
  sqlite3 = SQLite.Factory(module)

  // Ensure OPFS root is available before the VFS tries to use it
  await navigator.storage.getDirectory()

  // OriginPrivateFileSystemVFS stores files under their virtual filename directly
  // in the OPFS root, making export/import straightforward.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const vfs = new OriginPrivateFileSystemVFS() as SQLiteVFS
  sqlite3.vfs_register(vfs, /* makeDefault */ true)

  db = await sqlite3.open_v2(DB_FILENAME)
  await runMigrationsOn(db)
  await backfillTableHashesIfNeeded(db)

  const queriedLimit = sqlite3.limit(db, SQLITE_LIMIT_VARIABLE_NUMBER, -1)
  if (queriedLimit > 0) maxBoundParams = Math.floor(queriedLimit * 0.9)

  dbReady = true
}

// Ordem de aplicação das migrations. Substituiu uma escada de 12 `if (version < N)` para que a
// aplicação seja um laço — é o que torna viável envolver cada passo numa transação (SEC-06).
// Ao adicionar `vN.sql`: incluir aqui E bumpar MAX_KNOWN_DB_VERSION acima (e o sync_gimbo.py,
// ver "Armadilha recorrente" no CLAUDE.md).
const MIGRATIONS: ReadonlyArray<readonly [version: number, sql: string]> = [
  [1, v1Schema],
  [2, v2Schema],
  [3, v3Schema],
  [4, v4Schema],
  [5, v5Schema],
  [6, v6Schema],
  [7, v7Schema],
  [8, v8Schema],
  [9, v9Schema],
  [10, v10Schema],
  [11, v11Schema],
  [12, v12Schema],
  [13, v13Schema],
  [14, v14Schema],
  [15, v15Schema],
  [16, v16Schema],
]

// Applies pending migrations to an arbitrary db pointer — the main `db` on every open, or a
// scratch db opened from a peer's bytes (CS-15's readForeignDataFile, which never touches `db`),
// ou a cópia em staging de um import (SEC-05).
//
// SEC-06 — duas garantias que a versão anterior não dava:
//
// 1. **Cada migration roda numa transação.** Os arquivos `vN.sql` usam `ALTER TABLE ... ADD COLUMN`,
//    que o SQLite não suporta com `IF NOT EXISTS`, e terminam com `PRAGMA user_version = N`. Sem
//    transação, uma interrupção entre o ALTER e o PRAGMA (aba fechada, quota de OPFS, crash do
//    worker) deixava a coluna criada e a versão desatualizada — no boot seguinte o mesmo ALTER
//    rodava de novo e falhava com `duplicate column name`, **em definitivo**, com o cofre trancado
//    no OPFS. O SQLite tem DDL transacional e o `user_version` vive no header do arquivo, então
//    ambos entram no mesmo COMMIT: ou a migration inteira valeu, ou nada dela valeu.
//    (Verificado que nenhum `vN.sql` abre transação própria — envolvê-los é seguro.)
//
// 2. **Guarda de versão futura.** Antes só o caminho de peer comparava contra MAX_KNOWN_DB_VERSION;
//    o boot e o import abriam um arquivo de versão desconhecida e liam com o schema velho.
async function runMigrationsOn(dbPtr: number): Promise<void> {
  // WAL mode gives better read concurrency and enables clean export via checkpoint.
  // This is idempotent — safe to call on every open. Fica fora da transação de propósito:
  // `PRAGMA journal_mode` não pode ser trocado dentro de uma.
  await sqlite3.run(dbPtr, 'PRAGMA journal_mode=WAL')

  // M-71/PERFORMANCE.md: sem isto, b-trees temporárias de GROUP BY/ORDER BY (ex.:
  // getTransactions(), que agrupa por t.id e ordena por t.date/created_at — chaves diferentes)
  // espirram para "arquivo", e como a VFS registrada é assíncrona (OriginPrivateFileSystemVFS),
  // cada página do temporário vira uma operação assíncrona contra o OPFS. temp_store não é
  // persistido no arquivo do banco — precisa ser setado a cada conexão, por isso mora aqui, ao
  // lado do journal_mode, que já roda em toda abertura.
  await sqlite3.run(dbPtr, 'PRAGMA temp_store = MEMORY')

  const { rows } = await sqlite3.execWithParams(dbPtr, 'PRAGMA user_version')
  const version = (rows[0]?.[0] ?? 0) as number

  if (version > MAX_KNOWN_DB_VERSION) {
    throw new Error(
      `${ERR_SCHEMA_TOO_NEW}: banco na versão ${version}, este build migra até ${MAX_KNOWN_DB_VERSION}`
    )
  }

  for (const [target, sql] of MIGRATIONS) {
    if (version >= target) continue

    await sqlite3.run(dbPtr, 'BEGIN')
    try {
      await sqlite3.run(dbPtr, sql)
      await sqlite3.run(dbPtr, 'COMMIT')
    } catch (err) {
      try {
        await sqlite3.run(dbPtr, 'ROLLBACK')
      } catch {
        // Já desfeita pelo próprio erro, ou transação nunca aberta — nada a liberar.
      }
      throw err
    }
  }
}

// ─── Export / Import ──────────────────────────────────────────────────────────

async function exportDb(): Promise<ArrayBuffer> {
  // Flush all committed WAL frames into the main database file so the
  // snapshot we read is consistent and complete.
  await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')

  // OriginPrivateFileSystemVFS maps `gimbo.db` → OPFS file named `gimbo.db`.
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(DB_FILENAME)
  const file = await fileHandle.getFile()
  return file.arrayBuffer()
}

// Remove um arquivo do OPFS junto de seus acompanhantes de journal. Best-effort: a ausência de
// `-wal`/`-journal` é o caso comum, não um erro.
async function removeDbFiles(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  for (const suffix of ['', '-wal', '-journal'] as const) {
    try {
      await root.removeEntry(name + suffix)
    } catch {
      // Não existe — nada a fazer.
    }
  }
}

async function readFileBytes(root: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const handle = await root.getFileHandle(name)
  return (await handle.getFile()).arrayBuffer()
}

async function writeFileBytes(
  root: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer
): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

/**
 * Import de backup — **replace total** do cofre.
 *
 * SEC-05: a versão anterior fechava o banco e sobrescrevia `gimbo.db` no OPFS **antes** de saber
 * se os bytes recebidos eram sequer um SQLite válido. Um `.db` truncado, corrompido, ou capturado
 * no meio de uma escrita do cliente de nuvem apagava permanentemente todo o histórico financeiro,
 * e a UI só exibia "arquivo corrompido" depois que os dados já tinham sumido.
 *
 * Agora o cofre atual só é tocado depois que a cópia recebida provou, num arquivo separado, que:
 * abre como SQLite, não vem de uma versão futura do schema, migra até a atual, e contém um
 * DataFile efetivamente legível (não só um arquivo que "abre"). É o mesmo padrão que
 * `readForeignDataFile` (CS-15) já usava para peers — este caminho é que não o reusava.
 *
 * A promoção final ainda copia bytes, então guarda-se um snapshot do cofre atual como rede: se a
 * troca falhar no meio, o snapshot é restaurado e o usuário fica exatamente como estava.
 */
async function importDb(data: ArrayBuffer): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const stagingName = `import-staging-${crypto.randomUUID()}.db`
  const rollbackName = `import-rollback-${crypto.randomUUID()}.db`

  // ── 1. Materializa os bytes recebidos fora do caminho do cofre ───────────────
  try {
    await writeFileBytes(root, stagingName, data)
  } catch (err) {
    await removeDbFiles(root, stagingName)
    throw new Error(`${ERR_DB_UNREADABLE}: falha ao gravar o arquivo recebido (${String(err)})`)
  }

  // ── 2. Valida a cópia: abre, guarda de versão, migra e lê de verdade ─────────
  let stagingDb: number
  try {
    stagingDb = await sqlite3.open_v2(stagingName)
  } catch {
    await removeDbFiles(root, stagingName)
    throw new Error(`${ERR_DB_UNREADABLE}: o arquivo não é um banco SQLite válido`)
  }

  let migratedBytes: ArrayBuffer
  try {
    // `runMigrationsOn` já lança ERR_SCHEMA_TOO_NEW quando o user_version é maior que este build
    // conhece, e cada migration roda em transação (SEC-06).
    await runMigrationsOn(stagingDb)

    // Abrir não é o suficiente: um arquivo pode ser SQLite válido e mesmo assim não conter o
    // schema do Gimbo. Ler o DataFile é o que prova que a importação vai resultar em algo usável.
    const parsed = await readDataFileFromDb(stagingDb)
    if (!parsed) {
      throw new Error(`${ERR_DB_UNREADABLE}: o arquivo não contém dados do Gimbo`)
    }

    // Consolida o WAL da migração dentro do próprio arquivo, para promover um único blob coerente.
    await sqlite3.run(stagingDb, 'PRAGMA wal_checkpoint(FULL)')
    await sqlite3.close(stagingDb)
    migratedBytes = await readFileBytes(root, stagingName)
  } catch (err) {
    try {
      await sqlite3.close(stagingDb)
    } catch {
      // Já fechado pelo caminho feliz acima, ou nunca totalmente aberto.
    }
    await removeDbFiles(root, stagingName)
    throw err instanceof Error && String(err.message).startsWith('GIMBO_')
      ? err
      : new Error(`${ERR_DB_UNREADABLE}: ${String(err)}`)
  }

  // ── 3. Snapshot do cofre atual, para poder desfazer a troca ──────────────────
  await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')
  await sqlite3.close(db)
  let haveRollback = false
  try {
    await writeFileBytes(root, rollbackName, await readFileBytes(root, DB_FILENAME))
    haveRollback = true
  } catch {
    // Cofre ainda inexistente (import no onboarding) — não há o que desfazer.
  }

  // ── 4. Promove a cópia validada ──────────────────────────────────────────────
  try {
    await writeFileBytes(root, DB_FILENAME, migratedBytes)
    // WAL/journal antigos descrevem o banco anterior; deixá-los corromperia a próxima abertura.
    for (const suffix of ['-wal', '-journal'] as const) {
      try {
        await root.removeEntry(DB_FILENAME + suffix)
      } catch {
        // Não existe — nada a fazer.
      }
    }
    db = await sqlite3.open_v2(DB_FILENAME)
    await runMigrationsOn(db)
    // CS-34: importDb() reabre `db` fora do caminho de boot de init() — sem isto, um .db
    // importado sem table_hashes só ganharia o backfill no próximo reload da página, não neste
    // mesmo carregamento (a UI já segue usando o cofre importado sem reload, ver handleImportDb
    // em Settings/Onboarding).
    await backfillTableHashesIfNeeded(db)
  } catch (err) {
    // A troca falhou no meio. Devolve o cofre ao estado anterior antes de propagar.
    if (haveRollback) {
      try {
        await writeFileBytes(root, DB_FILENAME, await readFileBytes(root, rollbackName))
        for (const suffix of ['-wal', '-journal'] as const) {
          try {
            await root.removeEntry(DB_FILENAME + suffix)
          } catch {
            // Não existe — nada a fazer.
          }
        }
        db = await sqlite3.open_v2(DB_FILENAME)
        await runMigrationsOn(db)
      } catch {
        // Restauração falhou também. Preserva o snapshot em disco em vez de apagá-lo no `finally`
        // — é a única cópia dos dados do usuário neste ponto, e o resgate do SEC-06 a alcança.
        await removeDbFiles(root, stagingName)
        throw new Error(
          `${ERR_DB_UNREADABLE}: falha ao importar e ao restaurar; cópia do cofre anterior preservada em "${rollbackName}" no OPFS`
        )
      }
    } else {
      // Sem snapshot (não havia cofre antes — import no onboarding). Nada a restaurar, mas o
      // ponteiro `db` acabou de ser fechado na fase 3: sem reabrir, toda operação seguinte
      // falharia até um reload, mesmo o erro sendo recuperável. Best-effort de propósito — se
      // nem isso funcionar, o erro original abaixo continua sendo o que descreve a falha.
      try {
        db = await sqlite3.open_v2(DB_FILENAME)
        await runMigrationsOn(db)
      } catch {
        // Worker segue inutilizável até um reload; o erro propagado abaixo já diz ao usuário
        // que o import falhou, e não havia dados a perder neste caminho.
      }
    }
    await removeDbFiles(root, stagingName)
    await removeDbFiles(root, rollbackName)
    throw err
  }

  await removeDbFiles(root, stagingName)
  await removeDbFiles(root, rollbackName)
}

// ─── Hash de partição (CS-30/CS-31 Fase 2) ─────────────────────────────────────

// Upsert de uma linha de table_hashes contra o `db` local — sempre o `db` módulo-level, nunca um
// dbPtr de peer/scratch/staging, porque a tabela de hash existe pra o sync decidir o que ler
// *deste* dispositivo, não pra descrever um banco alheio.
async function upsertTableHash(
  tableName: string,
  partitionKey: string,
  hash: number,
  rowCount: number
): Promise<void> {
  await sqlite3.run(
    db,
    `INSERT INTO table_hashes (table_name, partition_key, hash_value, row_count) VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name, partition_key) DO UPDATE SET hash_value = excluded.hash_value, row_count = excluded.row_count`,
    [tableName, partitionKey, hash, rowCount]
  )
}

// As 8 tabelas "pequenas" — sempre hasheadas como um todo (partition_key = ''), nunca
// particionadas por ano como transactions. settings/users ficam de fora: são singleton, sempre
// lidos, comparar hash não economiza nada. deleted_ids entra aqui (não em transactions) porque um
// tombstone pode apagar qualquer tipo de entidade, não só transações.
async function refreshSmallTableHashes(d: RawDataFile, ts: string): Promise<void> {
  // accounts/categories/tags/budgets persistem `updatedAt ?? ts` (abaixo, nas próprias inserções)
  // quando o objeto em memória não traz um `updatedAt` — hashear o valor *não normalizado* faria
  // o hash mudar sozinho no primeiro round-trip por loadDataFile() (que sempre volta com o
  // fallback já preenchido), mesmo sem nenhuma edição real. Normalizar aqui do mesmo jeito que a
  // escrita normaliza mantém o hash estável através de leitura-e-escrita-de-volta — achado via
  // e2e/tableHashSync.spec.ts (o hash de accounts mudava sozinho depois de um applyMutation que
  // só tocava transactions).
  await upsertTableHash(
    'accounts',
    '',
    combineHashes(
      d.accounts.map((a) => hashRow(accountRowKey({ ...a, updatedAt: a.updatedAt ?? ts })))
    ),
    d.accounts.length
  )
  await upsertTableHash(
    'categories',
    '',
    combineHashes(
      d.categories.map((c) => hashRow(categoryRowKey({ ...c, updatedAt: c.updatedAt ?? ts })))
    ),
    d.categories.length
  )
  await upsertTableHash(
    'tags',
    '',
    combineHashes(d.tags.map((t) => hashRow(tagRowKey({ ...t, updatedAt: t.updatedAt ?? ts })))),
    d.tags.length
  )
  await upsertTableHash(
    'budgets',
    '',
    combineHashes(
      (d.budgets ?? []).map((b) => hashRow(budgetRowKey({ ...b, updatedAt: b.updatedAt ?? ts })))
    ),
    (d.budgets ?? []).length
  )
  await upsertTableHash(
    'valuations',
    '',
    combineHashes((d.valuations ?? []).map((v) => hashRow(valuationRowKey(v)))),
    (d.valuations ?? []).length
  )
  await upsertTableHash(
    'saved_periods',
    '',
    combineHashes((d.savedPeriods ?? []).map((p) => hashRow(savedPeriodRowKey(p)))),
    (d.savedPeriods ?? []).length
  )
  await upsertTableHash(
    'audit_log',
    '',
    combineHashes(d.auditLog.map((e) => hashRow(auditEntryRowKey(e)))),
    d.auditLog.length
  )
  await upsertTableHash(
    'deleted_ids',
    '',
    combineHashes(d.deletedIds.map((id) => hashRow(deletedIdRowKey(id)))),
    d.deletedIds.length
  )
}

async function upsertTransactionYearHash(year: string, txs: RawTransaction[]): Promise<void> {
  // combineHashes([]) === 0 — um ano que esvaziou por completo (última transação apagada) grava
  // (hash=0, row_count=0), nunca deixa a entrada antiga (agora errada) parada em table_hashes.
  await upsertTableHash(
    'transactions',
    year,
    combineHashes(txs.map((t) => hashRow(transactionRowKey(t)))),
    txs.length
  )
}

// Usado por replaceAll(): já tem o array completo de transações em mãos (reescreveu tudo), então
// agrupa por ano em memória. Precisa ainda assim consultar quais anos já tinham entrada em
// table_hashes — um ano que existia antes e não aparece mais no array novo (todas as transações
// daquele ano vieram deletadas pelo merge) tem que ser zerado, não deixado com o hash antigo.
//
// `ts`: mesma normalização de refreshSmallTableHashes — a escrita logo abaixo persiste
// `tx.updatedAt ?? ts`/`tx.createdAt ?? ts` quando o objeto em memória não traz esses campos;
// hashear o valor pré-fallback faria o hash mudar sozinho no primeiro round-trip por
// loadDataFile()/refreshTransactionYearHashesFromDb (que sempre voltam com o fallback já
// preenchido). Só relevante aqui: a variante "FromDb" já lê o estado persistido, já normalizado.
async function refreshTransactionYearHashesFromMemory(
  transactions: RawTransaction[],
  ts: string
): Promise<void> {
  const byYear = new Map<string, RawTransaction[]>()
  for (const raw of transactions) {
    const tx: RawTransaction = {
      ...raw,
      updatedAt: raw.updatedAt ?? ts,
      createdAt: raw.createdAt ?? ts,
    }
    const year = tx.date.slice(0, 4)
    const list = byYear.get(year)
    if (list) list.push(tx)
    else byYear.set(year, [tx])
  }
  const { rows: existingYearRows } = await sqlite3.execWithParams(
    db,
    "SELECT DISTINCT partition_key FROM table_hashes WHERE table_name = 'transactions'"
  )
  const years = new Set<string>(byYear.keys())
  for (const [year] of existingYearRows) years.add(year as string)
  for (const year of years) {
    await upsertTransactionYearHash(year, byYear.get(year) ?? [])
  }
}

// Usado por applyTransactionDelta(): só os anos de fato afetados por esta mutação (fetchOldYears
// + anos novos dos upserts) — relê cada um do `db` (já com o delta aplicado) em vez de manter um
// array completo em memória, porque o delta não carrega o estado das linhas não tocadas.
async function refreshTransactionYearHashesFromDb(years: Iterable<string>): Promise<void> {
  for (const year of years) {
    const txRows = await queryRows(db, 'SELECT * FROM transactions WHERE date LIKE ?', [`${year}%`])
    const ids = txRows.map((r) => r.id as string)
    const idBatchSize = Math.max(1, maxBoundParams)
    const tagsByTx = new Map<string, string[]>()
    const budgetsByTx = new Map<string, string[]>()
    for (const idBatch of chunk(ids, idBatchSize)) {
      if (idBatch.length === 0) continue
      const placeholders = idBatch.map(() => '?').join(',')
      const tagRows = await queryRows(
        db,
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      const budgetRows = await queryRows(
        db,
        `SELECT transaction_id, budget_id FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      for (const [id, list] of groupJoinIds(tagRows, 'tag_id')) tagsByTx.set(id, list)
      for (const [id, list] of groupJoinIds(budgetRows, 'budget_id')) budgetsByTx.set(id, list)
    }
    const txs = txRows.map((r) =>
      sqlRowToRawTransaction(
        r,
        tagsByTx.get(r.id as string) ?? [],
        budgetsByTx.get(r.id as string) ?? []
      )
    )
    await upsertTransactionYearHash(year, txs)
  }
}

// ─── replaceAll ───────────────────────────────────────────────────────────────

// M-73/PERFORMANCE.md: tudo que replaceAll() reescreve por completo EXCETO
// transactions/transaction_tags/transaction_budgets — extraído pra ser reaproveitado por
// applyMutation() (M-73), que troca só a parte de transações por um diff direcionado. Estas
// tabelas são pequenas (dezenas/centenas de linhas, nunca a mesma ordem de grandeza de
// transactions) — o custo de reescrever tudo nelas a cada mutação já é baixo, não vale o risco
// de dar CRUD direcionado pra cada uma.
async function writeSmallTables(d: RawDataFile, ts: string): Promise<void> {
  // Clear in dependency order (junction tables and leaves first)
  await sqlite3.run(db, 'DELETE FROM audit_log')
  await sqlite3.run(db, 'DELETE FROM deleted_ids')
  await sqlite3.run(db, 'DELETE FROM valuations')
  await sqlite3.run(db, 'DELETE FROM saved_periods')
  await sqlite3.run(db, 'DELETE FROM budgets')
  await sqlite3.run(db, 'DELETE FROM categories')
  await sqlite3.run(db, 'DELETE FROM tags')
  await sqlite3.run(db, 'DELETE FROM accounts')
  await sqlite3.run(db, 'DELETE FROM settings')
  await sqlite3.run(db, 'DELETE FROM users')

  // user — `email` column kept physically (no DDL change) but never populated anymore, M-69
  await sqlite3.run(
    db,
    "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('singleton', ?, '', ?, ?)",
    [d.user.name, d.user.createdAt, d.user.updatedAt]
  )

  // settings
  await sqlite3.run(
    db,
    "INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit, quadrantes_enabled, quadrantes_infer_from_history) VALUES ('singleton', ?, ?, ?, ?, ?)",
    [
      d.settings.fileCreatedAt,
      d.settings.fileUpdatedAt,
      d.settings.auditLogRetentionLimit,
      d.settings.quadrantesEnabled ? 1 : 0,
      d.settings.quadrantesInferFromHistory ? 1 : 0,
    ]
  )

  // accounts
  for (const acc of d.accounts) {
    await sqlite3.run(
      db,
      `INSERT INTO accounts
           (id, name, type, balance, include_in_balance,
            credit_limit, credit_closing_day, credit_due_day,
            loan_outstanding_balance, loan_monthly_payment, loan_remaining_installments, loan_interest_rate,
            is_reserve, issuer_icon, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        acc.id,
        acc.name,
        acc.type,
        acc.balance,
        acc.includeInBalance ? 1 : 0,
        acc.creditMetadata?.limit ?? null,
        acc.creditMetadata?.closingDay ?? null,
        acc.creditMetadata?.dueDay ?? null,
        acc.loanMetadata?.outstandingBalance ?? null,
        acc.loanMetadata?.monthlyPayment ?? null,
        acc.loanMetadata?.remainingInstallments ?? null,
        acc.loanMetadata?.interestRate ?? null,
        acc.reserveMetadata ? 1 : 0,
        acc.issuerIcon ?? null,
        acc.archived ? 1 : 0,
        ts,
        acc.updatedAt ?? ts,
      ]
    )
  }

  // categories — parents before children to respect the self-referential FK
  const parents = d.categories.filter((c) => !c.parentId)
  const children = d.categories.filter((c) => c.parentId)
  for (const cat of [...parents, ...children]) {
    await sqlite3.run(
      db,
      `INSERT INTO categories (id, parent_id, name, icon, color, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cat.id,
        cat.parentId ?? null,
        cat.name,
        cat.icon,
        cat.color,
        cat.type,
        ts,
        cat.updatedAt ?? ts,
      ]
    )
  }

  // tags
  for (const tag of d.tags) {
    await sqlite3.run(
      db,
      'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [tag.id, tag.name, tag.color, ts, tag.updatedAt ?? ts]
    )
  }

  // budgets (F-30/BX-03)
  for (const b of d.budgets ?? []) {
    await sqlite3.run(
      db,
      `INSERT INTO budgets
           (id, name, emoji, color, kind, target, period_mode, period_date, period_start, period_end,
            archived_at, recipe_slug, recipe_slot, created_at, updated_at, target_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.id,
        b.name,
        b.emoji,
        b.color,
        b.kind,
        b.target,
        b.period.mode,
        b.period.mode === 'date' ? b.period.date : null,
        b.period.mode === 'range' ? b.period.start : null,
        b.period.mode === 'range' ? b.period.end : null,
        b.archivedAt ?? null,
        b.recipeSlug ?? null,
        b.recipeSlot ?? null,
        b.createdAt ?? ts,
        b.updatedAt ?? ts,
        b.targetSource ?? null,
      ]
    )
  }

  // valuations
  for (const v of d.valuations ?? []) {
    await sqlite3.run(
      db,
      'INSERT INTO valuations (id, account_id, date, market_value) VALUES (?, ?, ?, ?)',
      [v.id, v.accountId, v.date, v.marketValue]
    )
  }

  // saved periods (M-45)
  for (const p of d.savedPeriods ?? []) {
    await sqlite3.run(
      db,
      'INSERT INTO saved_periods (id, name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [p.id, p.name, p.start, p.end, ts, ts]
    )
  }

  // audit log
  for (const entry of d.auditLog) {
    await sqlite3.run(
      db,
      'INSERT INTO audit_log (id, timestamp, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)',
      [entry.id, entry.timestamp, entry.action, entry.entity, entry.entityId, entry.summary]
    )
  }

  // tombstones
  for (const id of d.deletedIds) {
    await sqlite3.run(db, 'INSERT OR IGNORE INTO deleted_ids (id) VALUES (?)', [id])
  }

  await refreshSmallTableHashes(d, ts)
}

async function replaceAll(raw: unknown): Promise<void> {
  const d = raw as RawDataFile
  // Use the settings timestamp as a stable fallback for entities that lack one
  const ts = d.settings.fileCreatedAt || new Date().toISOString()

  await sqlite3.run(db, 'BEGIN')
  try {
    // Clear in dependency order (junction tables and leaves first)
    await sqlite3.run(db, 'DELETE FROM transaction_tags')
    await sqlite3.run(db, 'DELETE FROM transaction_budgets')
    await sqlite3.run(db, 'DELETE FROM transactions')

    await writeSmallTables(d, ts)

    // transactions + junction rows
    for (const tx of d.transactions) {
      await sqlite3.run(
        db,
        `INSERT INTO transactions
           (id, account_id, category_id, amount, type, description, date, is_paid,
            transfer_account_id, installment_parent_id, installment_index, installment_total,
            installment_purchase_date,
            recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
            invoice_due_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          tx.accountId,
          tx.categoryId || null,
          tx.amount,
          tx.type,
          tx.description,
          tx.date,
          tx.isPaid ? 1 : 0,
          tx.transferAccountId ?? null,
          tx.installment?.parentId ?? null,
          tx.installment?.currentIndex ?? null,
          tx.installment?.total ?? null,
          tx.installment?.purchaseDate ?? null,
          tx.recurrence?.parentId ?? null,
          tx.recurrence?.frequency ?? null,
          tx.recurrence?.endDate ?? null,
          tx.referenceMonth ?? null,
          tx.invoiceDueDate ?? null,
          tx.createdAt ?? ts,
          tx.updatedAt ?? ts,
        ]
      )
      for (const tagId of tx.tags) {
        await sqlite3.run(
          db,
          'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
          [tx.id, tagId]
        )
      }
      for (const budgetId of tx.budgetIds ?? []) {
        await sqlite3.run(
          db,
          'INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES (?, ?)',
          [tx.id, budgetId]
        )
      }
    }

    await refreshTransactionYearHashesFromMemory(d.transactions, ts)

    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

// ─── Mutação por diff (M-73/PERFORMANCE.md) ────────────────────────────────────
//
// replaceAll() reescreve a tabela transactions inteira a cada mutação — para o cofre real do
// usuário (~25 mil transações), ~29 mil INSERTs sequenciais por edição, cada um reprocessando o
// SQL do zero (sqlite3.run() prepara e finaliza a cada chamada, sem cache de statement).
// applyMutation() troca isso por um diff: só as linhas de transactions/transaction_tags/
// transaction_budgets que de fato mudaram viram INSERT/UPDATE/DELETE, em lotes multi-linha.

type RawTransactionDelta = { upserts: RawTransaction[]; deletedIds: string[] }

const TRANSACTION_COLUMNS = 20

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function applyTransactionDelta(delta: RawTransactionDelta, ts: string): Promise<void> {
  const idBatchSize = Math.max(1, maxBoundParams)
  const touchedIds = [...delta.deletedIds, ...delta.upserts.map((t) => t.id)]

  // CS-30/CS-31 Fase 2: precisa saber o ano *antigo* de cada linha tocada que já existia, antes
  // de qualquer DELETE/INSERT — é a única forma de saber de qual partição de hash tirar a
  // contribuição antiga se uma transação mudou de ano (ex.: editar a data de 31/dez pra jan do
  // ano seguinte). Sem isso, o hash do ano antigo ficaria parado, incorreto.
  const oldYearById = new Map<string, string>()
  for (const idBatch of chunk(touchedIds, idBatchSize)) {
    if (idBatch.length === 0) continue
    const placeholders = idBatch.map(() => '?').join(',')
    const rows = await queryRows(
      db,
      `SELECT id, date FROM transactions WHERE id IN (${placeholders})`,
      idBatch
    )
    for (const r of rows) oldYearById.set(r.id as string, (r.date as string).slice(0, 4))
  }

  // Junction rows são sempre apagadas e reinseridas para toda transação tocada (upsert ou
  // delete) — mais simples que diffar associação de tag/budget separadamente, e ainda barato:
  // o fan-out por transação é pequeno (medido no cofre real: ~0,15 tag/transação).
  for (const idBatch of chunk(touchedIds, idBatchSize)) {
    const placeholders = idBatch.map(() => '?').join(',')
    await sqlite3.run(
      db,
      `DELETE FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
      idBatch
    )
    await sqlite3.run(
      db,
      `DELETE FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
      idBatch
    )
  }

  for (const idBatch of chunk(delta.deletedIds, idBatchSize)) {
    const placeholders = idBatch.map(() => '?').join(',')
    await sqlite3.run(db, `DELETE FROM transactions WHERE id IN (${placeholders})`, idBatch)
  }

  const transactionBatchSize = Math.max(1, Math.floor(maxBoundParams / TRANSACTION_COLUMNS))
  const junctionBatchSize = Math.max(1, Math.floor(maxBoundParams / 2))

  for (const rows of chunk(delta.upserts, transactionBatchSize)) {
    const rowPlaceholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')
    const params: SQLiteCompatibleType[] = []
    for (const tx of rows) {
      params.push(
        tx.id,
        tx.accountId,
        tx.categoryId || null,
        tx.amount,
        tx.type,
        tx.description,
        tx.date,
        tx.isPaid ? 1 : 0,
        tx.transferAccountId ?? null,
        tx.installment?.parentId ?? null,
        tx.installment?.currentIndex ?? null,
        tx.installment?.total ?? null,
        tx.installment?.purchaseDate ?? null,
        tx.recurrence?.parentId ?? null,
        tx.recurrence?.frequency ?? null,
        tx.recurrence?.endDate ?? null,
        tx.referenceMonth ?? null,
        tx.invoiceDueDate ?? null,
        tx.createdAt ?? ts,
        tx.updatedAt ?? ts
      )
    }
    await sqlite3.run(
      db,
      `INSERT INTO transactions
         (id, account_id, category_id, amount, type, description, date, is_paid,
          transfer_account_id, installment_parent_id, installment_index, installment_total,
          installment_purchase_date,
          recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
          invoice_due_date, created_at, updated_at)
       VALUES ${rowPlaceholders}
       ON CONFLICT(id) DO UPDATE SET
         account_id=excluded.account_id, category_id=excluded.category_id,
         amount=excluded.amount, type=excluded.type, description=excluded.description,
         date=excluded.date, is_paid=excluded.is_paid,
         transfer_account_id=excluded.transfer_account_id,
         installment_parent_id=excluded.installment_parent_id,
         installment_index=excluded.installment_index,
         installment_total=excluded.installment_total,
         installment_purchase_date=excluded.installment_purchase_date,
         recurrence_parent_id=excluded.recurrence_parent_id,
         recurrence_frequency=excluded.recurrence_frequency,
         recurrence_end_date=excluded.recurrence_end_date,
         reference_month=excluded.reference_month, invoice_due_date=excluded.invoice_due_date,
         updated_at=excluded.updated_at`,
      params
    )

    const tagPairs: SQLiteCompatibleType[] = []
    const budgetPairs: SQLiteCompatibleType[] = []
    for (const tx of rows) {
      for (const tagId of tx.tags) tagPairs.push(tx.id, tagId)
      for (const budgetId of tx.budgetIds ?? []) budgetPairs.push(tx.id, budgetId)
    }
    for (const pairBatch of chunk(tagPairs, junctionBatchSize * 2)) {
      const placeholders = Array(pairBatch.length / 2)
        .fill('(?,?)')
        .join(',')
      await sqlite3.run(
        db,
        `INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ${placeholders}`,
        pairBatch
      )
    }
    for (const pairBatch of chunk(budgetPairs, junctionBatchSize * 2)) {
      const placeholders = Array(pairBatch.length / 2)
        .fill('(?,?)')
        .join(',')
      await sqlite3.run(
        db,
        `INSERT INTO transaction_budgets (transaction_id, budget_id) VALUES ${placeholders}`,
        pairBatch
      )
    }
  }

  // Anos afetados: união dos anos antigos das linhas tocadas (upsert ou delete) com os anos
  // novos dos upserts — tipicamente 1, raramente 2 (uma transação mudando de ano). Nunca o
  // histórico inteiro, diferente de refreshTransactionYearHashesFromMemory (replaceAll).
  const affectedYears = new Set<string>()
  for (const id of delta.deletedIds) {
    const year = oldYearById.get(id)
    if (year) affectedYears.add(year)
  }
  for (const tx of delta.upserts) {
    affectedYears.add(tx.date.slice(0, 4))
    const oldYear = oldYearById.get(tx.id)
    if (oldYear) affectedYears.add(oldYear)
  }
  await refreshTransactionYearHashesFromDb(affectedYears)
}

async function applyMutation(rawData: unknown, rawDelta: unknown): Promise<void> {
  const d = rawData as RawDataFile
  const delta = rawDelta as RawTransactionDelta
  const ts = d.settings.fileCreatedAt || new Date().toISOString()

  await sqlite3.run(db, 'BEGIN')
  try {
    await writeSmallTables(d, ts)
    await applyTransactionDelta(delta, ts)
    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

// ─── Reading a foreign .db in memory (CS-15) ───────────────────────────────────
//
// folderSyncService needs to read a peer's device-<id>.db bytes into a DataFile-shaped object
// without ever touching the local gimbo.db. wa-sqlite has no pure in-memory VFS, so the closest
// safe approximation is: write the peer's bytes to a scratch OPFS file with its own name, open a
// *second* db pointer against it, read every table, then delete the scratch file. `db` (the
// local database) is never migrated or written to during this process — CS-30/CS-31/CS-32 Fase
// 2b does read it once (`table_hashes` only, via readTableHashes(db)) to decide which of the
// peer's partitions are actually worth reading, but that read happens inside the same enqueue()'d
// task that processes the peer, so there's no window for a concurrent write to race it (see the
// CS-28 note on readTransactionsForYears above — the same "stay inside one dequeued task"
// invariant this whole file depends on).

async function queryRows(
  dbPtr: number,
  sql: string,
  params?: SQLiteCompatibleType[]
): Promise<Record<string, unknown>[]> {
  const { rows, columns } = await sqlite3.execWithParams(dbPtr, sql, params)
  return rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })
}

// Mirrors StorageService's groupIds() — duplicated rather than imported because that module
// instantiates the main-thread Worker wrapper and can't be pulled into the worker bundle itself.
function groupJoinIds(rows: Record<string, unknown>[], valueCol: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const txId = row.transaction_id as string
    const value = row[valueCol] as string
    const list = map.get(txId)
    if (list) list.push(value)
    else map.set(txId, [value])
  }
  return map
}

// Maps one raw SQL row (snake_case columns, as queryRows() returns) plus its already-joined
// tag/budget ids into a RawTransaction. Extracted out of readDataFileFromDb (CS-30/CS-31 Fase 2)
// so applyTransactionDelta's per-year hash recompute can reuse the exact same mapping instead of
// a second, easily-drifting reimplementation — the canonical shape a hash is computed from must
// match the shape read from the peer/local db bit for bit.
function sqlRowToRawTransaction(
  r: Record<string, unknown>,
  tags: string[],
  budgetIds: string[]
): RawTransaction {
  const tx: RawTransaction = {
    id: r.id as string,
    accountId: r.account_id as string,
    categoryId: (r.category_id as string | null) ?? '',
    amount: r.amount as number,
    type: r.type as string,
    description: r.description as string,
    date: r.date as string,
    isPaid: Boolean(r.is_paid),
    tags,
    budgetIds,
  }
  if (r.updated_at !== null && r.updated_at !== undefined) tx.updatedAt = r.updated_at as string
  if (r.created_at !== null && r.created_at !== undefined) tx.createdAt = r.created_at as string
  if (r.transfer_account_id !== null && r.transfer_account_id !== undefined) {
    tx.transferAccountId = r.transfer_account_id as string
  }
  if (r.reference_month !== null && r.reference_month !== undefined) {
    tx.referenceMonth = r.reference_month as string
  }
  if (r.invoice_due_date !== null && r.invoice_due_date !== undefined) {
    tx.invoiceDueDate = r.invoice_due_date as string
  }
  if (r.installment_parent_id !== null && r.installment_parent_id !== undefined) {
    tx.installment = {
      parentId: r.installment_parent_id as string,
      currentIndex: r.installment_index as number,
      total: r.installment_total as number,
      ...(r.installment_purchase_date !== null && r.installment_purchase_date !== undefined
        ? { purchaseDate: r.installment_purchase_date as string }
        : {}),
    }
  }
  if (r.recurrence_parent_id !== null && r.recurrence_parent_id !== undefined) {
    tx.recurrence = {
      frequency: r.recurrence_frequency as string,
      parentId: r.recurrence_parent_id as string,
      ...(r.recurrence_end_date !== null && r.recurrence_end_date !== undefined
        ? { endDate: r.recurrence_end_date as string }
        : {}),
    }
  }
  return tx
}

// Mirrors StorageService's rowTo* mappers, but against an arbitrary db pointer instead of the
// message-passing `this.query()` — necessary because this runs inside the worker itself, on a
// scratch db that StorageService (main thread) never sees.
//
// CS-30/CS-31/CS-32 Fase 2b: cada tabela vira um leitor próprio, chamado incondicionalmente por
// readDataFileFromDb() (leitura completa, usada por importDb() — validação de um import não pode
// depender de hash) e condicionalmente por readDataFileFromDbSelective() (leitura seletiva do
// peer, usada só pelo sync via readForeignDataFile()) — uma partição cujo hash bate com o local
// nunca chega a rodar seu leitor.

async function readAccounts(dbPtr: number): Promise<RawAccount[]> {
  const accountRows = await queryRows(dbPtr, 'SELECT * FROM accounts ORDER BY name')
  return accountRows.map((r) => {
    const acc: RawAccount = {
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      balance: r.balance as number,
      includeInBalance: Boolean(r.include_in_balance),
    }
    if (r.credit_limit !== null && r.credit_limit !== undefined) {
      acc.creditMetadata = {
        limit: r.credit_limit as number,
        closingDay: r.credit_closing_day as number,
        dueDay: r.credit_due_day as number,
      }
    }
    if (r.loan_outstanding_balance !== null && r.loan_outstanding_balance !== undefined) {
      acc.loanMetadata = {
        outstandingBalance: r.loan_outstanding_balance as number,
        monthlyPayment: r.loan_monthly_payment as number,
        remainingInstallments: r.loan_remaining_installments as number,
        ...(r.loan_interest_rate !== null && r.loan_interest_rate !== undefined
          ? { interestRate: r.loan_interest_rate as number }
          : {}),
      }
    }
    if (r.is_reserve) acc.reserveMetadata = {}
    if (r.issuer_icon !== null && r.issuer_icon !== undefined)
      acc.issuerIcon = r.issuer_icon as string
    if (r.archived) acc.archived = true
    if (r.updated_at !== null && r.updated_at !== undefined) acc.updatedAt = r.updated_at as string
    return acc
  })
}

async function readCategories(dbPtr: number): Promise<RawCategory[]> {
  const categoryRows = await queryRows(dbPtr, 'SELECT * FROM categories ORDER BY name')
  return categoryRows.map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    name: r.name as string,
    icon: r.icon as string,
    color: r.color as string,
    type: r.type as string,
    ...(r.updated_at !== null && r.updated_at !== undefined
      ? { updatedAt: r.updated_at as string }
      : {}),
  }))
}

async function readTags(dbPtr: number): Promise<RawTag[]> {
  const tagRows = await queryRows(dbPtr, 'SELECT * FROM tags ORDER BY name')
  return tagRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    ...(r.updated_at !== null && r.updated_at !== undefined
      ? { updatedAt: r.updated_at as string }
      : {}),
  }))
}

// `years === null` lê o histórico inteiro (readDataFileFromDb, usa um único SELECT sem filtro
// pras junções — igual ao comportamento de sempre). `years` não-nulo lê só as transações daqueles
// anos (readDataFileFromDbSelective) e busca as junções batelada por id, já que não faz sentido
// puxar transaction_tags/transaction_budgets inteiras pra filtrar depois em memória.
//
// M-72/PERFORMANCE.md: o formato antigo (LEFT JOIN duplo + GROUP_CONCAT(DISTINCT) + GROUP BY
// t.id) custava ~224s num cofre real de ~25 mil transações sob wa-sqlite/WASM + VFS assíncrona do
// OPFS — o agregado em si era o gargalo, não o volume de linhas. Reescrito pra três queries
// simples unidas em JS — mesmo padrão de StorageService.getTransactions() (StorageService.ts).
//
// CS-28: sequential, NOT Promise.all — StorageService.getTransactions() roda suas três queries
// concorrentemente com segurança porque cada uma passa por `this.query()` → postMessage → a fila
// `enqueue()` do próprio worker (dispatch), que as serializa antes de qualquer uma chegar no
// wa-sqlite. Esta função já roda *dentro* de uma tarefa já retirada da fila, chamando
// `queryRows()` direto contra a instância wasm — o build async só suporta uma chamada Asyncify em
// voo por vez, e disparar três ao mesmo tempo corrompeu o estado interno do unwind, travando com
// "NotFoundError: Entry not found" → "RuntimeError: unreachable executed" na próxima chamada OPFS
// de *qualquer* operação seguinte (ex.: o import seguinte). Confirmado reproduzível.
async function readTransactionsForYears(
  dbPtr: number,
  years: string[] | null
): Promise<RawTransaction[]> {
  let txRows: Record<string, unknown>[]
  if (years === null) {
    txRows = await queryRows(
      dbPtr,
      'SELECT t.* FROM transactions t ORDER BY t.date DESC, t.created_at DESC'
    )
  } else if (years.length === 0) {
    return []
  } else {
    const conds = years.map(() => 'date LIKE ?').join(' OR ')
    txRows = await queryRows(
      dbPtr,
      `SELECT t.* FROM transactions t WHERE ${conds} ORDER BY t.date DESC, t.created_at DESC`,
      years.map((y) => `${y}%`)
    )
  }
  if (txRows.length === 0) return []

  const tagsByTx = new Map<string, string[]>()
  const budgetsByTx = new Map<string, string[]>()
  if (years === null) {
    const txTagRows = await queryRows(dbPtr, 'SELECT transaction_id, tag_id FROM transaction_tags')
    const txBudgetRows = await queryRows(
      dbPtr,
      'SELECT transaction_id, budget_id FROM transaction_budgets'
    )
    for (const [id, list] of groupJoinIds(txTagRows, 'tag_id')) tagsByTx.set(id, list)
    for (const [id, list] of groupJoinIds(txBudgetRows, 'budget_id')) budgetsByTx.set(id, list)
  } else {
    const ids = txRows.map((r) => r.id as string)
    const idBatchSize = Math.max(1, maxBoundParams)
    for (const idBatch of chunk(ids, idBatchSize)) {
      const placeholders = idBatch.map(() => '?').join(',')
      const txTagRows = await queryRows(
        dbPtr,
        `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      const txBudgetRows = await queryRows(
        dbPtr,
        `SELECT transaction_id, budget_id FROM transaction_budgets WHERE transaction_id IN (${placeholders})`,
        idBatch
      )
      for (const [id, list] of groupJoinIds(txTagRows, 'tag_id')) tagsByTx.set(id, list)
      for (const [id, list] of groupJoinIds(txBudgetRows, 'budget_id')) budgetsByTx.set(id, list)
    }
  }

  return txRows.map((r) =>
    sqlRowToRawTransaction(
      r,
      tagsByTx.get(r.id as string) ?? [],
      budgetsByTx.get(r.id as string) ?? []
    )
  )
}

async function readValuations(dbPtr: number): Promise<RawValuation[]> {
  const valuationRows = await queryRows(
    dbPtr,
    'SELECT id, account_id, date, market_value FROM valuations'
  )
  return valuationRows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    date: r.date as string,
    marketValue: r.market_value as number,
  }))
}

async function readSavedPeriods(dbPtr: number): Promise<RawSavedPeriod[]> {
  const savedPeriodRows = await queryRows(
    dbPtr,
    'SELECT id, name, start_date, end_date FROM saved_periods ORDER BY created_at'
  )
  return savedPeriodRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    start: r.start_date as string,
    end: r.end_date as string,
  }))
}

async function readBudgets(dbPtr: number): Promise<RawBudget[]> {
  const budgetRows = await queryRows(dbPtr, 'SELECT * FROM budgets ORDER BY created_at')
  return budgetRows.map((r) => {
    const period: RawBudget['period'] =
      r.period_mode === 'date'
        ? { mode: 'date', date: r.period_date as string }
        : { mode: 'range', start: r.period_start as string, end: r.period_end as string }
    const b: RawBudget = {
      id: r.id as string,
      name: r.name as string,
      emoji: r.emoji as string,
      color: r.color as string,
      kind: r.kind as string,
      target: r.target as number,
      period,
    }
    if (r.archived_at !== null && r.archived_at !== undefined)
      b.archivedAt = r.archived_at as string
    if (r.recipe_slug !== null && r.recipe_slug !== undefined)
      b.recipeSlug = r.recipe_slug as string
    if (r.recipe_slot !== null && r.recipe_slot !== undefined)
      b.recipeSlot = r.recipe_slot as number
    if (r.updated_at !== null && r.updated_at !== undefined) b.updatedAt = r.updated_at as string
    if (r.created_at !== null && r.created_at !== undefined) b.createdAt = r.created_at as string
    if (r.target_source !== null && r.target_source !== undefined)
      b.targetSource = r.target_source as string
    return b
  })
}

async function readAuditLog(dbPtr: number): Promise<RawAuditEntry[]> {
  const auditRows = await queryRows(dbPtr, 'SELECT * FROM audit_log ORDER BY timestamp ASC')
  return auditRows.map((r) => ({
    id: r.id as string,
    timestamp: r.timestamp as string,
    action: r.action as string,
    entity: r.entity as string,
    entityId: r.entity_id as string,
    summary: r.summary as string,
  }))
}

async function readDeletedIds(dbPtr: number): Promise<string[]> {
  const deletedRows = await queryRows(dbPtr, 'SELECT id FROM deleted_ids')
  return deletedRows.map((r) => r.id as string)
}

async function readUserAndSettings(
  dbPtr: number
): Promise<{ user: RawUser; settings: RawSettings } | null> {
  const userRows = await queryRows(dbPtr, "SELECT * FROM users WHERE id = 'singleton'")
  if (userRows.length === 0) return null
  const settingsRows = await queryRows(dbPtr, "SELECT * FROM settings WHERE id = 'singleton'")
  if (settingsRows.length === 0) return null
  const u = userRows[0]
  const s = settingsRows[0]
  return {
    user: {
      name: u.name as string,
      createdAt: u.created_at as string,
      updatedAt: u.updated_at as string,
    },
    settings: {
      fileCreatedAt: s.file_created_at as string,
      fileUpdatedAt: s.file_updated_at as string,
      auditLogRetentionLimit: s.audit_log_retention_limit as number | null,
      quadrantesEnabled: Boolean(s.quadrantes_enabled),
      quadrantesInferFromHistory: Boolean(s.quadrantes_infer_from_history),
    },
  }
}

// Full, unconditional read of every table — used by importDb() (validating an import can't
// depend on hash comparisons) and by the readers above when called without a hash gate.
async function readDataFileFromDb(dbPtr: number): Promise<RawDataFile | null> {
  const base = await readUserAndSettings(dbPtr)
  if (!base) return null

  const accounts = await readAccounts(dbPtr)
  const categories = await readCategories(dbPtr)
  const tags = await readTags(dbPtr)
  const transactions = await readTransactionsForYears(dbPtr, null)
  const valuations = await readValuations(dbPtr)
  const savedPeriods = await readSavedPeriods(dbPtr)
  const budgets = await readBudgets(dbPtr)
  const auditLog = await readAuditLog(dbPtr)
  const deletedIds = await readDeletedIds(dbPtr)

  return {
    ...base,
    accounts,
    categories,
    tags,
    transactions,
    valuations,
    auditLog,
    deletedIds,
    savedPeriods,
    budgets,
  }
}

type HashEntry = { hash: number; count: number }

async function readTableHashes(dbPtr: number): Promise<Map<string, HashEntry>> {
  const rows = await queryRows(
    dbPtr,
    'SELECT table_name, partition_key, hash_value, row_count FROM table_hashes'
  )
  const map = new Map<string, HashEntry>()
  for (const r of rows) {
    map.set(`${r.table_name as string}:${r.partition_key as string}`, {
      hash: r.hash_value as number,
      count: r.row_count as number,
    })
  }
  return map
}

// Ausente de qualquer lado (peer pré-v16, ou local antes de qualquer escrita) = sempre diverge —
// nunca tratado como "igual" por omissão. É o mesmo comportamento seguro de hoje, só sem a
// otimização de pular a leitura.
function hashesMatch(
  peerHashes: Map<string, HashEntry>,
  localHashes: Map<string, HashEntry>,
  key: string
): boolean {
  const peer = peerHashes.get(key)
  const local = localHashes.get(key)
  if (!peer || !local) return false
  return peer.hash === local.hash && peer.count === local.count
}

// CS-30/CS-31/CS-32 Fase 2b: só usada pelo caminho de sync (readForeignDataFile), nunca por
// importDb() — comparar hashes antes de ler é uma otimização de leitura, não uma decisão que
// afete se um import é válido. `localHashes` vem de uma leitura do `db` local, feita pelo chamador
// dentro da mesma invocação enfileirada que processa o peer (nunca um snapshot anterior — a
// mesma disciplina do CS-24/CS-29 de nunca comparar contra estado desatualizado).
// CS-36: contagem de partições puladas vs. lidas, pra a próxima rodada de dado real dizer de
// forma inequívoca se o hash-skip da Fase 2b está de fato pulando algo ou se — pré-existente,
// primeiro sync de um par de dispositivos com estado divergente, hash colidindo por engano — o
// peer inteiro está sendo relido de qualquer forma. Sem isso, `worker.readPeer`/`sync.readPeerBlob`
// continuavam altos e não havia telemetria pra distinguir as duas causas (achado ao investigar o
// CS-34: "sem ganho de velocidade" tinha mais de uma explicação candidata e só uma tinha fix).
export type SelectiveReadStats = {
  tablesSkipped: number
  tablesTotal: number
  yearsSkipped: number
  yearsTotal: number
}

async function readDataFileFromDbSelective(
  dbPtr: number,
  localHashes: Map<string, HashEntry>
): Promise<{ data: RawDataFile; stats: SelectiveReadStats } | null> {
  const base = await readUserAndSettings(dbPtr)
  if (!base) return null

  const peerHashes = await readTableHashes(dbPtr)
  let tablesSkipped = 0
  const smallTables = [
    'accounts',
    'categories',
    'tags',
    'valuations',
    'saved_periods',
    'budgets',
    'audit_log',
    'deleted_ids',
  ] as const
  const matches = (table: string) => {
    const skip = hashesMatch(peerHashes, localHashes, `${table}:`)
    if (skip) tablesSkipped++
    return skip
  }

  const accounts = matches('accounts') ? [] : await readAccounts(dbPtr)
  const categories = matches('categories') ? [] : await readCategories(dbPtr)
  const tags = matches('tags') ? [] : await readTags(dbPtr)
  const valuations = matches('valuations') ? [] : await readValuations(dbPtr)
  const savedPeriods = matches('saved_periods') ? [] : await readSavedPeriods(dbPtr)
  const budgets = matches('budgets') ? [] : await readBudgets(dbPtr)
  const auditLog = matches('audit_log') ? [] : await readAuditLog(dbPtr)
  const deletedIds = matches('deleted_ids') ? [] : await readDeletedIds(dbPtr)

  // Descobre os anos que o peer de fato tem (nunca lê um ano que só existe localmente — não há
  // nada pra buscar dele) e lê só os que divergirem do hash local.
  const yearRows = await queryRows(
    dbPtr,
    'SELECT DISTINCT substr(date, 1, 4) AS year FROM transactions'
  )
  const years = yearRows.map((r) => r.year as string)
  const divergingYears = years.filter(
    (year) => !hashesMatch(peerHashes, localHashes, `transactions:${year}`)
  )
  const transactions = await readTransactionsForYears(dbPtr, divergingYears)

  return {
    data: {
      ...base,
      accounts,
      categories,
      tags,
      transactions,
      valuations,
      auditLog,
      deletedIds,
      savedPeriods,
      budgets,
    },
    stats: {
      tablesSkipped,
      tablesTotal: smallTables.length,
      yearsSkipped: years.length - divergingYears.length,
      yearsTotal: years.length,
    },
  }
}

// CS-30/CS-31/CS-32/CS-33 — achado ao validar a Fase 2b contra dado real: `table_hashes` é uma
// tabela nova (v16) e só é mantida *incrementalmente* — `applyTransactionDelta` só recomputa o
// hash dos anos que o delta de fato tocou. Um ano de histórico que nunca sofreu uma mutação
// diffada desde que esta feature existe **nunca ganha uma linha em `table_hashes`**, então
// `hashesMatch()` o vê como ausente dos dois lados e trata como "sempre diverge" — pra sempre,
// já que nada além de uma mutação naquele ano específico o preencheria. Resultado observado:
// nenhum ganho de velocidade (o histórico inteiro continua sendo lido a cada sync), com o custo
// extra da própria comparação de hash por cima. Correção: quando `table_hashes` está vazia (a
// checagem mais barata possível — uma tabela já backfilled nunca volta a ficar vazia), calcula o
// hash do estado *atual* inteiro de uma vez, do mesmo jeito que `replaceAll()`/`writeSmallTables()`
// já fariam se tivessem rodado depois do v16 existir. Custo de leitura completa, uma vez por
// banco (local no boot; peer/scratch antes de comparar) — depois disso, a manutenção incremental
// já existente mantém tudo em dia.
async function backfillTableHashesIfNeeded(dbPtr: number): Promise<void> {
  const { rows } = await sqlite3.execWithParams(dbPtr, 'SELECT COUNT(*) FROM table_hashes')
  const count = (rows[0]?.[0] ?? 0) as number
  if (count > 0) return

  const data = await readDataFileFromDb(dbPtr)
  if (!data) return
  const ts = data.settings.fileCreatedAt || new Date().toISOString()

  const upsert = (tableName: string, partitionKey: string, hash: number, rowCount: number) =>
    sqlite3.run(
      dbPtr,
      `INSERT INTO table_hashes (table_name, partition_key, hash_value, row_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(table_name, partition_key) DO UPDATE SET hash_value = excluded.hash_value, row_count = excluded.row_count`,
      [tableName, partitionKey, hash, rowCount]
    )

  // Mesma normalização de updatedAt/createdAt que refreshSmallTableHashes/
  // refreshTransactionYearHashesFromMemory já fazem (CS-32) — sem ela, o backfill produziria um
  // hash que muda sozinho no próximo round-trip por loadDataFile(), mesmo achado daquele fix.
  await upsert(
    'accounts',
    '',
    combineHashes(
      data.accounts.map((a) => hashRow(accountRowKey({ ...a, updatedAt: a.updatedAt ?? ts })))
    ),
    data.accounts.length
  )
  await upsert(
    'categories',
    '',
    combineHashes(
      data.categories.map((c) => hashRow(categoryRowKey({ ...c, updatedAt: c.updatedAt ?? ts })))
    ),
    data.categories.length
  )
  await upsert(
    'tags',
    '',
    combineHashes(data.tags.map((t) => hashRow(tagRowKey({ ...t, updatedAt: t.updatedAt ?? ts })))),
    data.tags.length
  )
  await upsert(
    'budgets',
    '',
    combineHashes(
      data.budgets.map((b) => hashRow(budgetRowKey({ ...b, updatedAt: b.updatedAt ?? ts })))
    ),
    data.budgets.length
  )
  await upsert(
    'valuations',
    '',
    combineHashes(data.valuations.map((v) => hashRow(valuationRowKey(v)))),
    data.valuations.length
  )
  await upsert(
    'saved_periods',
    '',
    combineHashes(data.savedPeriods.map((p) => hashRow(savedPeriodRowKey(p)))),
    data.savedPeriods.length
  )
  await upsert(
    'audit_log',
    '',
    combineHashes(data.auditLog.map((e) => hashRow(auditEntryRowKey(e)))),
    data.auditLog.length
  )
  await upsert(
    'deleted_ids',
    '',
    combineHashes(data.deletedIds.map((id) => hashRow(deletedIdRowKey(id)))),
    data.deletedIds.length
  )

  const byYear = new Map<string, RawTransaction[]>()
  for (const raw of data.transactions) {
    const tx: RawTransaction = {
      ...raw,
      updatedAt: raw.updatedAt ?? ts,
      createdAt: raw.createdAt ?? ts,
    }
    const year = tx.date.slice(0, 4)
    const list = byYear.get(year)
    if (list) list.push(tx)
    else byYear.set(year, [tx])
  }
  for (const [year, txs] of byYear) {
    await upsert(
      'transactions',
      year,
      combineHashes(txs.map((t) => hashRow(transactionRowKey(t)))),
      txs.length
    )
  }
}

type ReadPeerResult =
  | { ok: true; data: RawDataFile; stats: SelectiveReadStats }
  | { ok: false; reason: 'unreadable' | 'newer-schema' }

async function readForeignDataFile(buffer: ArrayBuffer): Promise<ReadPeerResult> {
  const root = await navigator.storage.getDirectory()
  const tempName = `peer-scratch-${crypto.randomUUID()}.db`

  const cleanup = async () => {
    for (const suffix of ['', '-wal', '-journal'] as const) {
      try {
        await root.removeEntry(tempName + suffix)
      } catch {
        // Best-effort — a missing suffix file is expected most of the time.
      }
    }
  }

  try {
    const fileHandle = await root.getFileHandle(tempName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(buffer)
    await writable.close()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }

  let tempDb: number
  try {
    tempDb = await sqlite3.open_v2(tempName)
  } catch {
    await cleanup()
    return { ok: false, reason: 'unreadable' }
  }

  try {
    const { rows } = await sqlite3.execWithParams(tempDb, 'PRAGMA user_version')
    const version = (rows[0]?.[0] ?? 0) as number
    if (version > MAX_KNOWN_DB_VERSION) {
      await sqlite3.close(tempDb)
      await cleanup()
      return { ok: false, reason: 'newer-schema' }
    }

    await runMigrationsOn(tempDb)
    // O peer pode ser um upload de antes desta feature existir (ou de um dispositivo que ainda
    // não rodou o backfill do lado dele) — sem isso, `table_hashes` do peer viria vazia e toda
    // partição pareceria divergir pra sempre, mesmo quando o conteúdo é idêntico (ver o comentário
    // de `backfillTableHashesIfNeeded`).
    await backfillTableHashesIfNeeded(tempDb)
    // CS-30/CS-31/CS-32 Fase 2b: lê o hash local *agora*, dentro desta mesma task enfileirada —
    // nunca um valor obtido antes do download/parse do peer, que poderia levar segundos a
    // minutos (mesma disciplina do CS-24/CS-29: comparar sempre contra o estado atual, não um
    // snapshot anterior a uma operação potencialmente longa).
    const localHashes = await readTableHashes(db)
    const selective = await readDataFileFromDbSelective(tempDb, localHashes)
    await sqlite3.close(tempDb)
    await cleanup()
    return selective
      ? { ok: true, data: selective.data, stats: selective.stats }
      : { ok: false, reason: 'unreadable' }
  } catch {
    try {
      await sqlite3.close(tempDb)
    } catch {
      // Already closed, or never fully opened — nothing further to release.
    }
    await cleanup()
    return { ok: false, reason: 'unreadable' }
  }
}

// ─── clearAll ─────────────────────────────────────────────────────────────────

async function clearAll(): Promise<void> {
  await sqlite3.run(db, 'BEGIN')
  try {
    await sqlite3.run(db, 'DELETE FROM transaction_tags')
    await sqlite3.run(db, 'DELETE FROM transaction_budgets')
    await sqlite3.run(db, 'DELETE FROM audit_log')
    await sqlite3.run(db, 'DELETE FROM deleted_ids')
    await sqlite3.run(db, 'DELETE FROM transactions')
    await sqlite3.run(db, 'DELETE FROM valuations')
    await sqlite3.run(db, 'DELETE FROM saved_periods')
    await sqlite3.run(db, 'DELETE FROM budgets')
    await sqlite3.run(db, 'DELETE FROM categories')
    await sqlite3.run(db, 'DELETE FROM tags')
    await sqlite3.run(db, 'DELETE FROM accounts')
    await sqlite3.run(db, 'DELETE FROM settings')
    await sqlite3.run(db, 'DELETE FROM users')
    await sqlite3.run(db, 'COMMIT')
  } catch (err) {
    try {
      await sqlite3.run(db, 'ROLLBACK')
    } catch {
      // Ignore rollback errors
    }
    throw err
  }
}

/**
 * SEC-06 — resgate: lê os bytes crus de `gimbo.db` direto do OPFS.
 *
 * Existe para o cenário em que o app não inicializa: schema de uma versão futura, migration que
 * não aplica, arquivo corrompido. Antes disso, um boot quebrado deixava o cofre trancado no OPFS
 * sem nenhuma superfície para tirá-lo de lá.
 *
 * Por isso não depende de nada que o `init()` produz — nem do ponteiro `db`, nem do `sqlite3` —
 * e é despachada **fora da fila** (ver o message handler abaixo): `_queue` encadeia a partir do
 * `initPromise`, então um init rejeitado envenena a fila justamente quando o resgate é necessário.
 *
 * Ressalva: sem o SQLite disponível não dá para consolidar o WAL, então o arquivo pode não conter
 * as últimas transações se elas ainda estiverem só no `-wal`. Quando o banco está saudável faz-se
 * o checkpoint antes de ler; quando não está, os bytes crus são o melhor disponível — e muito
 * melhor do que nada.
 */
async function exportRawBytes(): Promise<ArrayBuffer> {
  if (dbReady) {
    try {
      await sqlite3.run(db, 'PRAGMA wal_checkpoint(FULL)')
    } catch {
      // Best-effort: se o checkpoint falhar, seguimos com os bytes que houver em disco.
    }
  }
  const root = await navigator.storage.getDirectory()
  return readFileBytes(root, DB_FILENAME)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'query':
      return sqlite3.execWithParams(
        db,
        args[0] as string,
        args[1] as SQLiteCompatibleType[] | undefined
      )
    case 'run':
      return sqlite3.run(db, args[0] as string, args[1] as SQLiteCompatibleType[] | undefined)
    case 'export':
      return exportDb()
    case 'import':
      return importDb(args[0] as ArrayBuffer)
    case 'replaceAll':
      return replaceAll(args[0])
    case 'applyMutation':
      return applyMutation(args[0], args[1])
    case 'clearAll':
      return clearAll()
    case 'readPeer':
      return readForeignDataFile(args[0] as ArrayBuffer)
    default:
      throw new Error(`[storage-worker] Unknown method: ${method}`)
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

const initPromise = init()

// Sequential operation queue — ensures mutations don't interleave across awaits.
// Each incoming message is appended to the tail of the chain so that dispatch
// calls execute one at a time, preserving SQLite write ordering.
let _queue: Promise<void> = initPromise.then(() => undefined)

function enqueue(fn: () => Promise<unknown>): Promise<unknown> {
  const task = _queue.then(fn)
  // Advance the queue tail; swallow errors so a failed task doesn't stall the queue.
  _queue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data
  const startedAt = import.meta.env.DEV ? performance.now() : 0

  // SEC-06: o resgate contorna a fila de propósito. `_queue` encadeia a partir do `initPromise`,
  // então um `init()` rejeitado — o exato cenário em que o resgate é chamado — faria a tarefa
  // nunca rodar. Também não toca em `sqlite3`/`db` quando o init não completou.
  if (method === 'exportRawBytes') {
    void exportRawBytes()
      .then((result) => self.postMessage({ id, result } satisfies WorkerResponse, [result]))
      .catch((err: unknown) => {
        self.postMessage({ id, error: String(err) } satisfies WorkerResponse)
      })
    return
  }

  void enqueue(() => dispatch(method, args))
    .then((result) => {
      const msg: WorkerResponse = { id, result }
      if (import.meta.env.DEV) {
        // Diferencia queries dentro de 'query'/'run' pelo início do SQL — sem isso, todo SELECT
        // vira o mesmo rótulo genérico 'worker.query' e não dá pra saber qual statement é lento.
        const sql = args[0]
        const sqlHint =
          (method === 'query' || method === 'run') && typeof sql === 'string'
            ? `:${sql.trim().slice(0, 60).replace(/\s+/g, ' ')}`
            : ''
        msg.perf = { metric: `worker.${method}${sqlHint}`, ms: performance.now() - startedAt }
      }
      if (result instanceof ArrayBuffer) {
        // Transfer ownership to avoid a costly copy across the worker boundary.
        self.postMessage(msg, [result])
      } else {
        self.postMessage(msg)
      }
    })
    .catch((err: unknown) => {
      self.postMessage({ id, error: String(err) } satisfies WorkerResponse)
    })
})
