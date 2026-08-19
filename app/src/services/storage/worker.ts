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
import { ERR_DB_UNREADABLE, ERR_SCHEMA_TOO_NEW } from './errors'

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
}

// ─── DataFile subset used by replaceAll ───────────────────────────────────────

type RawUser = { name: string; createdAt: string; updatedAt: string }
type RawSettings = {
  fileCreatedAt: string
  fileUpdatedAt: string
  auditLogRetentionLimit: number | null
  quadrantesEnabled: boolean
}
type RawAccount = {
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
type RawCategory = {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: string
  updatedAt?: string
}
type RawTag = { id: string; name: string; color: string; updatedAt?: string }
type RawTransaction = {
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
type RawAuditEntry = {
  id: string
  timestamp: string
  action: string
  entity: string
  entityId: string
  summary: string
}
type RawValuation = {
  id: string
  accountId: string
  date: string
  marketValue: number
}
type RawSavedPeriod = {
  id: string
  name: string
  start: string
  end: string
}
type RawBudget = {
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

const DB_FILENAME = 'gimbo.db'

// Highest PRAGMA user_version this build knows how to migrate. CS-15 (folderSyncService)
// compares a peer's raw version against this before attempting to read it — a peer ahead of
// this number was written by a newer app build and must be skipped, not partially migrated.
// Bump this alongside every new migrations/vN.sql (same trap as data/sync_gimbo.py — see
// CLAUDE.md "Armadilha recorrente").
const MAX_KNOWN_DB_VERSION = 12

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
    }
    await removeDbFiles(root, stagingName)
    await removeDbFiles(root, rollbackName)
    throw err
  }

  await removeDbFiles(root, stagingName)
  await removeDbFiles(root, rollbackName)
}

// ─── replaceAll ───────────────────────────────────────────────────────────────

async function replaceAll(raw: unknown): Promise<void> {
  const d = raw as RawDataFile
  // Use the settings timestamp as a stable fallback for entities that lack one
  const ts = d.settings.fileCreatedAt || new Date().toISOString()

  await sqlite3.run(db, 'BEGIN')
  try {
    // Clear in dependency order (junction tables and leaves first)
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

    // user — `email` column kept physically (no DDL change) but never populated anymore, M-69
    await sqlite3.run(
      db,
      "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('singleton', ?, '', ?, ?)",
      [d.user.name, d.user.createdAt, d.user.updatedAt]
    )

    // settings
    await sqlite3.run(
      db,
      "INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit, quadrantes_enabled) VALUES ('singleton', ?, ?, ?, ?)",
      [
        d.settings.fileCreatedAt,
        d.settings.fileUpdatedAt,
        d.settings.auditLogRetentionLimit,
        d.settings.quadrantesEnabled ? 1 : 0,
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
            archived_at, recipe_slug, recipe_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ]
      )
    }

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
// local database) is never opened, migrated, or written to during this process.

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

// Mirrors StorageService's rowTo* mappers, but against an arbitrary db pointer instead of the
// message-passing `this.query()` — necessary because this runs inside the worker itself, on a
// scratch db that StorageService (main thread) never sees.
async function readDataFileFromDb(dbPtr: number): Promise<RawDataFile | null> {
  const userRows = await queryRows(dbPtr, "SELECT * FROM users WHERE id = 'singleton'")
  if (userRows.length === 0) return null
  const settingsRows = await queryRows(dbPtr, "SELECT * FROM settings WHERE id = 'singleton'")
  if (settingsRows.length === 0) return null
  const u = userRows[0]
  const s = settingsRows[0]

  const accountRows = await queryRows(dbPtr, 'SELECT * FROM accounts ORDER BY name')
  const accounts: RawAccount[] = accountRows.map((r) => {
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

  const categoryRows = await queryRows(dbPtr, 'SELECT * FROM categories ORDER BY name')
  const categories: RawCategory[] = categoryRows.map((r) => ({
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

  const tagRows = await queryRows(dbPtr, 'SELECT * FROM tags ORDER BY name')
  const tags: RawTag[] = tagRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
    ...(r.updated_at !== null && r.updated_at !== undefined
      ? { updatedAt: r.updated_at as string }
      : {}),
  }))

  const txRows = await queryRows(
    dbPtr,
    `SELECT t.*, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids,
            GROUP_CONCAT(DISTINCT tb.budget_id) AS budget_ids
     FROM transactions t
     LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
     LEFT JOIN transaction_budgets tb ON t.id = tb.transaction_id
     GROUP BY t.id
     ORDER BY t.date DESC, t.created_at DESC`
  )
  const transactions: RawTransaction[] = txRows.map((r) => {
    const tagIds = r.tag_ids as string | null
    const budgetIds = r.budget_ids as string | null
    const tx: RawTransaction = {
      id: r.id as string,
      accountId: r.account_id as string,
      categoryId: (r.category_id as string | null) ?? '',
      amount: r.amount as number,
      type: r.type as string,
      description: r.description as string,
      date: r.date as string,
      isPaid: Boolean(r.is_paid),
      tags: tagIds ? tagIds.split(',') : [],
      budgetIds: budgetIds ? budgetIds.split(',') : [],
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
  })

  const valuationRows = await queryRows(
    dbPtr,
    'SELECT id, account_id, date, market_value FROM valuations'
  )
  const valuations: RawValuation[] = valuationRows.map((r) => ({
    id: r.id as string,
    accountId: r.account_id as string,
    date: r.date as string,
    marketValue: r.market_value as number,
  }))

  const savedPeriodRows = await queryRows(
    dbPtr,
    'SELECT id, name, start_date, end_date FROM saved_periods ORDER BY created_at'
  )
  const savedPeriods: RawSavedPeriod[] = savedPeriodRows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    start: r.start_date as string,
    end: r.end_date as string,
  }))

  const budgetRows = await queryRows(dbPtr, 'SELECT * FROM budgets ORDER BY created_at')
  const budgets: RawBudget[] = budgetRows.map((r) => {
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
    return b
  })

  const auditRows = await queryRows(dbPtr, 'SELECT * FROM audit_log ORDER BY timestamp ASC')
  const auditLog: RawAuditEntry[] = auditRows.map((r) => ({
    id: r.id as string,
    timestamp: r.timestamp as string,
    action: r.action as string,
    entity: r.entity as string,
    entityId: r.entity_id as string,
    summary: r.summary as string,
  }))

  const deletedRows = await queryRows(dbPtr, 'SELECT id FROM deleted_ids')
  const deletedIds = deletedRows.map((r) => r.id as string)

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
    },
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

type ReadPeerResult =
  | { ok: true; data: RawDataFile }
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
    const data = await readDataFileFromDb(tempDb)
    await sqlite3.close(tempDb)
    await cleanup()
    return data ? { ok: true, data } : { ok: false, reason: 'unreadable' }
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
