// Modal de associação de lançamentos a uma caixinha — associa/desvincula em toggle.
// P-1/P-2: mesmo vínculo N:N usado pela receita Quadrantes; T-8: selecionar uma parcela
// vincula a série inteira de uma vez, via installment.parentId.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import { cn, formatCurrency, parseDateLocal } from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import type { Budget, Transaction } from '@/types'

export function TransactionPickerModal({
  budget,
  onClose,
}: {
  budget: Budget
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const allTransactions = useDataStore((s) => s.data?.transactions ?? [])
  const categories = useDataStore((s) => s.data?.categories ?? [])
  const linkTransactionToBudget = useDataStore((s) => s.linkTransactionToBudget)
  const unlinkTransactionFromBudget = useDataStore((s) => s.unlinkTransactionFromBudget)
  const [query, setQuery] = useState('')

  // A caixinha só faz sentido com o tipo de lançamento que combina com a meta:
  // despesa = teto de gasto (EXPENSE), receita = piso a bater (INCOME).
  const txType = budget.kind === 'income' ? 'INCOME' : 'EXPENSE'

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTransactions
      .filter((tx) => tx.type === txType)
      .filter((tx) => !q || tx.description.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [allTransactions, txType, query])

  function toggle(tx: Transaction) {
    const linked = tx.budgetIds?.includes(budget.id) ?? false
    // T-8: parcela faz parte de uma série — vincula/desvincula todas de uma vez, não
    // uma por uma ao longo dos próximos meses.
    const group = tx.installment
      ? allTransactions.filter((t) => t.installment?.parentId === tx.installment!.parentId)
      : [tx]
    for (const t of group) {
      if (linked) unlinkTransactionFromBudget(budget.id, t.id)
      else linkTransactionToBudget(budget.id, t.id)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-low shadow-card-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="text-base font-semibold text-on-surface">
              {t('budgets.linkTransaction')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface/40 transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30"
              />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('budgets.pickerSearchPlaceholder')}
                className="w-full rounded-xl bg-surface-container-high py-2.5 pl-9 pr-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border-t border-surface-container-high">
            {candidates.length === 0 ? (
              <p className="p-10 text-center text-sm text-on-surface/40">
                {t('budgets.pickerEmpty')}
              </p>
            ) : (
              candidates.map((tx) => {
                const linked = tx.budgetIds?.includes(budget.id) ?? false
                const catName = categories.find((c) => c.id === tx.categoryId)?.name ?? ''
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => toggle(tx)}
                    aria-pressed={linked}
                    className="flex w-full items-center gap-3 border-b border-surface-container-high px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-container-high"
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        linked
                          ? 'border-primary bg-primary text-white'
                          : 'border-surface-container-high text-transparent'
                      )}
                    >
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-on-surface">
                        {tx.description || catName}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-on-surface/40">
                        {parseDateLocal(tx.date).toLocaleDateString(i18n.language, {
                          day: '2-digit',
                          month: 'short',
                        })}
                        {tx.installment &&
                          ` · ${t('budgets.pickerInstallmentHint', { total: tx.installment.total })}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-on-surface">
                      {formatCurrency(tx.amount)}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}
