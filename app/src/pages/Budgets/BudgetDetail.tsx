// Caixinhas — detalhe.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, ChevronLeft, Link2, Pencil } from 'lucide-react'
import {
  budgetCurrent,
  budgetDelta,
  budgetProgress,
  formatCurrency,
  cn,
  getBudgetStatus,
  isCashRealized,
  parseDateLocal,
} from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import BudgetFormModal from './BudgetFormModal'
import { TransactionPickerModal } from './TransactionPicker'
import { BudgetAvatar, ProgressBar } from './shared'
import { STATUS_COLOR, daysRemaining, formatBudgetPeriod } from './helpers'
import type { Account, Budget, Category, Transaction } from '@/types'

export default function BudgetDetail() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { budgetId } = useParams<{ budgetId: string }>()
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const budget = useDataStore((s) => s.data?.budgets.find((b) => b.id === budgetId))
  const allTransactions = useDataStore((s) => s.data?.transactions ?? [])
  const categories = useDataStore((s) => s.data?.categories ?? [])
  const accounts = useDataStore((s) => s.data?.accounts ?? [])
  const archiveBudget = useDataStore((s) => s.archiveBudget)

  if (!budget) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        <BackLink />
        <p className="text-sm text-on-surface/40">{t('common.noData')}</p>
      </div>
    )
  }

  const current = budgetCurrent(budget, allTransactions)
  const delta = budgetDelta(budget, allTransactions)
  const progress = budgetProgress(budget, allTransactions)
  const status = getBudgetStatus(budget, allTransactions)
  const color = STATUS_COLOR[status]
  const remaining = daysRemaining(budget.period)

  // Lançamentos vinculados — inclui os ainda não realizados (P-6: ficam associados,
  // só não entram na soma de "Atual" abaixo). Mais recentes primeiro, como num extrato.
  const linked = allTransactions
    .filter((tx) => tx.budgetIds?.includes(budget.id))
    .sort((a, b) => b.date.localeCompare(a.date))

  // Resumo por categoria usa só o realizado, pra bater com o "Atual" mostrado acima.
  const categoryTotals = Object.entries(
    linked
      .filter(isCashRealized)
      .reduce<Record<string, { total: number; color: string }>>((acc, tx) => {
        const cat = categories.find((c) => c.id === tx.categoryId)
        const key = cat?.name ?? t('common.noData')
        const entry = acc[key] ?? { total: 0, color: cat?.color ?? '#6B7280' }
        entry.total += tx.amount
        acc[key] = entry
        return acc
      }, {})
  ).sort((a, b) => b[1].total - a[1].total)

  function handleArchive() {
    archiveBudget(budget!.id)
    // Caixinhas arquivadas somem da lista principal (sem tela de consulta na v1) —
    // ficar no detalhe de algo inalcançável pela lista confundiria mais do que ajudaria.
    void navigate('/budgets')
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* ── Voltar ─────────────────────────────────────────────────────────── */}
      <BackLink />

      {/* ── Cabeçalho da caixinha ──────────────────────────────────────────── */}
      <div className="rounded-2xl bg-surface-container p-5 sm:p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <BudgetAvatar budget={budget} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-on-surface">{budget.name}</h1>
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ backgroundColor: `${color}1F`, color }}
                >
                  {t(`budgets.status.${status}`)}
                </span>
              </div>
              <p className="mt-1 text-xs text-on-surface/40">
                {t(budget.kind === 'income' ? 'budgets.kindIncome' : 'budgets.kindExpense')} ·{' '}
                {formatBudgetPeriod(budget.period, i18n.language)} ·{' '}
                {remaining >= 0
                  ? // pt-BR's CLDR rule groups 0 with "one" (Intl.PluralRules('pt-BR').select(0)
                    // === 'one'), which would render "falta 0 dia" — force a zero form instead.
                    t('budgets.daysLeft', {
                      count: remaining,
                      context: remaining === 0 ? 'zero' : undefined,
                    })
                  : t('budgets.periodClosed')}
              </p>
            </div>
          </div>

          {confirmingArchive ? (
            <div className="flex max-w-xs flex-col gap-2 rounded-2xl border-[0.5px] border-tertiary/30 bg-tertiary/5 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-on-surface">
                  {t('budgets.archiveConfirmTitle')}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface/60">
                  {t('budgets.archiveConfirmBody')}
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirmingArchive(false)}
                  className="shrink-0 text-xs font-medium text-on-surface/60 hover:text-on-surface"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleArchive}
                  className="shrink-0 rounded-xl bg-tertiary px-3 py-1.5 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
                >
                  {t('budgets.archiveConfirm')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-2 rounded-2xl bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Pencil size={14} strokeWidth={1.5} />
                {t('budgets.edit')}
              </button>
              <button
                onClick={() => setConfirmingArchive(true)}
                className="flex items-center gap-2 rounded-2xl bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Archive size={14} strokeWidth={1.5} />
                {t('budgets.archive')}
              </button>
            </div>
          )}
        </div>

        {/* Mesmas 4 colunas do card da lista, em escala maior */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <HeadFigure label={t('budgets.target')} value={formatCurrency(budget.target)} />
          <HeadFigure label={t('budgets.current')} value={formatCurrency(current)} />
          <HeadFigure
            label={t(delta >= 0 ? 'budgets.remaining' : 'budgets.over')}
            value={formatCurrency(Math.abs(delta))}
            color={delta >= 0 ? undefined : '#C0392B'}
          />
          <HeadFigure
            label={t('budgets.linked')}
            value={String(linked.length)}
            hint={t('budgets.linkedHint')}
          />
        </div>

        <div className="mt-6">
          <ProgressBar progress={progress} color={color} className="h-2.5" />
          <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-on-surface/40">
            <p>
              <span className="text-base font-semibold tabular-nums" style={{ color }}>
                {Math.round(progress * 100)}%
              </span>{' '}
              {t('budgets.ofGoal')}{' '}
              <span className="tabular-nums">({formatCurrency(current)})</span>
            </p>
            <p className="shrink-0 text-right tabular-nums">
              {t(delta >= 0 ? 'budgets.remaining' : 'budgets.over')}{' '}
              {formatCurrency(Math.abs(delta))}
            </p>
          </div>
        </div>
      </div>

      {/* ── Lançamentos + resumo por categoria ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-semibold text-on-surface">
              {t('budgets.transactionsTitle')}
            </h2>
            <button
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Link2 size={13} strokeWidth={1.75} />
              {t('budgets.linkTransaction')}
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl bg-surface-container shadow-card">
            {linked.length === 0 ? (
              <p className="p-12 text-center text-sm text-on-surface/40">
                {t('budgets.noTransactions')}
              </p>
            ) : (
              linked.map((tx, i) => (
                <BudgetTxRow
                  key={tx.id}
                  tx={tx}
                  budget={budget}
                  categories={categories}
                  accounts={accounts}
                  isLast={i === linked.length - 1}
                />
              ))
            )}
          </div>
        </div>

        {/* Resumo por categoria (sticky), espelhando o da fatura de cartão */}
        {categoryTotals.length > 0 && (
          <div className="lg:sticky lg:top-8 rounded-2xl bg-surface-container p-6 shadow-card">
            <h3 className="mb-4 text-sm font-semibold text-on-surface">
              {t('budgets.byCategory')}
            </h3>
            <div className="space-y-3">
              {categoryTotals.map(([name, { total, color: catColor }]) => (
                <div key={name}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-on-surface/70">{name}</span>
                    <span className="text-xs font-semibold tabular-nums text-on-surface">
                      {formatCurrency(total)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-low">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${current > 0 ? (total / current) * 100 : 0}%`,
                        backgroundColor: catColor,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-surface-container-low pt-4">
              <span className="text-xs font-semibold text-on-surface">{t('common.total')}</span>
              <span className="text-sm font-bold tabular-nums text-on-surface">
                {formatCurrency(current)}
              </span>
            </div>
          </div>
        )}
      </div>

      {showEditModal && <BudgetFormModal budget={budget} onClose={() => setShowEditModal(false)} />}
      {showPicker && (
        <TransactionPickerModal budget={budget} onClose={() => setShowPicker(false)} />
      )}
    </div>
  )
}

// ─── Peças ────────────────────────────────────────────────────────────────────

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/budgets"
      className="inline-flex items-center gap-2 text-sm text-on-surface/50 transition-colors hover:text-on-surface"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-low">
        <ChevronLeft size={16} />
      </span>
      {t('budgets.backToList')}
    </Link>
  )
}

function HeadFigure({
  label,
  value,
  color,
  hint,
}: {
  label: string
  value: string
  color?: string
  hint?: string
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface/40">
        {label}
      </p>
      <p
        className="mt-1 text-xl font-bold tabular-nums text-on-surface"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-on-surface/40">{hint}</p>}
    </div>
  )
}

function BudgetTxRow({
  tx,
  budget,
  categories,
  accounts,
  isLast,
}: {
  tx: Transaction
  budget: Budget
  categories: Category[]
  accounts: Account[]
  isLast: boolean
}) {
  const { i18n } = useTranslation()
  const category = categories.find((c) => c.id === tx.categoryId)
  const catName = category?.name ?? ''
  const catColor = category?.color ?? '#6B7280'
  const accName = accounts.find((a) => a.id === tx.accountId)?.name ?? ''
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-container-low',
        !isLast && 'border-b border-surface-container-low'
      )}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
        style={{ backgroundColor: catColor }}
      >
        {catName[0] ?? '?'}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-on-surface">{tx.description}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-on-surface/40">{catName}</span>
          <span className="text-xs text-on-surface/30">· {accName}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            'text-sm font-bold tabular-nums',
            budget.kind === 'income' ? 'text-primary' : 'text-tertiary'
          )}
        >
          {formatCurrency(tx.amount)}
        </p>
        <p className="mt-0.5 text-[10px] text-on-surface/30">
          {parseDateLocal(tx.date).toLocaleDateString(i18n.language, {
            day: '2-digit',
            month: 'short',
          })}
        </p>
      </div>
    </div>
  )
}
