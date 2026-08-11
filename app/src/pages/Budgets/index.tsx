// Caixinhas — lista geral.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PiggyBank, Plus } from 'lucide-react'
import {
  formatCurrency,
  budgetCurrent,
  budgetDelta,
  budgetProgress,
  getBudgetStatus,
} from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import BudgetFormModal from './BudgetFormModal'
import { ProgressBar } from './shared'
import { GAUGE_RED, STATUS_COLOR, daysRemaining, sortBudgets } from './helpers'
import type { Budget, Transaction } from '@/types'

export default function Budgets() {
  const { t } = useTranslation()
  const [showNewModal, setShowNewModal] = useState(false)
  const budgets = useDataStore((s) => s.data?.budgets ?? [])
  const transactions = useDataStore((s) => s.data?.transactions ?? [])
  const sortBy = useWorkspaceStore((s) => s.workspace.budgetSortBy)

  const visible = useMemo(() => budgets.filter((b) => !b.archivedAt), [budgets])
  const sorted = useMemo(
    () => sortBudgets(visible, transactions, sortBy),
    [visible, transactions, sortBy]
  )

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-on-surface">
            {t('budgets.title')}
          </h1>
          <p className="text-sm text-on-surface/50 mt-0.5">{t('budgets.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={16} strokeWidth={2} />
          <span className="hidden sm:inline">{t('budgets.new')}</span>
        </button>
      </div>

      {/* ── Lista de caixinhas ─────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <EmptyState onCreate={() => setShowNewModal(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sorted.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} transactions={transactions} />
          ))}
        </div>
      )}

      {showNewModal && <BudgetFormModal onClose={() => setShowNewModal(false)} />}
    </div>
  )
}

// ─── Card de caixinha (layout de 4 colunas, espelha o painel de reserva) ──────

function BudgetCard({ budget, transactions }: { budget: Budget; transactions: Transaction[] }) {
  const { t } = useTranslation()

  const current = budgetCurrent(budget, transactions)
  const delta = budgetDelta(budget, transactions)
  const progress = budgetProgress(budget, transactions)
  const status = getBudgetStatus(budget, transactions)
  const color = STATUS_COLOR[status]
  const linkedCount = transactions.filter((tx) => tx.budgetIds?.includes(budget.id)).length
  const isEnded = daysRemaining(budget.period) < 0

  // O card inteiro é o link para o detalhe — num tile estreito não sobra espaço
  // para uma área clicável menor que isso.
  return (
    <Link
      to={`/budgets/${budget.id}`}
      className="group flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 shadow-card border-[0.5px] border-surface-container-high transition-colors hover:bg-surface-container-low"
    >
      {/* Nome */}
      <h3 className="min-w-0 truncate text-base font-semibold text-on-surface transition-colors group-hover:text-primary">
        {budget.name}
      </h3>

      <p className="mt-0.5 text-[11px] text-on-surface/40">
        {t(budget.kind === 'income' ? 'budgets.kindIncome' : 'budgets.kindExpense')} ·{' '}
        {t('budgets.linkedCount', {
          count: linkedCount,
          // pt-BR's CLDR plural rule groups 0 with "one" (Intl.PluralRules('pt-BR').select(0)
          // === 'one'), which would otherwise render the singular "0 lançamento" — force a
          // dedicated zero form instead of relying on the automatic plural category.
          context: linkedCount === 0 ? 'zero' : undefined,
        })}
      </p>

      {/* U-4: aviso não-interativo — a ação de arquivar só existe no detalhe */}
      {isEnded && (
        <span className="mt-2 inline-flex w-fit items-center rounded-full bg-tertiary/10 px-2 py-0.5 text-[10px] font-semibold text-tertiary">
          {t('budgets.periodEndedBadge')}
        </span>
      )}

      {/* Meta — a âncora do card; o valor atual aparece junto do percentual abaixo */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
          {t('budgets.target')}
        </p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-on-surface">
          {formatCurrency(budget.target)}
        </p>
      </div>

      {/* Medidor, ancorado no rodapé para alinhar entre cards de alturas diferentes */}
      <div className="mt-auto pt-4">
        <ProgressBar progress={progress} color={color} />
        <p className="mt-2 text-[11px] text-on-surface/40">
          <span className="text-xs font-semibold tabular-nums" style={{ color }}>
            {Math.round(progress * 100)}%
          </span>{' '}
          {t('budgets.ofGoal')} <span className="tabular-nums">({formatCurrency(current)})</span>
        </p>
        <p className="mt-1 text-[11px] text-on-surface/40">
          {t(delta >= 0 ? 'budgets.remaining' : 'budgets.over')}{' '}
          <span
            className="font-semibold tabular-nums"
            style={{ color: delta >= 0 ? undefined : GAUGE_RED }}
          >
            {formatCurrency(Math.abs(delta))}
          </span>
        </p>
      </div>
    </Link>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-container-lowest px-6 py-16 text-center shadow-card border-[0.5px] border-surface-container-high">
      <PiggyBank size={32} strokeWidth={1.25} className="text-on-surface/25" />
      <p className="text-sm font-medium text-on-surface/60">{t('budgets.emptyTitle')}</p>
      <p className="max-w-sm text-xs text-on-surface/40">{t('budgets.emptyBody')}</p>
      <button
        onClick={onCreate}
        className="mt-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
      >
        {t('budgets.new')}
      </button>
    </div>
  )
}
