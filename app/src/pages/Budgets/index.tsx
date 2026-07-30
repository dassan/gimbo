// Caixinhas — lista geral. PROTÓTIPO: lê apenas de `mock.ts`, não escreve nada.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PiggyBank, Plus } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import BudgetFormModal from './BudgetFormModal'
import { MOCK_BUDGETS, budgetCurrent, budgetDelta, budgetProgress, type MockBudget } from './mock'
import { ProgressBar } from './shared'
import { GAUGE_RED, STATUS_COLOR, getBudgetStatus } from './helpers'

export default function Budgets() {
  const { t } = useTranslation()
  const [showNewModal, setShowNewModal] = useState(false)

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
      {MOCK_BUDGETS.length === 0 ? (
        <EmptyState onCreate={() => setShowNewModal(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {MOCK_BUDGETS.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} />
          ))}
        </div>
      )}

      {showNewModal && <BudgetFormModal onClose={() => setShowNewModal(false)} />}
    </div>
  )
}

// ─── Card de caixinha (layout de 4 colunas, espelha o painel de reserva) ──────

function BudgetCard({ budget }: { budget: MockBudget }) {
  const { t } = useTranslation()

  const current = budgetCurrent(budget)
  const delta = budgetDelta(budget)
  const progress = budgetProgress(budget)
  const status = getBudgetStatus(budget)
  const color = STATUS_COLOR[status]

  // O card inteiro é o link para o detalhe — num tile estreito não sobra espaço
  // para uma área clicável menor que isso.
  return (
    <Link
      to={`/budgets/${budget.id}`}
      className="group flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 shadow-card border-[0.5px] border-surface-container-high transition-colors hover:bg-surface-container-low"
    >
      {/* Nome + selo de status */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-on-surface transition-colors group-hover:text-primary">
          {budget.name}
        </h3>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          {t(`budgets.status.${status}`)}
        </span>
      </div>

      <p className="mt-0.5 text-[11px] text-on-surface/40">
        {t(budget.kind === 'income' ? 'budgets.kindIncome' : 'budgets.kindExpense')} ·{' '}
        {t('budgets.linkedCount', { count: budget.transactions.length })}
      </p>

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
