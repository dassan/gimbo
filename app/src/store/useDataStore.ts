import { create } from 'zustand'
import type {
  DataFile,
  Account,
  Category,
  Tag,
  Transaction,
  AuditEntry,
  AuditAction,
  AuditEntity,
} from '@/types'
import {
  saveDataFile,
  readCurrentDataFile,
  getLastWrittenModified,
  isHandleLost,
  isPermissionNeeded,
  requestHandlePermission,
} from '@/lib/storage/fileSystem'
import { syncToFile } from '@/lib/storage/sync'
import { applyRetention } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import { uuid, now } from '@/lib/utils'

// ─── Debounce helper ──────────────────────────────────────────────────────────

let _sqliteTimer: ReturnType<typeof setTimeout> | null = null

function debouncedReplaceAll(data: DataFile) {
  if (_sqliteTimer) clearTimeout(_sqliteTimer)
  _sqliteTimer = setTimeout(() => {
    void storage.replaceAll(data)
  }, 300)
}

// ─── Audit summary builders ───────────────────────────────────────────────────

function buildSummary(
  action: AuditAction,
  entity: AuditEntity,
  name: string,
  extra?: string
): string {
  const entityLabel: Record<AuditEntity, string> = {
    account: 'Conta',
    category: 'Categoria',
    tag: 'Tag',
    transaction: 'Transação',
    user: 'Perfil',
  }
  const actionLabel: Record<AuditAction, string> = {
    CREATE: 'criada',
    UPDATE: 'atualizada',
    DELETE: 'removida',
  }
  const label = `${entityLabel[entity]} ${actionLabel[action]}: ${name}`
  return extra ? `${label} — ${extra}` : label
}

