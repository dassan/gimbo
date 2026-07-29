import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CreditCard,
  Landmark,
  Layers,
  ChevronDown,
  Info,
  Pencil,
  Check,
  X,
  Umbrella,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  formatCurrency,
  cn,
  getTotalCommittedDebt,
  getMonthlyCommitment,
  getMonthlyExpenses,
  getDebtHorizon,
  getDebtBreakdown,
  deriveMonthlyIncome,
  deriveMonthlyCost,
  getReserveBalance,
  getRecurringCommitment,
} from '@/lib/utils'
import type { DebtGroup } from '@/lib/utils'

const ISSUER_COLORS: Record<string, string> = {
  nubank: '#820AD1',
  itau: '#EC7000',
  inter: '#FF7A00',
  bradesco: '#CC092F',
  santander: '#EC0000',
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function Health() {
  const { t, i18n } = useTranslation()
  const data = useDataStore((s) => s.data)
  const incomeOverride = useWorkspaceStore((s) => s.workspace.monthlyIncomeOverride)
  const setIncomeOverride = useWorkspaceStore((s) => s.setMonthlyIncomeOverride)
  const incomeWindowMonths = useWorkspaceStore((s) => s.workspace.incomeWindowMonths)
  const costOverride = useWorkspaceStore((s) => s.workspace.monthlyCostOverride)
  const setCostOverride = useWorkspaceStore((s) => s.setMonthlyCostOverride)
  const reserveTargetMonths = useWorkspaceStore((s) => s.workspace.reserveTargetMonths)

  const [editingIncome, setEditingIncome] = useState(false)
  const [incomeInput, setIncomeInput] = useState('')
  const [editingCost, setEditingCost] = useState(false)
  const [costInput, setCostInput] = useState('')
  const [sortBy, setSortBy] = useState<'time' | 'value'>('time')

  const {
    totalDebt,
    monthlyCommitted,
    monthlyExpenses,
    longestHorizon,
    debtGroups,
    incomeEstimate,
    costEstimate,
    reserveBalance,
    recurringCommitment,
  } = useMemo(() => {
    if (!data) {
      return {
        totalDebt: 0,
        monthlyCommitted: 0,
        monthlyExpenses: 0,
        longestHorizon: 0,
        debtGroups: [] as DebtGroup[],
        incomeEstimate: deriveMonthlyIncome([], [], incomeWindowMonths),
        costEstimate: deriveMonthlyCost([], incomeWindowMonths),
        reserveBalance: 0,
        recurringCommitment: 0,
      }
    }
    return {
      totalDebt: getTotalCommittedDebt(data.transactions, data.accounts),
      monthlyCommitted: getMonthlyCommitment(data.transactions, data.accounts),
      monthlyExpenses: getMonthlyExpenses(data.transactions, data.accounts),
      longestHorizon: getDebtHorizon(data.transactions, data.accounts),
      debtGroups: getDebtBreakdown(data.transactions, data.accounts),
      incomeEstimate: deriveMonthlyIncome(data.transactions, data.accounts, incomeWindowMonths),
      costEstimate: deriveMonthlyCost(data.transactions, incomeWindowMonths),
      reserveBalance: getReserveBalance(data.transactions, data.accounts),
      recurringCommitment: getRecurringCommitment(
        data.transactions,
        new Date().toISOString().slice(0, 10)
      ),
    }
  }, [data, incomeWindowMonths])

  // D1: the user's confirmed value always wins; the derived estimate is only a suggestion.
  const monthlyIncome = incomeOverride ?? incomeEstimate.value ?? 0
  const hasIncome = incomeOverride !== undefined || incomeEstimate.value !== null

  const commitmentPct = monthlyIncome > 0 ? (monthlyCommitted / monthlyIncome) * 100 : 0
  const gaugeColor = commitmentPct > 50 ? '#C0392B' : commitmentPct >= 30 ? '#D4A017' : '#2D6A4F'

  // D7: mesmo padrão do D1 — valor confirmado pelo usuário sempre vence.
  const monthlyCost = costOverride ?? costEstimate.value ?? 0
  const hasCost = costOverride !== undefined || costEstimate.value !== null

  // Reserva de emergência: atual vs. recomendado (N× custo mensal, N configurável em
  // Configurações — HE-16). Cheia 100%+ verde, 50–100% atenção, abaixo de 50% frágil.
  const recommendedReserve = reserveTargetMonths * monthlyCost
  const reserveRatio = recommendedReserve > 0 ? reserveBalance / recommendedReserve : 0
  const reserveShortfall = Math.max(recommendedReserve - reserveBalance, 0)
  const reserveColor = reserveRatio >= 1 ? '#2D6A4F' : reserveRatio >= 0.5 ? '#D4A017' : '#C0392B'

  // Alavancagem pessoal: dívida total como múltiplo da renda mensal. Até 3× confortável,
  // 3–6× atenção, acima de 6× pesada.
  const leverage = monthlyIncome > 0 ? totalDebt / monthlyIncome : 0
  const leverageColor = leverage <= 3 ? '#2D6A4F' : leverage <= 6 ? '#D4A017' : '#C0392B'
  const leverageText = `${new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(leverage)}×`

  // Quanto das despesas deste mês é composto por parcelas (cartão/empréstimo) — dá ao
  // usuário a percepção de quanto do seu gasto mensal já está "pré-comprometido".
  const installmentSharePct = monthlyExpenses > 0 ? (monthlyCommitted / monthlyExpenses) * 100 : 0

  function startEditIncome() {
    setIncomeInput(monthlyIncome > 0 ? monthlyIncome.toFixed(2).replace('.', ',') : '')
    setEditingIncome(true)
  }

  function confirmEditIncome() {
    const parsed = parseFloat(incomeInput.replace(',', '.'))
    if (!Number.isNaN(parsed) && parsed >= 0) setIncomeOverride(parsed)
    setEditingIncome(false)
  }

  // Confidence label rendered on the card itself (not just the input) — otherwise the
  // user reads a derived % as absolute truth (falsa precisão). See FINANCIAL_HEALTH.md §6 D1.
  let incomeConfidenceLabel: string | null = null
  if (incomeOverride !== undefined) {
    incomeConfidenceLabel = t('health.confirmedByYou')
  } else if (incomeEstimate.value !== null) {
    incomeConfidenceLabel = incomeEstimate.isEstimate
      ? t('health.estimateConfirm', { count: incomeEstimate.confidenceMonths })
      : t('health.basedOnMonths', { count: incomeEstimate.confidenceMonths })
  }

  function startEditCost() {
    setCostInput(monthlyCost > 0 ? monthlyCost.toFixed(2).replace('.', ',') : '')
    setEditingCost(true)
  }

  function confirmEditCost() {
    const parsed = parseFloat(costInput.replace(',', '.'))
    if (!Number.isNaN(parsed) && parsed >= 0) setCostOverride(parsed)
    setEditingCost(false)
  }

  // Mesmo raciocínio do rótulo de confiança da renda (D1), aplicado ao custo (D7).
  let costConfidenceLabel: string | null = null
  if (costOverride !== undefined) {
    costConfidenceLabel = t('health.confirmedByYou')
  } else if (costEstimate.value !== null) {
    costConfidenceLabel = costEstimate.isEstimate
      ? t('health.estimateConfirm', { count: costEstimate.confidenceMonths })
      : t('health.basedOnMonths', { count: costEstimate.confidenceMonths })
  }

  if (!data) return null

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-on-surface">{t('health.title')}</h1>
        <p className="text-sm text-on-surface/50 mt-0.5">{t('health.subtitle')}</p>
      </div>

      {/* ── Linha de resumo: Peso (renda, parcelas e dívida) | Reserva ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {/* Peso no orçamento — ocupa 2 colunas: renda, parcelas do mês e dívida total */}
        <div className="flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-card border-[0.5px] border-surface-container-high lg:col-span-2">
          <h2 className="text-base font-semibold text-on-surface">{t('health.budgetTitle')}</h2>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                  {t('health.monthlyIncome')}
                </p>
                {!editingIncome && (
                  <button
                    aria-label={t('health.adjust')}
                    onClick={startEditIncome}
                    className="text-on-surface/30 hover:text-primary transition-colors"
                  >
                    <Pencil size={12} strokeWidth={1.5} />
                  </button>
                )}
              </div>

              {editingIncome ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={incomeInput}
                    onChange={(e) => setIncomeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmEditIncome()
                      if (e.key === 'Escape') setEditingIncome(false)
                    }}
                    placeholder={t('health.incomePlaceholder')}
                    className="w-24 rounded-lg bg-surface-container-high px-2 py-1 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    aria-label={t('common.save')}
                    onClick={confirmEditIncome}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-primary hover:bg-surface-container-high"
                  >
                    <Check size={14} strokeWidth={2} />
                  </button>
                  <button
                    aria-label={t('common.cancel')}
                    onClick={() => setEditingIncome(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-high"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              ) : hasIncome ? (
                <p className="mt-1 text-lg font-semibold tabular-nums text-on-surface">
                  {formatCurrency(monthlyIncome)}
                </p>
              ) : (
                <button
                  onClick={startEditIncome}
                  className="mt-1 text-sm font-medium text-primary hover:underline"
                >
                  {t('health.setIncomeCta')}
                </button>
              )}

              {incomeConfidenceLabel && !editingIncome && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-on-surface/40">
                  <span>{incomeConfidenceLabel}</span>
                  {incomeOverride !== undefined && (
                    <button
                      onClick={() => setIncomeOverride(undefined)}
                      className="text-primary hover:underline"
                    >
                      {t('health.recalculate')}
                    </button>
                  )}
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('health.monthlyCommitted')}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-tertiary">
                {formatCurrency(monthlyCommitted)}
              </p>
            </div>
            {/* Dívida total comprometida — ex-card próprio, agora mais à direita aqui dentro */}
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('health.totalDebt')}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-on-surface">
                {formatCurrency(totalDebt)}
              </p>
              <p className="mt-1 text-[11px] text-on-surface/40">
                <span className="font-semibold" style={{ color: leverageColor }}>
                  {leverageText}
                </span>{' '}
                {t('health.debtLeverageSuffix')}
              </p>
            </div>
          </div>

          {/* Medidor: % da renda comprometida */}
          <div className="mt-auto pt-5">
            <p className="text-sm text-on-surface/60">
              <span className="text-xl font-semibold tabular-nums" style={{ color: gaugeColor }}>
                {commitmentPct.toFixed(0)}%
              </span>{' '}
              {t('health.incomeCommitted')}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(commitmentPct, 100)}%`, backgroundColor: gaugeColor }}
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2 text-xs text-on-surface/40">
              <p>
                {t('health.installmentShareOfExpenses', { pct: installmentSharePct.toFixed(0) })}
              </p>
              <p className="text-right shrink-0">
                {t('health.longestHorizon')}:{' '}
                <span className="text-on-surface/60">
                  {t('health.months', { count: longestHorizon })}
                </span>
              </p>
            </div>
            {recurringCommitment > 0 && (
              <p className="mt-1 text-xs text-on-surface/40">
                {t('health.recurringCommitment')}:{' '}
                <span className="text-on-surface/60">{formatCurrency(recurringCommitment)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Reserva de emergência: saldo atual (contas marcadas via reserveMetadata) vs.
            recomendado (N× custo mensal médio derivado, N configurável — HE-12/HE-13/HE-14/HE-16). */}
        <div className="flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-card border-[0.5px] border-surface-container-high">
          <div className="flex items-center gap-2">
            <Umbrella size={18} strokeWidth={1.5} className="text-on-surface/40" />
            <h2 className="text-base font-semibold text-on-surface">
              {t('health.emergencyTitle')}
            </h2>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('health.emergencyBalance')}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-on-surface">
                {formatCurrency(reserveBalance)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('health.emergencyRecommended')}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-on-surface/70">
                {formatCurrency(recommendedReserve)}
              </p>
            </div>
          </div>

          {/* Custo mensal médio (D7) — denominador do recomendado, editável como a renda (D1) */}
          <div className="mt-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] text-on-surface/40">{t('health.monthlyCost')}</p>
              {!editingCost && (
                <button
                  aria-label={t('health.adjustCost')}
                  onClick={startEditCost}
                  className="text-on-surface/30 hover:text-primary transition-colors"
                >
                  <Pencil size={11} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {editingCost ? (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEditCost()
                    if (e.key === 'Escape') setEditingCost(false)
                  }}
                  placeholder={t('health.incomePlaceholder')}
                  className="w-24 rounded-lg bg-surface-container-high px-2 py-1 text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  aria-label={t('common.save')}
                  onClick={confirmEditCost}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-primary hover:bg-surface-container-high"
                >
                  <Check size={12} strokeWidth={2} />
                </button>
                <button
                  aria-label={t('common.cancel')}
                  onClick={() => setEditingCost(false)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-high"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ) : hasCost ? (
              <p className="text-xs font-medium tabular-nums text-on-surface/70">
                {formatCurrency(monthlyCost)}
              </p>
            ) : (
              <button
                onClick={startEditCost}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t('health.setCostCta')}
              </button>
            )}

            {costConfidenceLabel && !editingCost && (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-on-surface/40">
                <span>{costConfidenceLabel}</span>
                {costOverride !== undefined && (
                  <button
                    onClick={() => setCostOverride(undefined)}
                    className="text-primary hover:underline"
                  >
                    {t('health.recalculate')}
                  </button>
                )}
              </p>
            )}
          </div>

          {/* Medidor: % do recomendado já reservado */}
          <div className="mt-auto pt-5">
            <p className="text-sm text-on-surface/60">
              <span className="text-xl font-semibold tabular-nums" style={{ color: reserveColor }}>
                {Math.round(reserveRatio * 100)}%
              </span>{' '}
              {t('health.emergencyPctSuffix')}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(reserveRatio * 100, 100)}%`,
                  backgroundColor: reserveColor,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-on-surface/40">
              {reserveShortfall > 0
                ? t('health.emergencyShortfall', { value: formatCurrency(reserveShortfall) })
                : t('health.emergencyComplete')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Callout educativo ──────────────────────────────────────────────── */}
      <div
        className="flex gap-3 rounded-xl p-4"
        style={{ backgroundColor: '#FEF3DC', borderLeft: '3px solid #D4A017' }}
      >
        <Info
          size={16}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0"
          style={{ color: '#A87B0C' }}
        />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#6B4E07' }}>
            {t('health.insightTitle')}
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: '#6B4E07' }}>
            {t('health.insightBody')}
          </p>
        </div>
      </div>

      {/* ── Detalhamento das dívidas (expansível) ──────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-semibold text-on-surface">{t('health.detailTitle')}</h2>
          {debtGroups.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-on-surface/50">
              <span>{t('health.sortBy')}</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'time' | 'value')}
                className="rounded-lg bg-surface-container-high px-2 py-1 text-xs text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="time">{t('health.sortByTime')}</option>
                <option value="value">{t('health.sortByValue')}</option>
              </select>
            </label>
          )}
        </div>
        {debtGroups.length === 0 ? (
          <p className="py-8 text-center text-sm text-on-surface/40">{t('health.noDebt')}</p>
        ) : (
          debtGroups.map((group) => (
            <DebtCard key={group.accountId} group={group} sortBy={sortBy} />
          ))
        )}
      </div>
    </div>
  )
}

// ── Card de dívida expansível ──────────────────────────────────────────────────

function DebtCard({ group, sortBy }: { group: DebtGroup; sortBy: 'time' | 'value' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const items = useMemo(() => {
    if (sortBy === 'value') {
      return [...group.items].sort((a, b) => b.remainingTotal - a.remainingTotal)
    }
    return group.items
  }, [group.items, sortBy])

  const badgeColor =
    group.kind === 'loan'
      ? '#92400E'
      : group.kind === 'installments'
        ? '#1F3A5F'
        : group.issuerIcon
          ? (ISSUER_COLORS[group.issuerIcon] ?? '#1F2937')
          : '#1B4F72'
  const kindLabel =
    group.kind === 'loan'
      ? t('health.loan')
      : group.kind === 'installments'
        ? t('health.installments')
        : t('health.card')
  const Icon =
    group.kind === 'loan' ? Landmark : group.kind === 'installments' ? Layers : CreditCard

  return (
    <div className="rounded-2xl bg-surface-container-lowest shadow-card border-[0.5px] border-surface-container-high overflow-hidden">
      {/* Cabeçalho clicável */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-container-low transition-colors"
        aria-expanded={open}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: badgeColor }}
        >
          <Icon size={18} strokeWidth={1.5} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface truncate">{group.accountName}</p>
          <p className="text-xs text-on-surface/40 mt-0.5">
            {kindLabel} · {formatCurrency(group.monthly)}
            {t('health.perMonth')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-semibold tabular-nums text-tertiary">
            {formatCurrency(group.remainingTotal)}
          </span>
          <ChevronDown
            size={18}
            strokeWidth={1.5}
            className={cn(
              'text-on-surface/30 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Lista de parcelamentos / saldo do empréstimo */}
      {open && (
        <div className="border-t-[0.5px] border-surface-container px-4 py-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">{item.description}</p>
                <p className="text-xs text-on-surface/40 mt-0.5">
                  {item.kind === 'installment'
                    ? t('health.installmentsRemaining', {
                        current: item.current,
                        total: item.total,
                        remaining: item.remaining,
                      })
                    : t('health.loanRemaining', { remaining: item.remaining })}
                  {item.kind === 'loan' && item.interestRate !== undefined && (
                    <> · {t('health.interestRate', { rate: item.interestRate })}</>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#A87B0C' }}>
                  {formatCurrency(item.remainingTotal)}
                </p>
                <p className="text-xs text-on-surface/40 mt-0.5 tabular-nums">
                  {formatCurrency(item.monthly)}
                  {t('health.perMonth')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
