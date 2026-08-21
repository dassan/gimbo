import { create } from 'zustand'
import type {
  DataFile,
  Account,
  Category,
  Tag,
  Transaction,
  Valuation,
  SavedPeriod,
  Budget,
  AuditEntry,
  AuditAction,
  AuditEntity,
} from '@/types'
import { applyRetention } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import { loadBackupDirHandle, ensureBackupDirPermission, writeBackupToDir } from '@/lib/backupDir'
import { getDeviceId } from '@/lib/cloudSync/deviceId'
import { createFolderProvider } from '@/lib/cloudSync/folderProvider'
import { syncFromPeers } from '@/lib/cloudSync/folderSyncService'
import { isMultiDeviceEnabled } from '@/lib/cloudSync/multiDeviceMode'
import { isGoogleConnected } from '@/lib/cloudSync/googleAuth'
import { pullAndMerge, pushIfNeeded } from '@/lib/cloudSync/syncService'
import {
  uuid,
  now,
  todayStr,
  advanceMonths,
  advanceByFrequency,
  RESERVE_ELIGIBLE_TYPES,
} from '@/lib/utils'
import { isDemoMode } from '@/lib/demo'
import { trackAction } from '@/lib/telemetry'
import { measure } from '@/lib/perfMonitor'
import { applyQuadrantesRecipe, findQuadranteForDate, QUADRANTE_SLUG } from '@/lib/budgetRecipes'

// ─── Debounce helper ──────────────────────────────────────────────────────────

let _sqliteTimer: ReturnType<typeof setTimeout> | null = null

