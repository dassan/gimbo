import { create } from 'zustand'
import type {
  DataFile,
  Account,
  Category,
  Tag,
  Transaction,
  Valuation,
  AuditEntry,
  AuditAction,
  AuditEntity,
  RecurrenceFrequency,
} from '@/types'
import { applyRetention } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import { loadBackupDirHandle, ensureBackupDirPermission, writeBackupToDir } from '@/lib/backupDir'
import { uuid, now } from '@/lib/utils'
import { isDemoMode } from '@/lib/demo'
import { trackAction } from '@/lib/telemetry'

// ─── Debounce helper ──────────────────────────────────────────────────────────

let _sqliteTimer: ReturnType<typeof setTimeout> | null = null

async function _triggerLocalBackup() {
  try {
    const handle = await loadBackupDirHandle()
    if (!handle) return
    const granted = await ensureBackupDirPermission(handle)
    if (!granted) return
    const blob = await storage.exportBlob()
    await writeBackupToDir(handle, blob)
    localStorage.setItem('gimbo_backup_last_saved', new Date().toISOString())
  } catch {
    // backup failure must never interrupt the main flow
  }
}

function debouncedReplaceAll(data: DataFile) {
  if (isDemoMode()) return
  if (_sqliteTimer) clearTimeout(_sqliteTimer)
  _sqliteTimer = setTimeout(() => {
    void storage.replaceAll(data).then(() => void _triggerLocalBackup())
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

  loadData: (data: DataFile) => void
  clearData: () => void

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
  // M-35: delete a recurring occurrence and all later ones in the same series
  deleteRecurrenceFrom: (parentId: string, fromDate: string) => void

  addValuation: (valuation: Valuation) => void
  updateValuation: (valuation: Valuation) => void
  deleteValuation: (id: string) => void

  updateUser: (patch: Partial<DataFile['user']>) => void
  setRetentionLimit: (limit: number | null) => void
}

export const useDataStore = create<DataStore>((set) => ({
  data: null,

  loadData: (data) => set({ data }),
  clearData: () => set({ data: null }),

  // ── Accounts ──────────────────────────────────────────────────────────────

  addAccount: (account) =>
    set((s) =>
      mutate(
        s,
        (d) => {
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
        },
        'account_created'
      )
    ),

  updateAccount: (account) =>
    set((s) =>
      mutate(
        s,
        (d) => {
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
        },
        'account_updated'
      )
    ),

  deleteAccount: (id) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const name = d.accounts.find((a) => a.id === id)?.name ?? id
          d.accounts = d.accounts.filter((a) => a.id !== id)
          d.deletedIds = [...new Set([...d.deletedIds, id])]
          addAudit(d, makeEntry('DELETE', 'account', id, buildSummary('DELETE', 'account', name)))
        },
        'account_deleted'
      )
    ),

  // ── Categories ────────────────────────────────────────────────────────────

  addCategory: (category) =>
    set((s) =>
      mutate(
        s,
        (d) => {
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
        },
        'category_created'
      )
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
      mutate(
        s,
        (d) => {
          d.tags.push(tag)
          addAudit(
            d,
            makeEntry('CREATE', 'tag', tag.id, buildSummary('CREATE', 'tag', `#${tag.name}`))
          )
        },
        'tag_created'
      )
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
      mutate(
        s,
        (d) => {
          // ── CC-24/CC-25: Installment group creation ──────────────────────
          if (tx.installment && tx.installment.total > 1) {
            const N = tx.installment.total
            const parentId = tx.installment.parentId
            const accName = d.accounts.find((a) => a.id === tx.accountId)?.name ?? tx.accountId

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

            const totalStr = `R$ ${tx.amount.toFixed(2).replace('.', ',')}`
            const groupSummary = `Compra parcelada em ${N}x: ${tx.description || accName} — ${totalStr} em ${accName}`
            addAudit(d, makeEntry('CREATE', 'transaction', parentId, groupSummary))
            return
          }

          // ── M-35: Recurring series creation (eager generation) ────────────
          if (tx.recurrence) {
            const { frequency, endDate } = tx.recurrence
            const parentId = tx.id
            const startDate = tx.date.slice(0, 10)
            // No end date → generate up to a 12-month horizon from the first occurrence.
            const horizonEnd = (endDate ?? advanceMonths(startDate, 12)).slice(0, 10)
            const MAX_OCCURRENCES = 600 // safety cap (≈11 years of weekly)

            for (let i = 0; i < MAX_OCCURRENCES; i++) {
              const occDate = advanceByFrequency(startDate, frequency, i)
              if (occDate > horizonEnd) break
              const occurrence: Transaction = {
                ...tx,
                id: i === 0 ? parentId : uuid(),
                date: occDate,
                // Only the first occurrence keeps the form's paid status; future ones are unpaid.
                isPaid: i === 0 ? tx.isPaid : false,
                recurrence: { frequency, parentId, ...(endDate ? { endDate } : {}) },
              }
              d.transactions.push(occurrence)
            }

            const freqLabel = { weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal' }[
              frequency
            ]
            const catName = d.categories.find((c) => c.id === tx.categoryId)?.name ?? ''
            const amountStr = `R$ ${tx.amount.toFixed(2).replace('.', ',')}`
            const summary = `Lançamento recorrente ${freqLabel}: ${tx.description || catName} — ${amountStr}`
            addAudit(d, makeEntry('CREATE', 'transaction', parentId, summary))
            return
          }

          // ── Standard single transaction ──────────────────────────────────
          d.transactions.push(tx)
          let summary: string
          if (tx.type === 'CREDIT_PAYMENT') {
            const creditAccName =
              d.accounts.find((a) => a.id === tx.accountId)?.name ?? tx.accountId
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
        },
        'transaction_created'
      )
    ),

  updateTransaction: (tx) =>
    set((s) =>
      mutate(
        s,
        (d) => {
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
        },
        'transaction_updated'
      )
    ),

  deleteTransaction: (id) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const tx = d.transactions.find((t) => t.id === id)
          const name =
            tx?.description ?? d.categories.find((c) => c.id === tx?.categoryId)?.name ?? id
          d.transactions = d.transactions.filter((t) => t.id !== id)
          d.deletedIds = [...new Set([...d.deletedIds, id])]
          addAudit(
            d,
            makeEntry('DELETE', 'transaction', id, buildSummary('DELETE', 'transaction', name))
          )
        },
        'transaction_deleted'
      )
    ),

  // ── CC-27: Delete all installments sharing a parentId ─────────────────────

  deleteInstallmentGroup: (parentId) =>
    set((s) =>
      mutate(s, (d) => {
        const sample = d.transactions.find((t) => t.installment?.parentId === parentId)
        const N = sample?.installment?.total ?? 0
        const rawDesc = sample?.description?.replace(/\s*\(\d+\/\d+\)$/, '') ?? ''
        const accName =
          d.accounts.find((a) => a.id === sample?.accountId)?.name ?? sample?.accountId ?? ''
        const groupIds = d.transactions
          .filter((t) => t.installment?.parentId === parentId)
          .map((t) => t.id)
        d.transactions = d.transactions.filter((t) => t.installment?.parentId !== parentId)
        d.deletedIds = [...new Set([...d.deletedIds, ...groupIds])]
        const summary = `Compra parcelada cancelada: ${rawDesc || accName} — ${N} parcelas removidas`
        addAudit(d, makeEntry('DELETE', 'transaction', parentId, summary))
      })
    ),

  // ── M-35: Delete a recurring occurrence and all later ones in the series ───
  deleteRecurrenceFrom: (parentId, fromDate) =>
    set((s) =>
      mutate(s, (d) => {
        const from = fromDate.slice(0, 10)
        const inScope = (t: Transaction) =>
          t.recurrence?.parentId === parentId && t.date.slice(0, 10) >= from
        const sample = d.transactions.find((t) => t.recurrence?.parentId === parentId)
        const rawDesc = sample?.description ?? ''
        const removedIds = d.transactions.filter(inScope).map((t) => t.id)
        d.transactions = d.transactions.filter((t) => !inScope(t))
        d.deletedIds = [...new Set([...d.deletedIds, ...removedIds])]
        const summary = `Série recorrente: ${removedIds.length} ocorrência(s) removida(s) a partir de ${from}${
          rawDesc ? ` — ${rawDesc}` : ''
        }`
        addAudit(d, makeEntry('DELETE', 'transaction', parentId, summary))
      })
    ),

  // ── Valuations ────────────────────────────────────────────────────────────

  addValuation: (valuation) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          d.valuations.push(valuation)
          const accName =
            d.accounts.find((a) => a.id === valuation.accountId)?.name ?? valuation.accountId
          const valueStr = `R$ ${valuation.marketValue.toFixed(2).replace('.', ',')}`
          addAudit(
            d,
            makeEntry(
              'CREATE',
              'account',
              valuation.accountId,
              `Valuation criado: ${accName} — ${valueStr} em ${valuation.date}`
            )
          )
        },
        'valuation_created'
      )
    ),

  updateValuation: (valuation) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const i = d.valuations.findIndex((v) => v.id === valuation.id)
          if (i !== -1) d.valuations[i] = valuation
          const accName =
            d.accounts.find((a) => a.id === valuation.accountId)?.name ?? valuation.accountId
          const valueStr = `R$ ${valuation.marketValue.toFixed(2).replace('.', ',')}`
          addAudit(
            d,
            makeEntry(
              'UPDATE',
              'account',
              valuation.accountId,
              `Valuation atualizado: ${accName} — ${valueStr} em ${valuation.date}`
            )
          )
        },
        'valuation_updated'
      )
    ),

  deleteValuation: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const v = d.valuations.find((v) => v.id === id)
        const accName = v ? (d.accounts.find((a) => a.id === v.accountId)?.name ?? v.accountId) : id
        d.valuations = d.valuations.filter((v) => v.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(
          d,
          makeEntry(
            'DELETE',
            'account',
            v?.accountId ?? id,
            `Valuation removido: ${accName} em ${v?.date ?? ''}`
          )
        )
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
      data.auditLog = applyRetention(data.auditLog, limit)
      debouncedReplaceAll(data)
      return { data }
    }),
}))

