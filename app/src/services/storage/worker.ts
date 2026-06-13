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

type RawUser = { name: string; email: string; createdAt: string; updatedAt: string }
type RawSettings = {
  fileCreatedAt: string
  fileUpdatedAt: string
  auditLogRetentionLimit: number | null
}
type RawAccount = {
  id: string
  name: string
  type: string
  balance: number
  includeInBalance: boolean
  creditMetadata?: { limit: number; closingDay: number; dueDay: number }
  issuerIcon?: string
  archived?: boolean
}
type RawCategory = {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: string
}
type RawTag = { id: string; name: string; color: string }
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
  installment?: { parentId: string; currentIndex: number; total: number }
  recurrence?: { frequency: string; parentId: string; endDate?: string }
  transferAccountId?: string
  referenceMonth?: string
  invoiceDueDate?: string
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
}

// ─── SQLite state ─────────────────────────────────────────────────────────────

// `SQLiteAPI` is declared globally by wa-sqlite's ambient types.
let sqlite3: SQLiteAPI
let db: number // opaque database pointer returned by open_v2

const DB_FILENAME = 'gimbo.db'

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
  await runMigrations()
}

async function runMigrations(): Promise<void> {
  // WAL mode gives better read concurrency and enables clean export via checkpoint.
  // This is idempotent — safe to call on every open.
  await sqlite3.run(db, 'PRAGMA journal_mode=WAL')

  const { rows } = await sqlite3.execWithParams(db, 'PRAGMA user_version')
  const version = (rows[0]?.[0] ?? 0) as number

  if (version < 1) {
    await sqlite3.run(db, v1Schema)
  }
  if (version < 2) {
    await sqlite3.run(db, v2Schema)
  }
  if (version < 3) {
    await sqlite3.run(db, v3Schema)
  }
  if (version < 4) {
    await sqlite3.run(db, v4Schema)
  }
  if (version < 5) {
    await sqlite3.run(db, v5Schema)
  }
  if (version < 6) {
    await sqlite3.run(db, v6Schema)
  }
  if (version < 7) {
    await sqlite3.run(db, v7Schema)
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

async function importDb(data: ArrayBuffer): Promise<void> {
  // Close the database to release Web Locks held by the VFS.
  await sqlite3.close(db)

  // Write the imported bytes to OPFS, replacing the current database.
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(DB_FILENAME, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(data)
  await writable.close()

  // Remove stale WAL / journal files to avoid corruption on next open.
  for (const suffix of ['-wal', '-journal'] as const) {
    try {
      await root.removeEntry(DB_FILENAME + suffix)
    } catch {
      // File not present — nothing to do.
    }
  }

  // Reopen and apply any pending migrations (e.g. import from an older version).
  db = await sqlite3.open_v2(DB_FILENAME)
  await runMigrations()
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
    await sqlite3.run(db, 'DELETE FROM audit_log')
    await sqlite3.run(db, 'DELETE FROM deleted_ids')
    await sqlite3.run(db, 'DELETE FROM transactions')
    await sqlite3.run(db, 'DELETE FROM valuations')
    await sqlite3.run(db, 'DELETE FROM saved_periods')
    await sqlite3.run(db, 'DELETE FROM categories')
    await sqlite3.run(db, 'DELETE FROM tags')
    await sqlite3.run(db, 'DELETE FROM accounts')
    await sqlite3.run(db, 'DELETE FROM settings')
    await sqlite3.run(db, 'DELETE FROM users')

    // user
    await sqlite3.run(
      db,
      "INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('singleton', ?, ?, ?, ?)",
      [d.user.name, d.user.email, d.user.createdAt, d.user.updatedAt]
    )

    // settings
    await sqlite3.run(
      db,
      "INSERT INTO settings (id, file_created_at, file_updated_at, audit_log_retention_limit) VALUES ('singleton', ?, ?, ?)",
      [d.settings.fileCreatedAt, d.settings.fileUpdatedAt, d.settings.auditLogRetentionLimit]
    )

    // accounts
    for (const acc of d.accounts) {
      await sqlite3.run(
        db,
        `INSERT INTO accounts
           (id, name, type, balance, include_in_balance,
            credit_limit, credit_closing_day, credit_due_day, issuer_icon, archived,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          acc.id,
          acc.name,
          acc.type,
          acc.balance,
          acc.includeInBalance ? 1 : 0,
          acc.creditMetadata?.limit ?? null,
          acc.creditMetadata?.closingDay ?? null,
          acc.creditMetadata?.dueDay ?? null,
          acc.issuerIcon ?? null,
          acc.archived ? 1 : 0,
          ts,
          ts,
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
        [cat.id, cat.parentId ?? null, cat.name, cat.icon, cat.color, cat.type, ts, ts]
      )
    }

    // tags
    for (const tag of d.tags) {
      await sqlite3.run(
        db,
        'INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [tag.id, tag.name, tag.color, ts, ts]
      )
    }

    // transactions + junction rows
    for (const tx of d.transactions) {
      await sqlite3.run(
        db,
        `INSERT INTO transactions
           (id, account_id, category_id, amount, type, description, date, is_paid,
            transfer_account_id, installment_parent_id, installment_index, installment_total,
            recurrence_parent_id, recurrence_frequency, recurrence_end_date, reference_month,
            invoice_due_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          tx.recurrence?.parentId ?? null,
          tx.recurrence?.frequency ?? null,
          tx.recurrence?.endDate ?? null,
          tx.referenceMonth ?? null,
          tx.invoiceDueDate ?? null,
          ts,
          ts,
        ]
      )
      for (const tagId of tx.tags) {
        await sqlite3.run(
          db,
          'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)',
          [tx.id, tagId]
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

// ─── clearAll ─────────────────────────────────────────────────────────────────

async function clearAll(): Promise<void> {
  await sqlite3.run(db, 'BEGIN')
  try {
    await sqlite3.run(db, 'DELETE FROM transaction_tags')
    await sqlite3.run(db, 'DELETE FROM audit_log')
    await sqlite3.run(db, 'DELETE FROM deleted_ids')
    await sqlite3.run(db, 'DELETE FROM transactions')
    await sqlite3.run(db, 'DELETE FROM valuations')
    await sqlite3.run(db, 'DELETE FROM saved_periods')
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