// CS-07: Google Drive (Fase 2) takes precedence over the Fase 1 shared-folder mode, which takes
// precedence over the Nível 1 legacy single-file backup — only one transport pushes per mutation.
// This mirrors the "um transporte ativo por vez" rule already planned for CS-12 (Fase 3);
// applying it here now avoids two transports racing to write/merge the same mutation.
async function _triggerLocalBackup(data: DataFile) {
  try {
    if (isGoogleConnected()) {
      const synced = await pushIfNeeded(data)
      localStorage.setItem('gimbo_backup_last_saved', new Date().toISOString())
      // B-23: this runs on every mutation (debounced), not just the manual "Sincronizar agora"
      // button — lastSyncedAt must reflect it, or the Settings badge shows a stale timestamp
      // while a real sync just happened in the background. Only stamped when pushIfNeeded
      // actually confirmed Drive is in sync — it swallows its own network/API failures, so a
      // silent failure must not be reported as a successful sync.
      if (synced) useDataStore.setState({ lastSyncedAt: now() })
      return
    }

    if (isMultiDeviceEnabled()) {
      const deviceId = await getDeviceId()
      const blob = await storage.exportBlob()
      await createFolderProvider(deviceId).upload(blob)
      localStorage.setItem('gimbo_backup_last_saved', new Date().toISOString())
      useDataStore.setState({ lastSyncedAt: now() }) // B-23: same reasoning, shared-folder mode
      return
    }

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
    void storage.replaceAll(data).then(() => void _triggerLocalBackup(data))
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
    user: 'Cofre',
    savedPeriod: 'Período salvo',
    budget: 'Caixinha',
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

// BX-08: associação automática por data — só na criação (nunca como reconciliação de fundo).
// Só EXPENSE qualifica (§5.6): TRANSFER/CREDIT_PAYMENT ficam de fora para não duplicar gasto.
function withAutoQuadranteLink(tx: Transaction, budgets: Budget[]): Transaction {
  if (tx.type !== 'EXPENSE') return tx
  const match = findQuadranteForDate(budgets, tx.date)
  if (!match || tx.budgetIds?.includes(match.id)) return tx
  return { ...tx, budgetIds: [...(tx.budgetIds ?? []), match.id] }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface DataStore {
  data: DataFile | null

  // CS-15/CS-16: multi-device sync status. Mirrors the naming the Fase 2 (Google Drive)
  // syncService will reuse, so the sync badge in the UI doesn't need a retrofit later.
  syncStatus: 'idle' | 'syncing' | 'error' | 'offline'
  lastSyncedAt: string | null

  loadData: (data: DataFile) => void
  clearData: () => void
  // CS-15: reads every peer device-*.db newer than the last recorded merge, folds them into
  // the current data via mergeForSync, and persists/republishes if anything changed. No-op when
  // multi-device mode is off. Never throws — failures land in syncStatus: 'error'/'offline'.
  runPeerSync: () => Promise<void>

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
  // B-22: tops every open-ended recurring series back up to the rolling horizon —
  // call once per app load so a series never silently stops generating occurrences
  refreshRecurrenceHorizons: () => void

  addValuation: (valuation: Valuation) => void
  updateValuation: (valuation: Valuation) => void
  deleteValuation: (id: string) => void

  // M-45: named custom date ranges saved from the Reports period picker
  addSavedPeriod: (period: SavedPeriod) => void
  deleteSavedPeriod: (id: string) => void

  // F-30/BX-04: caixinhas
  addBudget: (budget: Budget) => void
  updateBudget: (budget: Budget) => void
  deleteBudget: (id: string) => void
  // §5.7: manual archiving, user-triggered only — the period ending never archives on its own
  archiveBudget: (id: string) => void
  // §5.6/P-1/P-2: Transaction.budgetIds N:N link — same primitive whether the caller is a
  // manual "Associar lançamento" action or the Quadrantes recipe's automatic sweep (BX-08)
  linkTransactionToBudget: (budgetId: string, transactionId: string) => void
  unlinkTransactionFromBudget: (budgetId: string, transactionId: string) => void
  // BX-07: gera o lote mensal da receita Quadrantes se ainda não existir (idempotente) —
  // chamada em todo boot do app e no mount de /budgets. No-op se a receita estiver desligada.
  ensureQuadrantesBatch: () => void

  updateUser: (patch: Partial<DataFile['user']>) => void
  setRetentionLimit: (limit: number | null) => void
  // BX-07: liga/desliga a receita Quadrantes; ligar já dispara a geração do lote corrente.
  setQuadrantesEnabled: (enabled: boolean) => void
}

export const useDataStore = create<DataStore>((set, get) => ({
  data: null,
  syncStatus: 'idle',
  lastSyncedAt: null,

  loadData: (data) => set({ data }),
  clearData: () => set({ data: null }),

  runPeerSync: async () => {
    // CS-07: Google Drive (Fase 2) takes precedence over the Fase 1 shared-folder mode when
    // both happen to be configured — same "one transport at a time" rule as _triggerLocalBackup.
    const googleOn = isGoogleConnected()
    if (!googleOn && !isMultiDeviceEnabled()) return
    const { data } = get()
    if (!data) return

    set({ syncStatus: 'syncing' })
    try {
      const result = googleOn
        ? await pullAndMerge(data)
        : await syncFromPeers(data, await getDeviceId())

      if (result.status === 'merged') {
        const fresh = await storage.loadDataFile()
        set({ data: fresh ?? get().data, syncStatus: 'idle', lastSyncedAt: now() })
      } else if (result.status === 'offline') {
        set({ syncStatus: 'offline' })
      } else {
        // 'synced' or 'skipped' (newer-schema, non-fatal) — still a completed attempt
        set({ syncStatus: 'idle', lastSyncedAt: now() })
      }
    } catch {
      set({ syncStatus: 'error' })
    }
  },

  // ── Accounts ──────────────────────────────────────────────────────────────

  addAccount: (account) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          d.accounts.push(sanitizeAccount({ ...account, updatedAt: now() }))
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
          if (i !== -1) d.accounts[i] = sanitizeAccount({ ...account, updatedAt: now() })
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
          d.categories.push({ ...category, updatedAt: now() })
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
        if (i !== -1) d.categories[i] = { ...category, updatedAt: now() }
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
          d.tags.push({ ...tag, updatedAt: now() })
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
        if (i !== -1) d.tags[i] = { ...tag, updatedAt: now() }
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
            const purchaseDate = tx.date.slice(0, 10)

            for (let i = 1; i <= N; i++) {
              const installmentAmount = i === 1 ? perInstallment + remainder : perInstallment
              const installmentTx: Transaction = {
                ...tx,
                id: i === 1 ? tx.id : uuid(),
                amount: installmentAmount,
                date: advanceMonths(tx.date, i - 1),
                description: (tx.description + ` (${i}/${N})`).trim(),
                isPaid: false,
                installment: { parentId, currentIndex: i, total: N, purchaseDate },
                updatedAt: now(),
                createdAt: now(),
              }
              d.transactions.push(withAutoQuadranteLink(installmentTx, d.budgets))
            }

            const totalStr = `R$ ${tx.amount.toFixed(2).replace('.', ',')}`
            const groupSummary = `Compra parcelada em ${N}x: ${tx.description || accName} — ${totalStr} em ${accName}`
            addAudit(d, makeEntry('CREATE', 'transaction', parentId, groupSummary))
            return
          }

          // ── M-35/B-22: Recurring series creation (eager generation) ───────
          if (tx.recurrence) {
            const { frequency, endDate } = tx.recurrence
            const parentId = tx.id
            const startDate = tx.date.slice(0, 10)
            // No end date → generate up to a rolling horizon from the first occurrence;
            // refreshRecurrenceHorizons() keeps topping it up on every app load (B-22).
            const horizonEnd = (
              endDate ?? advanceMonths(startDate, RECURRENCE_ROLLING_MONTHS)
            ).slice(0, 10)
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
                updatedAt: now(),
                createdAt: now(),
              }
              d.transactions.push(withAutoQuadranteLink(occurrence, d.budgets))
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
          d.transactions.push(
            withAutoQuadranteLink({ ...tx, updatedAt: now(), createdAt: now() }, d.budgets)
          )
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
          if (i !== -1) {
            const prev = d.transactions[i]
            let next: Transaction = { ...tx, updatedAt: now() }
            // BX-08: só reavalia o vínculo automático quando a *data* de fato muda — uma edição
            // que não mexe na data não reaciona a regra, e não reimpõe um vínculo que o usuário
            // removeu manualmente pelo picker (plan/BUDGETS.md §5.6).
            if (prev.date.slice(0, 10) !== next.date.slice(0, 10)) {
              const quadranteIds = new Set(
                d.budgets.filter((b) => b.recipeSlug === QUADRANTE_SLUG).map((b) => b.id)
              )
              const manualIds = (next.budgetIds ?? []).filter((id) => !quadranteIds.has(id))
              const match =
                next.type === 'EXPENSE' ? findQuadranteForDate(d.budgets, next.date) : undefined
              next = { ...next, budgetIds: match ? [...manualIds, match.id] : manualIds }
            }
            d.transactions[i] = next
          }
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

  // ── B-22: top up open-ended recurring series to the rolling horizon ────────
  // System maintenance, not a user action — no audit entry (mirrors setRetentionLimit).
  refreshRecurrenceHorizons: () =>
    set((s) => {
      if (!s.data) return {}
      const horizonTarget = advanceMonths(todayStr(), RECURRENCE_ROLLING_MONTHS)

      const byParent = new Map<string, Transaction[]>()
      for (const tx of s.data.transactions) {
        if (!tx.recurrence) continue
        const arr = byParent.get(tx.recurrence.parentId)
        if (arr) arr.push(tx)
        else byParent.set(tx.recurrence.parentId, [tx])
      }

      const MAX_NEW_OCCURRENCES_PER_SERIES = 600 // safety cap (≈11 years of weekly)
      const newOccurrences: Transaction[] = []
      for (const occurrences of byParent.values()) {
        const { frequency, parentId, endDate } = occurrences[0].recurrence!
        if (endDate) continue // bounded series — fully generated at creation already

        let maxDate = occurrences[0].date.slice(0, 10)
        let template = occurrences[0]
        for (const occ of occurrences) {
          const d = occ.date.slice(0, 10)
          if (d > maxDate) {
            maxDate = d
            template = occ
          }
        }
        if (maxDate >= horizonTarget) continue

        for (let i = 1; i <= MAX_NEW_OCCURRENCES_PER_SERIES; i++) {
          const occDate = advanceByFrequency(maxDate, frequency, i)
          if (occDate > horizonTarget) break
          newOccurrences.push({
            ...template,
            id: uuid(),
            date: occDate,
            isPaid: false,
            recurrence: { frequency, parentId },
          })
        }
      }

      if (newOccurrences.length === 0) return {}
      const data = structuredClone(s.data)
      data.transactions.push(...newOccurrences)
      data.settings.fileUpdatedAt = now()
      debouncedReplaceAll(data)
      return { data }
    }),

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

  // ── Saved periods (M-45) ─────────────────────────────────────────────────

  addSavedPeriod: (period) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          d.savedPeriods.push(period)
          addAudit(
            d,
            makeEntry('CREATE', 'savedPeriod', period.id, `Período salvo criado: ${period.name}`)
          )
        },
        'saved_period_created'
      )
    ),

  deleteSavedPeriod: (id) =>
    set((s) =>
      mutate(s, (d) => {
        const period = d.savedPeriods.find((p) => p.id === id)
        d.savedPeriods = d.savedPeriods.filter((p) => p.id !== id)
        d.deletedIds = [...new Set([...d.deletedIds, id])]
        addAudit(
          d,
          makeEntry('DELETE', 'savedPeriod', id, `Período salvo removido: ${period?.name ?? id}`)
        )
      })
    ),

  // ── Caixinhas (F-30/BX-04) ────────────────────────────────────────────────

  addBudget: (budget) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const ts = now()
          d.budgets.push({ ...budget, createdAt: ts, updatedAt: ts })
          addAudit(
            d,
            makeEntry('CREATE', 'budget', budget.id, buildSummary('CREATE', 'budget', budget.name))
          )
        },
        'budget_created'
      )
    ),

  updateBudget: (budget) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const i = d.budgets.findIndex((b) => b.id === budget.id)
          if (i !== -1) d.budgets[i] = { ...budget, updatedAt: now() }
          addAudit(
            d,
            makeEntry('UPDATE', 'budget', budget.id, buildSummary('UPDATE', 'budget', budget.name))
          )
        },
        'budget_updated'
      )
    ),

  // Deleting a caixinha never deletes the linked transactions — only the link itself (the
  // confirmation copy in BudgetFormModal promises exactly this: "só perdem o vínculo").
  deleteBudget: (id) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const name = d.budgets.find((b) => b.id === id)?.name ?? id
          d.budgets = d.budgets.filter((b) => b.id !== id)
          d.transactions = d.transactions.map((t) =>
            t.budgetIds?.includes(id)
              ? { ...t, budgetIds: t.budgetIds.filter((bId) => bId !== id), updatedAt: now() }
              : t
          )
          d.deletedIds = [...new Set([...d.deletedIds, id])]
          addAudit(d, makeEntry('DELETE', 'budget', id, buildSummary('DELETE', 'budget', name)))
        },
        'budget_deleted'
      )
    ),

  // §5.7: visibility only — linked transactions and history stay untouched.
  archiveBudget: (id) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const budget = d.budgets.find((b) => b.id === id)
          if (!budget) return
          const ts = now()
          budget.archivedAt = ts
          budget.updatedAt = ts
          addAudit(
            d,
            makeEntry(
              'UPDATE',
              'budget',
              id,
              buildSummary('UPDATE', 'budget', budget.name, 'arquivada')
            )
          )
        },
        'budget_archived'
      )
    ),

  linkTransactionToBudget: (budgetId, transactionId) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const budget = d.budgets.find((b) => b.id === budgetId)
          const tx = d.transactions.find((t) => t.id === transactionId)
          if (!budget || !tx) return
          if (tx.budgetIds?.includes(budgetId)) return
          tx.budgetIds = [...(tx.budgetIds ?? []), budgetId]
          tx.updatedAt = now()
          addAudit(
            d,
            makeEntry(
              'UPDATE',
              'budget',
              budgetId,
              `Lançamento associado à caixinha: ${budget.name} — ${tx.description}`
            )
          )
        },
        'budget_transaction_linked'
      )
    ),

  unlinkTransactionFromBudget: (budgetId, transactionId) =>
    set((s) =>
      mutate(
        s,
        (d) => {
          const budget = d.budgets.find((b) => b.id === budgetId)
          const tx = d.transactions.find((t) => t.id === transactionId)
          if (!budget || !tx?.budgetIds?.includes(budgetId)) return
          tx.budgetIds = tx.budgetIds.filter((id) => id !== budgetId)
          tx.updatedAt = now()
          addAudit(
            d,
            makeEntry(
              'UPDATE',
              'budget',
              budgetId,
              `Lançamento desvinculado da caixinha: ${budget.name} — ${tx.description}`
            )
          )
        },
        'budget_transaction_unlinked'
      )
    ),

  // BX-07/BX-08: gera o lote mensal da receita Quadrantes (idempotente) e arquiva o anterior no
  // mesmo passo (§5.6). Chamada em todo boot e no mount de /budgets; no-op se a receita estiver
  // desligada ou se o lote do mês corrente já existir.
  ensureQuadrantesBatch: () =>
    set((s) => {
      if (!s.data || !s.data.settings.quadrantesEnabled) return {}
      const data = structuredClone(s.data)
      const ts = now()
      if (!applyQuadrantesRecipe(data.budgets, todayStr(), ts)) return {}
      addAudit(data, makeEntry('CREATE', 'budget', 'quadrantes', 'Quadrantes: lote mensal gerado'))
      data.settings.fileUpdatedAt = ts
      debouncedReplaceAll(data)
      trackAction('quadrantes_batch_generated')
      return { data }
    }),

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
      data.settings.fileUpdatedAt = now()
      debouncedReplaceAll(data)
      return { data }
    }),

  setQuadrantesEnabled: (enabled) =>
    set((s) => {
      if (!s.data) return {}
      const data = structuredClone(s.data)
      const ts = now()
      data.settings.quadrantesEnabled = enabled
      data.settings.fileUpdatedAt = ts
      // Ligar já gera o lote do mês corrente na hora — o usuário não precisa recarregar a
      // página pra ver os 4 quadrantes aparecerem.
      if (enabled && applyQuadrantesRecipe(data.budgets, todayStr(), ts)) {
        addAudit(
          data,
          makeEntry('CREATE', 'budget', 'quadrantes', 'Quadrantes: lote mensal gerado')
        )
      }
      debouncedReplaceAll(data)
      trackAction('quadrantes_toggle')
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
  const current = state.data
  const data = import.meta.env.DEV
    ? measure('store.mutate.clone', () => structuredClone(current))
    : structuredClone(current)
  if (import.meta.env.DEV) {
    measure('store.mutate.apply', () => fn(data))
  } else {
    fn(data)
  }
  // CS-06: syncService (Fase 2) compares this against the Drive file's modifiedTime to decide
  // whether a push is needed — it must reflect every mutation, not just file creation/import.
  data.settings.fileUpdatedAt = now()
  debouncedReplaceAll(data)
  if (actionName) trackAction(actionName)
  return { data }
}

// B-22: rolling horizon (months) a recurring series with no endDate is kept materialized
// to, ahead of "today". refreshRecurrenceHorizons() tops series up to this on every app
// load, so a series never silently stops generating once the initial window is consumed.
const RECURRENCE_ROLLING_MONTHS = 24

// Strips CREDIT-only fields (creditMetadata) from non-CREDIT accounts.
// CC-12: non-CREDIT accounts must never carry creditMetadata in the saved object.
// M-34: issuerIcon (institution branding) is allowed on any account type and is preserved.
// M-42: archived is allowed on any account type and is preserved.
// HE-05/HE-06: loanMetadata is allowed only on LOAN accounts and is preserved.
// HE-14: reserveMetadata is allowed only on RESERVE_ELIGIBLE_TYPES accounts and is preserved.
function sanitizeAccount(account: Account): Account {
  if (account.type === 'CREDIT') return account
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance,
    includeInBalance: account.includeInBalance,
    updatedAt: account.updatedAt,
    ...(account.issuerIcon ? { issuerIcon: account.issuerIcon } : {}),
    ...(account.archived ? { archived: account.archived } : {}),
    ...(account.type === 'LOAN' && account.loanMetadata
      ? { loanMetadata: account.loanMetadata }
      : {}),
    ...(RESERVE_ELIGIBLE_TYPES.includes(account.type) && account.reserveMetadata
      ? { reserveMetadata: account.reserveMetadata }
      : {}),
  }
}