// ─── Internal helpers ─────────────────────────────────────────────────────────

function addAudit(data: DataFile, entry: AuditEntry) {
  data.auditLog.push(entry)
  data.auditLog = applyRetention(data.auditLog, data.settings.auditLogRetentionLimit)
}

function mutate(
  state: DataStore,
  fn: (data: DataFile) => void,
  actionName?: string
): Partial<DataStore> {
  if (!state.data) return {}
  const data = structuredClone(state.data)
  fn(data)
  debouncedReplaceAll(data)
  if (actionName) trackAction(actionName)
  return { data }
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

// Advances a "YYYY-MM-DD" date string by the given number of days (local arithmetic).
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// M-35: advances a date by `n` recurrence periods according to the frequency.
function advanceByFrequency(dateStr: string, frequency: RecurrenceFrequency, n: number): string {
  if (n === 0) return dateStr.slice(0, 10)
  if (frequency === 'weekly') return addDays(dateStr, 7 * n)
  if (frequency === 'biweekly') return addDays(dateStr, 14 * n)
  return advanceMonths(dateStr.slice(0, 10), n) // monthly
}

// Strips CREDIT-only fields (creditMetadata) from non-CREDIT accounts.
// CC-12: non-CREDIT accounts must never carry creditMetadata in the saved object.
// M-34: issuerIcon (institution branding) is allowed on any account type and is preserved.
function sanitizeAccount(account: Account): Account {
  if (account.type === 'CREDIT') return account
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance,
    includeInBalance: account.includeInBalance,
    ...(account.issuerIcon ? { issuerIcon: account.issuerIcon } : {}),
  }
}
