/// <reference lib="webworker" />
// This file runs as a Dedicated Web Worker. TypeScript sees both DOM and
// WebWorker libs; `declare const self` below resolves the `self` ambiguity.
declare const self: DedicatedWorkerGlobalScope

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
import * as SQLite from 'wa-sqlite'
// @ts-expect-error – JavaScript VFS without ambient declarations
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js'
import v1Schema from './migrations/v1.sql?raw'

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

// ─── SQLite state ─────────────────────────────────────────────────────────────

// `SQLiteAPI` is declared globally by wa-sqlite's ambient types.
let sqlite3: SQLiteAPI
let db: number // opaque database pointer returned by open_v2

const CURRENT_SCHEMA_VERSION = 1
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

  if (version < CURRENT_SCHEMA_VERSION) {
    await sqlite3.run(db, v1Schema)
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

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'query':
      return sqlite3.execWithParams(
        db,
        args[0] as string,
        args[1] as SQLiteCompatibleType[] | undefined,
      )
    case 'run':
      return sqlite3.run(db, args[0] as string, args[1] as SQLiteCompatibleType[] | undefined)
    case 'export':
      return exportDb()
    case 'import':
      return importDb(args[0] as ArrayBuffer)
    default:
      throw new Error(`[storage-worker] Unknown method: ${method}`)
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

const initPromise = init()

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data

  void initPromise
    .then(() => dispatch(method, args))
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
