// F-28 Nível 2 — CS-05 (TASK-CS-03): pure merge engine for multi-device sync.
//
// `mergeForSync` is the one function every transport (Fase 1 pasta compartilhada, Fase 2 Google
// Drive, Fase 3 Dropbox) funnels through. It never touches storage or the network — callers are
// responsible for loading `local`/`remote` into memory and persisting the result.
//
// Idempotency is a hard requirement, not a nice-to-have: mergeForSync(mergeForSync(a, b), b) must
// equal mergeForSync(a, b). That property is what makes it safe to skip an unreadable/partially
// written peer file and simply retry on the next boot (S-20).

import type { AuditEntry, DataFile } from '@/types'
import { applyRetention } from '@/lib/storage/schema'

type WithId = { id: string }
type WithIdAndUpdatedAt = WithId & { updatedAt?: string }

/** Union by id; on collision the entry with the greater `updatedAt` wins (last-write-wins). */
function unionByIdLWW<T extends WithIdAndUpdatedAt>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of local) byId.set(item.id, item)
  for (const item of remote) {
    const existing = byId.get(item.id)
    if (!existing || (item.updatedAt ?? '') > (existing.updatedAt ?? '')) {
      byId.set(item.id, item)
    }
  }
  return Array.from(byId.values())
}

/** Union by id; on collision `local` always wins (no `updatedAt` to arbitrate). */
function unionByIdLocalWins<T extends WithId>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) byId.set(item.id, item) // local overwrites unconditionally
  return Array.from(byId.values())
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b
}

export function mergeForSync(local: DataFile, remote: DataFile): DataFile {
  // Deletion is never reverted — a tombstone from either side removes the entity everywhere.
  const deletedIds = [...new Set([...local.deletedIds, ...remote.deletedIds])]
  const deleted = new Set(deletedIds)
  const notDeleted = <T extends WithId>(items: T[]) => items.filter((item) => !deleted.has(item.id))

  const accounts = notDeleted(unionByIdLWW(local.accounts, remote.accounts))
  const categories = notDeleted(unionByIdLWW(local.categories, remote.categories))
  const tags = notDeleted(unionByIdLWW(local.tags, remote.tags))
  const transactions = notDeleted(unionByIdLWW(local.transactions, remote.transactions))

  const valuations = notDeleted(unionByIdLocalWins(local.valuations, remote.valuations))
  const savedPeriods = notDeleted(unionByIdLocalWins(local.savedPeriods, remote.savedPeriods))
  const budgets = notDeleted(unionByIdLWW(local.budgets, remote.budgets))

  const auditById = new Map<string, AuditEntry>()
  for (const entry of local.auditLog) auditById.set(entry.id, entry)
  for (const entry of remote.auditLog) {
    if (!auditById.has(entry.id)) auditById.set(entry.id, entry)
  }
  const auditLog = applyRetention(
    Array.from(auditById.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    local.settings.auditLogRetentionLimit
  )

  return {
    // The active device's schema always wins — the caller (folderSyncService/syncService)
    // guarantees remote.schemaVersion <= local.schemaVersion before calling mergeForSync,
    // skipping newer-schema peers instead (S-20).
    schemaVersion: local.schemaVersion,
    user: local.user,
    settings: {
      ...local.settings,
      fileUpdatedAt: maxIso(local.settings.fileUpdatedAt, remote.settings.fileUpdatedAt),
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
