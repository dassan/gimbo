// Caixinhas — lista geral.
import { useEffect, useMemo, useState } from 'react'
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
import { GAUGE_RED, STATUS_COLOR, daysRemaining, groupBudgetsForList } from './helpers'
import type { Budget, Transaction } from '@/types'

export default function Budgets() {
  const { t } = useTranslation()
  const [showNewModal, setShowNewModal] = useState(false)
  const budgets = useDataStore((s) => s.data?.budgets ?? [])
  const transactions = useDataStore((s) => s.data?.transactions ?? [])
  const quadrantesEnabled = useDataStore((s) => s.data?.settings.quadrantesEnabled ?? false)
  const ensureQuadrantesBatch = useDataStore((s) => s.ensureQuadrantesBatch)
  const sortBy = useWorkspaceStore((s) => s.workspace.budgetSortBy)

  // BX-07: idempotente — só gera/arquiva se o lote do mês corrente ainda não existir.
  useEffect(() => {
    ensureQuadrantesBatch()
  }, [ensureQuadrantesBatch])

  const visible = useMemo(() => budgets.filter((b) => !b.archivedAt), [budgets])
  // M-68: enquanto a receita Quadrantes estiver ativa, seus 4 slots ficam fixos nas primeiras
  // posições (ordenados por recipeSlot) — a ordenação configurável (U-3) vale só pro resto.
  const { quadrantes, rest } = useMemo(
    () => groupBudgetsForList(visible, transactions, sortBy, quadrantesEnabled),
    [visible, transactions, sortBy, quadrantesEnabled]
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
      {quadrantes.length === 0 && rest.length === 0 ? (
        <EmptyState onCreate={() => setShowNewModal(true)} />
      ) : (
        <>
          {quadrantes.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {quadrantes.map((budget) => (
                <BudgetCard key={budget.id} budget={budget} transactions={transactions} />
              ))}
            </div>
          )}

          {/* Rótulo só aqui — os quadrantes já se identificam pelo emoji numérico + cor
              neutra (§5.6), um cabeçalho próprio pra eles seria redundante. */}
          {quadrantes.length > 0 && rest.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('budgets.otherBudgets')}
              </p>
              <div className="mt-2 border-t border-surface-container-high" />
            </div>
          )}

          {rest.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {rest.map((budget) => (
                <BudgetCard key={budget.id} budget={budget} transactions={transactions} />
              ))}
            </div>
          )}
        </>
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
  // U-4 é para o usuário decidir arquivar uma caixinha manual — não se aplica aos slots da
  // receita Quadrantes (BX-07): o intervalo de dias de um slot passa bem antes do fim do mês
  // (ex.: Quadrante 1 encerra no dia 8), mas o lote inteiro continua "corrente" até a próxima
  // virada arquivar automaticamente. Mostrar o selo aqui sugeriria uma ação que não existe.
  const isEnded = !budget.recipeSlug && daysRemaining(budget.period) < 0

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

      {/* MB-14: transaction count dropped on mobile — the point there is conciseness */}
      <p className="mt-0.5 hidden text-[11px] text-on-surface/40 sm:block">
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

      {/* Meta — a âncora do card; o valor atual aparece junto do percentual abaixo.
          Desktop only (sm+) — mobile usa o resumo Atual/Meta abaixo (MB-14). */}
      <div className="mt-4 hidden sm:block">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
          {t('budgets.target')}
        </p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-on-surface">
          {formatCurrency(budget.target)}
        </p>
      </div>

      {/* Medidor, ancorado no rodapé para alinhar entre cards de alturas diferentes.
          Desktop only (sm+) — barra de progresso + percentual + disponível/excedente. */}
      <div className="mt-auto hidden pt-4 sm:block">
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

      {/* MB-14: mobile-only compact summary — name + Atual/Meta, no lançamentos count, no
          progress bar/percentual/disponível. Same anchor spot as the desktop blocks above. */}
      <div className="mt-4 sm:hidden">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
          {t('budgets.current')} / {t('budgets.target')}
        </p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-on-surface">
          {formatCurrency(current)} / {formatCurrency(budget.target)}
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
