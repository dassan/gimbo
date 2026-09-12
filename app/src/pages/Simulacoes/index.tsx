// Simulações — lista de hipóteses (M-101) + gráfico de projeção de saldo dos próximos 12 meses.
// Uma hipótese nunca é uma Transaction/Account real (ver types/index.ts) — o objetivo desta tela
// é justamente eliminar o hack de lançar transações fictícias numa conta real só para simular.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { FlaskConical, Pencil, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn, formatCurrency, getSimulationProjection } from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import { useIsDarkMode } from '@/hooks/useIsDarkMode'
import HypothesisFormModal from './HypothesisFormModal'
import type { Category, Hypothesis, HypothesisItem } from '@/types'

export default function Simulacoes() {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Hypothesis | undefined>(undefined)
  // Os tons escuros escolhidos para o tema claro (contraste contra fundo claro) ficam quase
  // invisíveis sobre o fundo escuro do dark mode — recharts define stroke via atributo SVG, onde
  // var(--...) não resolve, então a troca por tema precisa acontecer aqui em JS.
  const isDark = useIsDarkMode()
  const baselineStroke = isDark ? '#A8AA9F' : '#1F4D38'
  const adjustedStroke = isDark ? '#85B7EB' : '#1F3A5F'

  const data = useDataStore((s) => s.data)
  const toggleHypothesis = useDataStore((s) => s.toggleHypothesis)
  const hypotheses = data?.hypotheses ?? []

  const points = useMemo(
    () => (data ? getSimulationProjection(data.transactions, data.accounts, data.hypotheses) : []),
    [data]
  )
  const hasActive = hypotheses.some((h) => h.enabled)
  const seriesLabel: Record<string, string> = {
    baselineBalance: t('simulacoes.baseline'),
    adjustedBalance: t('simulacoes.adjusted'),
    adjustedIncome: t('simulacoes.income'),
    adjustedExpense: t('simulacoes.expenses'),
  }

  function openNew() {
    setEditing(undefined)
    setShowModal(true)
  }

  function openEdit(hypothesis: Hypothesis) {
    setEditing(hypothesis)
    setShowModal(true)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-on-surface">
            {t('simulacoes.title')}
          </h1>
          <p className="text-sm text-on-surface/50 mt-0.5">{t('simulacoes.subtitle')}</p>
        </div>
        <button
          onClick={openNew}
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={16} strokeWidth={2} />
          <span className="hidden sm:inline">{t('simulacoes.new')}</span>
        </button>
      </div>

      {/* ── Gráfico: barras de entrada/saída (já com as hipóteses ativas somadas) + baseline vs.
          baseline + hipóteses ativas nas linhas de saldo (nunca uma série por hipótese) ── */}
      <div className="rounded-2xl bg-surface-container p-6 space-y-4 shadow-card">
        <p className="text-xs font-medium text-on-surface/50">{t('simulacoes.chartTitle')}</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(25,28,29,0.04)" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  fontSize: 12,
                  backgroundColor: 'var(--color-surface-container-high)',
                  color: 'var(--color-on-surface)',
                }}
                labelStyle={{ color: 'var(--color-on-surface-variant)' }}
                formatter={(value, name) => [
                  formatCurrency(Number(value)),
                  seriesLabel[name as string] ?? String(name),
                ]}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                formatter={(value) => seriesLabel[String(value)] ?? String(value)}
              />
              {/* Entradas/saídas já recalculadas com toda hipótese ativa somada (getSimulationProjection) —
                  reage a ligar/desligar uma hipótese do mesmo jeito que as linhas de saldo. */}
              <Bar
                dataKey="adjustedIncome"
                name="adjustedIncome"
                fill="#2D6A4F"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="adjustedExpense"
                name="adjustedExpense"
                fill="#C0392B"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Line
                type="monotone"
                dataKey="baselineBalance"
                name="baselineBalance"
                stroke={baselineStroke}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              {/* Só desenhada quando existe ao menos uma hipótese ativa — do contrário seria
                  idêntica à linha base e só confundiria a leitura. */}
              {hasActive && (
                <Line
                  type="monotone"
                  dataKey="adjustedBalance"
                  name="adjustedBalance"
                  stroke={adjustedStroke}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Lista de hipóteses ────────────────────────────────────────────── */}
      {hypotheses.length === 0 ? (
        <EmptyState onCreate={openNew} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {hypotheses.map((hypothesis) => (
            <HypothesisCard
              key={hypothesis.id}
              hypothesis={hypothesis}
              categories={data?.categories ?? []}
              onEdit={() => openEdit(hypothesis)}
              onToggle={() => toggleHypothesis(hypothesis.id)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <HypothesisFormModal hypothesis={editing} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}

// ─── Card de hipótese ───────────────────────────────────────────────────────────

// Uma linha por item, no formato que o kind pede (ex.: "R$ 300,00 (valor de cada parcela — 12x)")
// — CATEGORY_TARGET é o único que precisa resolver o nome da categoria.
function formatHypothesisItemSummary(
  item: HypothesisItem,
  categories: Category[],
  t: TFunction
): string {
  const amount = formatCurrency(item.amount)
  switch (item.kind) {
    case 'ONE_TIME':
      return t('simulacoes.itemSummaryOneTime', { amount })
    case 'INSTALLMENT':
      return t('simulacoes.itemSummaryInstallment', { amount, count: item.installmentCount ?? 0 })
    case 'RECURRING':
      return t('simulacoes.itemSummaryRecurring', { amount })
    case 'CATEGORY_TARGET': {
      const category = categories.find((c) => c.id === item.categoryId)
      return t('simulacoes.itemSummaryCategoryTarget', {
        amount,
        category: category?.name ?? t('simulacoes.categoryPlaceholder'),
      })
    }
  }
}

function HypothesisCard({
  hypothesis,
  categories,
  onEdit,
  onToggle,
}: {
  hypothesis: Hypothesis
  categories: Category[]
  onEdit: () => void
  onToggle: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 shadow-card border-[0.5px] border-surface-container-high">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={onEdit}
          className="min-w-0 truncate text-left text-base font-semibold text-on-surface transition-colors hover:text-primary"
        >
          {hypothesis.name}
        </button>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={onEdit}
            aria-label={t('simulacoes.edit')}
            className="text-on-surface/40 transition-colors hover:text-primary"
          >
            <Pencil size={14} strokeWidth={1.5} />
          </button>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              role="switch"
              aria-checked={hypothesis.enabled}
              aria-label={t('simulacoes.enabled')}
              onClick={onToggle}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors duration-200',
                hypothesis.enabled ? 'bg-primary' : 'bg-outline-variant'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                  hypothesis.enabled ? 'translate-x-4' : 'translate-x-0.5'
                )}
              />
            </button>
          </label>
        </div>
      </div>

      {hypothesis.items.length === 0 ? (
        <p className="mt-1 text-xs text-on-surface/40">
          {t('simulacoes.itemCount', { count: 0, context: 'zero' })}
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {hypothesis.items.map((item, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-on-surface/40">
              {item.type === 'INCOME' ? (
                <TrendingUp
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
              ) : (
                <TrendingDown
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-tertiary"
                  aria-hidden="true"
                />
              )}
              <span>{formatHypothesisItemSummary(item, categories, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-container-lowest px-6 py-16 text-center shadow-card border-[0.5px] border-surface-container-high">
      <FlaskConical size={32} strokeWidth={1.25} className="text-on-surface/25" />
      <p className="text-sm font-medium text-on-surface/60">{t('simulacoes.emptyTitle')}</p>
      <p className="max-w-sm text-xs text-on-surface/40">{t('simulacoes.emptyBody')}</p>
      <button
        onClick={onCreate}
        className="mt-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
      >
        {t('simulacoes.new')}
      </button>
    </div>
  )
}