function makeEntry(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  summary: string
): AuditEntry {
  return { id: uuid(), timestamp: now(), action, entity, entityId, summary }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface DataStore {
  data: DataFile | null
  unsyncedCount: number
  conflictData: { local: DataFile; disk: DataFile } | null
  fileHandleLost: boolean
  permissionNeeded: boolean
  isSecondaryTab: boolean
  writeError: boolean

  loadData: (data: DataFile) => void
  clearData: () => void
  resolveConflict: (resolution: 'overwrite' | 'load-cloud') => Promise<void>

  addAccount: (account: Account) => void
  updateAccount: (account: Account) => void
  deleteAccount: (id: string) => void

  addCategory: (category: Category) => void
  updateCategory: (category: Category) => void
  deleteCategory: (id: string) => void

  addTag: (tag: Tag) => void
  updateTag: (tag: Tag) => void
  deleteTag: (id: string) => void

  addTransaction: (tx: Transaction) => void
  updateTransaction: (tx: Transaction) => void
  deleteTransaction: (id: string) => void
  deleteInstallmentGroup: (parentId: string) => void

  updateUser: (patch: Partial<DataFile['user']>) => void
  setRetentionLimit: (limit: number | null) => void

  persist: () => Promise<boolean>
}

export const useDataStore = create<DataStore>((set, get) => ({
  data: null,
  unsyncedCount: 0,
  conflictData: null,
  fileHandleLost: false,
  permissionNeeded: false,
  isSecondaryTab: false,
  writeError: false,

  loadData: (data) => set({ data, unsyncedCount: 0 }),
  clearData: () => set({ data: null, unsyncedCount: 0 }),

  resolveConflict: async (resolution) => {
    const { conflictData } = get()
    if (!conflictData) return
    if (resolution === 'overwrite') {
      const ok = await saveDataFile(conflictData.local)
      if (ok) set({ data: conflictData.local, unsyncedCount: 0, conflictData: null })
    } else {
      set({ data: conflictData.disk, unsyncedCount: 0, conflictData: null })
    }
  },

  // ── Accounts ──────────────────────────────────────────────────────────────

  addAccount: (account) =>
    set((s) =>
      mutate(s, (d) => {
        d.accounts.push(sanitizeAccount(account))
        addAudit(
          d,
          makeEntry(
            'CREATE',
            'account',
            account.id,
            buildSummary('CREATE', 'account', account.name)
          )
        )
      })
    ),

  updateAccount: (account) =>
    set((s) =>
      mutate(s, (d) => {
        const i = d.accounts.findIndex((a) => a.id === account.id)
        if (i !== -1) d.accounts[i] = sanitizeAccount(account)
        addAudit(
          d,
          makeEntry(
            'UPDATE',
            'account',
            account.id,
            buildSummary('UPDATE', 'account', account.name)
          )
        )
      })
    ),

  deleteAccount: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const name = d.accounts.find((a) => a.id === id)?.name ?? id
        d.accounts = d.accounts.filter((a) => a.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(d, makeEntry('DELETE', 'account', id, buildSummary('DELETE', 'account', name)))
      })
    ),

  // ── Categories ────────────────────────────────────────────────────────────

  addCategory: (category) =>
    set((s) =>
      mutate(s, (d) => {
        d.categories.push(category)
        addAudit(
          d,
          makeEntry(
            'CREATE',
            'category',
            category.id,
            buildSummary('CREATE', 'category', category.name)
          )
        )
      })
    ),

  updateCategory: (category) =>
    set((s) =>
      mutate(s, (d) => {
        const i = d.categories.findIndex((c) => c.id === category.id)
        if (i !== -1) d.categories[i] = category
        addAudit(
          d,
          makeEntry(
            'UPDATE',
            'category',
            category.id,
            buildSummary('UPDATE', 'category', category.name)
          )
        )
      })
    ),

  deleteCategory: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const name = d.categories.find((c) => c.id === id)?.name ?? id
        d.categories = d.categories.filter((c) => c.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(d, makeEntry('DELETE', 'category', id, buildSummary('DELETE', 'category', name)))
      })
    ),

  // ── Tags ──────────────────────────────────────────────────────────────────

  addTag: (tag) =>
    set((s) =>
      mutate(s, (d) => {
        d.tags.push(tag)
        addAudit(
          d,
          makeEntry('CREATE', 'tag', tag.id, buildSummary('CREATE', 'tag', `#${tag.name}`))
        )
      })
    ),

  updateTag: (tag) =>
    set((s) =>
      mutate(s, (d) => {
        const i = d.tags.findIndex((t) => t.id === tag.id)
        if (i !== -1) d.tags[i] = tag
        addAudit(
          d,
          makeEntry('UPDATE', 'tag', tag.id, buildSummary('UPDATE', 'tag', `#${tag.name}`))
        )
      })
    ),

  deleteTag: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const name = d.tags.find((t) => t.id === id)?.name ?? id
        d.tags = d.tags.filter((t) => t.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(d, makeEntry('DELETE', 'tag', id, buildSummary('DELETE', 'tag', `#${name}`)))
      })
    ),

  // ── Transactions ──────────────────────────────────────────────────────────

  addTransaction: (tx) =>
    set((s) =>
      mutate(s, (d) => {
        // ── CC-24/CC-25: Installment group creation ──────────────────────
        if (tx.installment && tx.installment.total > 1) {
          const N = tx.installment.total
          const parentId = tx.installment.parentId
          const accName = d.accounts.find((a) => a.id === tx.accountId)?.name ?? tx.accountId

          // Distribute amount evenly; first installment absorbs rounding remainder
          const perInstallment = Math.round((tx.amount / N) * 100) / 100
          const remainder = Math.round((tx.amount - perInstallment * N) * 100) / 100

          for (let i = 1; i <= N; i++) {
            const installmentAmount = i === 1 ? perInstallment + remainder : perInstallment
            const installmentTx: Transaction = {
              ...tx,
              id: i === 1 ? tx.id : uuid(),
              amount: installmentAmount,
              date: advanceMonths(tx.date, i - 1),
              description: (tx.description + ` (${i}/${N})`).trim(),
              isPaid: false,
              installment: { parentId, currentIndex: i, total: N },
            }
            d.transactions.push(installmentTx)
          }

          // CC-25: Single audit entry for the whole group
          const totalStr = `R$ ${tx.amount.toFixed(2).replace('.', ',')}`
          const groupSummary = `Compra parcelada em ${N}x: ${tx.description || accName} — ${totalStr} em ${accName}`
          addAudit(d, makeEntry('CREATE', 'transaction', parentId, groupSummary))
          return
        }

        // ── Standard single transaction ──────────────────────────────────
        d.transactions.push(tx)
        let summary: string
        if (tx.type === 'CREDIT_PAYMENT') {
          // Special audit log for invoice payments: "Pagamento de fatura: [credit account] ← [debit account] R$ X,XX"
          const creditAccName = d.accounts.find((a) => a.id === tx.accountId)?.name ?? tx.accountId
          const debitAccName =
            d.accounts.find((a) => a.id === tx.transferAccountId)?.name ??
            tx.transferAccountId ??
            ''
          summary = `Pagamento de fatura: ${creditAccName} ← ${debitAccName} R$ ${tx.amount.toFixed(2).replace('.', ',')}`
        } else {
          const catName = d.categories.find((c) => c.id === tx.categoryId)?.name ?? ''
          const extra = `R$ ${tx.amount.toFixed(2).replace('.', ',')}${catName ? ` — ${catName}` : ''}`
          summary = buildSummary('CREATE', 'transaction', tx.description || catName, extra)
        }
        addAudit(d, makeEntry('CREATE', 'transaction', tx.id, summary))
      })
    ),

  updateTransaction: (tx) =>
    set((s) =>
      mutate(s, (d) => {
        const i = d.transactions.findIndex((t) => t.id === tx.id)
        if (i !== -1) d.transactions[i] = tx
        const catName = d.categories.find((c) => c.id === tx.categoryId)?.name ?? ''
        addAudit(
          d,
          makeEntry(
            'UPDATE',
            'transaction',
            tx.id,
            buildSummary('UPDATE', 'transaction', tx.description || catName)
          )
        )
      })
    ),

  deleteTransaction: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const tx = d.transactions.find((t) => t.id === id)
        const name =
          tx?.description ?? d.categories.find((c) => c.id === tx?.categoryId)?.name ?? id
        d.transactions = d.transactions.filter((t) => t.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(
          d,
          makeEntry('DELETE', 'transaction', id, buildSummary('DELETE', 'transaction', name))
        )
      })
    ),

  // ── CC-27: Delete all installments sharing a parentId ─────────────────────

  deleteInstallmentGroup: (parentId) =>
    set((s) =>
      mutate(s, (d) => {
        // Find any installment in the group to extract description and count
        const sample = d.transactions.find((t) => t.installment?.parentId === parentId)
        const N = sample?.installment?.total ?? 0
        // Strip the " (X/N)" suffix from the description for the audit summary
        const rawDesc = sample?.description?.replace(/\s*\(\d+\/\d+\)$/, '') ?? ''
        const accName =
          d.accounts.find((a) => a.id === sample?.accountId)?.name ?? sample?.accountId ?? ''
        // Collect IDs before filtering for tombstone registration
        const groupIds = d.transactions
          .filter((t) => t.installment?.parentId === parentId)
          .map((t) => t.id)
        d.transactions = d.transactions.filter((t) => t.installment?.parentId !== parentId)
        d.deletedIds = [...new Set([...d.deletedIds, ...groupIds])]
        const summary = `Compra parcelada cancelada: ${rawDesc || accName} — ${N} parcelas removidas`
        addAudit(d, makeEntry('DELETE', 'transaction', parentId, summary))
      })
    ),

  // ── User / Settings ───────────────────────────────────────────────────────

  updateUser: (patch) =>
    set((s) =>
      mutate(s, (d) => {
        d.user = { ...d.user, ...patch, updatedAt: now() }
        addAudit(
          d,
          makeEntry('UPDATE', 'user', 'user', buildSummary('UPDATE', 'user', d.user.name))
        )
      })
    ),

  setRetentionLimit: (limit) =>
    set((s) => {
      if (!s.data) return {}
      const data = structuredClone(s.data)
      data.settings.auditLogRetentionLimit = limit
      // Apply new policy immediately
      data.auditLog = applyRetention(data.auditLog, limit)
      const unsyncedCount = s.unsyncedCount + 1
      debouncedReplaceAll(data)
      return { data, unsyncedCount }
    }),

  // ── Persistence ───────────────────────────────────────────────────────────

  persist: async () => {
    const { data, isSecondaryTab } = get()
    if (!data) return false
    if (isSecondaryTab) return false
    const updated = { ...data, settings: { ...data.settings, fileUpdatedAt: now() } }

    // Permission re-authorisation path: the handle was restored from IDB but its
    // permission state is 'prompt'. requestHandlePermission() must be called here
    // (inside the sync button click handler) to satisfy the user-activation
    // requirement. If granted, clear the flag and fall through to normal persist.
    // If denied, treat the same as a lost handle.
    if (isPermissionNeeded()) {
      const granted = await requestHandlePermission()
      if (granted) {
        set({ permissionNeeded: false })
        // Fall through to normal persist flow below.
      } else {
        set({ fileHandleLost: true, permissionNeeded: false })
        return false
      }
    }

    // Recovery path: the handle was previously lost (NotFoundError). Skip disk
    // read and conflict check — go straight to saveDataFile() which will open
    // showSaveFilePicker() (handle is null) so the user can re-associate the file.
    if (isHandleLost()) {
      const ok = await saveDataFile(updated)
      if (ok) set({ data: updated, unsyncedCount: 0, fileHandleLost: false })
      return ok
    }

    const diskSnapshot = await readCurrentDataFile()

    // Check if readCurrentDataFile() detected a missing file mid-flight.
    if (isHandleLost()) {
      set({ fileHandleLost: true })
      return false
    }

    const lastWritten = getLastWrittenModified()

    // Conflict detection: if the disk file was modified after our last write
    // (by another device, cloud sync, or manual edit), pause and ask the user.
    if (diskSnapshot !== null && lastWritten !== null && diskSnapshot.lastModified > lastWritten) {
      set({ conflictData: { local: updated, disk: diskSnapshot.data } })
      return false
    }

    // syncToFile: merge by UUID + write to disk (never a total replace).
    const merged = await syncToFile(updated, diskSnapshot)
    if (merged) {
      set({ data: merged, unsyncedCount: 0, fileHandleLost: false, writeError: false })
      // Persist the merged result (which may include changes from disk) back to SQLite.
      void storage.replaceAll(merged)
    } else if (isHandleLost()) {
      set({ fileHandleLost: true })
    } else {
      // Write failed for a reason other than a missing file (e.g. disk full,
      // OS-revoked permission). Keep unsyncedCount as-is so no data is lost.
      set({ writeError: true })
    }
    return merged !== null
  },
}))

// ─── Internal helpers ─────────────────────────────────────────────────────────

function addAudit(data: DataFile, entry: AuditEntry) {
  data.auditLog.push(entry)
  data.auditLog = applyRetention(data.auditLog, data.settings.auditLogRetentionLimit)
}

function mutate(state: DataStore, fn: (data: DataFile) => void): Partial<DataStore> {
  if (!state.data) return {}
  if (state.isSecondaryTab) return {}
  const data = structuredClone(state.data)
  fn(data)
  const unsyncedCount = state.unsyncedCount + 1
  debouncedReplaceAll(data)
  return { data, unsyncedCount }
}

// Advances a "YYYY-MM-DD" date string by the given number of months using local
// date arithmetic (no UTC conversions). If the target month has fewer days than
// the original day, the day is clamped to the last day of that month.
function advanceMonths(dateStr: string, months: number): string {
  if (months === 0) return dateStr
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  let newMonth = m + months
  let newYear = y
  while (newMonth > 12) {
    newMonth -= 12
    newYear += 1
  }
  const lastDay = new Date(newYear, newMonth, 0).getDate()
  const clampedDay = Math.min(d, lastDay)
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

// Strips CREDIT-only fields (creditMetadata, issuerIcon) from non-CREDIT accounts.
// CC-12: non-CREDIT accounts must never carry creditMetadata or issuerIcon in the saved object.
function sanitizeAccount(account: Account): Account {
  if (account.type === 'CREDIT') return account
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance,
    includeInBalance: account.includeInBalance,
  }
}
