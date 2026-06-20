import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CreditCard,
  Landmark,
  ChevronDown,
  Info,
  Pencil,
  TrendingDown,
  Umbrella,
} from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// MOCK PAGE — Saúde Financeira
//
// Esta é uma versão *mockada* da tela, sem motores reais por trás. Os dados abaixo
// são fixos e existem apenas para revisão dos elementos de tela. Quando o layout for
// aprovado, os números virão de funções puras sobre `data.transactions`/`accounts`
// (motor de fatura virtual + parcelas), e a renda mensal de um campo do usuário ou
// da média de INCOME. Nada aqui persiste ou lê do store ainda.
// ─────────────────────────────────────────────────────────────────────────────

interface MockInstallment {
  id: string
  description: string
  current: number // parcela atual (1-based)
  total: number // total de parcelas
  monthly: number // valor da parcela
}

interface MockDebt {
  id: string
  name: string
  kind: 'card' | 'loan'
  issuer?: string // chave de cor da emissora
  installments: MockInstallment[]
}

const MOCK_INCOME = 11500

const MOCK_EMERGENCY_RESERVE = 22700 // reserva de emergência atual do usuário

const MOCK_MONTHLY_COST = 6000 // média de custo mensal (base do ideal de reserva)

const RESERVE_TARGET_MONTHS = 6 // ideal: 6× o custo mensal médio

const MOCK_DEBTS: MockDebt[] = [
  {
    id: 'd1',
    name: 'Nubank Platinum',
    kind: 'card',
    issuer: 'nubank',
    installments: [
      { id: 'i1', description: 'Notebook Dell', current: 4, total: 10, monthly: 420 },
      { id: 'i2', description: 'Geladeira Brastemp', current: 2, total: 12, monthly: 280 },
      { id: 'i3', description: 'Passagens GOL', current: 1, total: 6, monthly: 480 },
    ],
  },
  {
    id: 'd2',
    name: 'Itaú Click',
    kind: 'card',
    issuer: 'itau',
    installments: [
      { id: 'i4', description: 'iPhone 15', current: 6, total: 12, monthly: 530 },
      { id: 'i5', description: 'Curso de inglês', current: 3, total: 10, monthly: 190 },
    ],
  },
  {
    id: 'd3',
    name: 'Empréstimo Pessoal',
    kind: 'loan',
    installments: [
      { id: 'i6', description: 'Empréstimo Pessoal', current: 18, total: 36, monthly: 850 },
    ],
  },
]

const ISSUER_COLORS: Record<string, string> = {
  nubank: '#820AD1',
  itau: '#EC7000',
  inter: '#FF7A00',
  bradesco: '#CC092F',
  santander: '#EC0000',
}

// ── Derivações puras (sempre reconciliam o total com os itens) ────────────────

function remainingCount(inst: MockInstallment): number {
  return inst.total - inst.current + 1
}

function installmentRemaining(inst: MockInstallment): number {
  return remainingCount(inst) * inst.monthly
}

function debtTotal(debt: MockDebt): number {
  return debt.installments.reduce((s, i) => s + installmentRemaining(i), 0)
}

function debtMonthly(debt: MockDebt): number {
  return debt.installments.reduce((s, i) => s + i.monthly, 0)
}

function debtLongestHorizon(debt: MockDebt): number {
  return debt.installments.reduce((m, i) => Math.max(m, remainingCount(i)), 0)
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function Health() {
  const { t, i18n } = useTranslation()

  const { totalDebt, monthlyCommitted, commitmentPct, longestHorizon } = useMemo(() => {
    const totalDebt = MOCK_DEBTS.reduce((s, d) => s + debtTotal(d), 0)
    const monthlyCommitted = MOCK_DEBTS.reduce((s, d) => s + debtMonthly(d), 0)
    const longestHorizon = MOCK_DEBTS.reduce((m, d) => Math.max(m, debtLongestHorizon(d)), 0)
    return {
      totalDebt,
      monthlyCommitted,
      commitmentPct: MOCK_INCOME > 0 ? (monthlyCommitted / MOCK_INCOME) * 100 : 0,
      longestHorizon,
    }
  }, [])

  // Cor do medidor de comprometimento de renda: calmo até 30%, alerta até 50%, crítico acima.
  const gaugeColor = commitmentPct > 50 ? '#C0392B' : commitmentPct >= 30 ? '#D4A017' : '#2D6A4F'

  // Reserva de emergência: atual vs. recomendado (6× custo mensal). Cheia 100%+ verde,
  // 50–100% atenção, abaixo de 50% frágil.
  const recommendedReserve = RESERVE_TARGET_MONTHS * MOCK_MONTHLY_COST
  const reserveRatio = recommendedReserve > 0 ? MOCK_EMERGENCY_RESERVE / recommendedReserve : 0
  const reserveShortfall = Math.max(recommendedReserve - MOCK_EMERGENCY_RESERVE, 0)
  const reserveColor = reserveRatio >= 1 ? '#2D6A4F' : reserveRatio >= 0.5 ? '#D4A017' : '#C0392B'

  // Alavancagem pessoal: dívida total como múltiplo da renda mensal. Até 3× confortável,
  // 3–6× atenção, acima de 6× pesada. Tons claros p/ contraste sobre o card escuro.
  const leverage = MOCK_INCOME > 0 ? totalDebt / MOCK_INCOME : 0
  const leverageColor = leverage <= 3 ? '#3D9E82' : leverage <= 6 ? '#D4A017' : '#F1948A'
  const leverageText = `${new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(leverage)}×`

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-on-surface">{t('health.title')}</h1>
        <p className="text-sm text-on-surface/50 mt-0.5">{t('health.subtitle')}</p>
      </div>

      {/* ── Linha de resumo: Peso | Posição | Dívida ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {/* Peso no orçamento */}
        <div className="flex h-full flex-col rounded-2xl bg-surface-container-lowest p-5 sm:p-6 shadow-card border-[0.5px] border-surface-container-high">
          <h2 className="text-base font-semibold text-on-surface">{t('health.budgetTitle')}</h2>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                  {t('health.monthlyIncome')}
                </p>
                <button
                  aria-label={t('health.adjust')}
                  className="text-on-surface/30 hover:text-primary transition-colors"
                >
                  <Pencil size={12} strokeWidth={1.5} />
                </button>
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums text-on-surface">
                {formatCurrency(MOCK_INCOME)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface/40">
                {t('health.monthlyCommitted')}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-tertiary">
                {formatCurrency(monthlyCommitted)}
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
            <p className="mt-3 text-xs text-on-surface/40">
              {t('health.longestHorizon')}:{' '}
              <span className="text-on-surface/60">
                {t('health.months', { count: longestHorizon })}
              </span>
            </p>
          </div>
        </div>

        {/* Reserva de emergência: saldo atual vs. recomendado (6× custo mensal) */}
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
                {formatCurrency(MOCK_EMERGENCY_RESERVE)}
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

        {/* Dívida total comprometida — ponto de peso visual. Fundo grafite neutro (não verde):
            o container transmite gravidade sem viés positivo; a cor avaliativa fica só na alavancagem. */}
        <div
          className="flex h-full flex-col rounded-2xl p-5 sm:p-6 text-white shadow-card-ambient"
          style={{ backgroundColor: '#1A1F2E' }}
        >
          <div className="flex items-center gap-2">
            <TrendingDown size={18} strokeWidth={1.5} className="text-white/50" />
            <h2 className="text-base font-semibold text-white">{t('health.totalDebt')}</h2>
          </div>

          {/* Número único, grande e centralizado no corpo do card */}
          <div className="flex flex-1 items-center justify-center py-6">
            <p className="text-4xl font-semibold tabular-nums tracking-tight">
              {formatCurrency(totalDebt)}
            </p>
          </div>

          {/* Alavancagem + janela temporal */}
          <div>
            <p className="text-sm text-white/60">
              <span className="text-xl font-semibold tabular-nums" style={{ color: leverageColor }}>
                {leverageText}
              </span>{' '}
              {t('health.debtLeverageSuffix')}
            </p>
            <p className="mt-3 text-xs text-white/40">
              {t('health.debtWindow', { count: longestHorizon })}
            </p>
          </div>
        </div>
      </div>

      {/* ── Detalhamento das dívidas (expansível) ──────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-on-surface px-1">{t('health.detailTitle')}</h2>
        {MOCK_DEBTS.map((debt) => (
          <DebtCard key={debt.id} debt={debt} />
        ))}
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
    </div>
  )
}

// ── Card de dívida expansível ──────────────────────────────────────────────────

function DebtCard({ debt }: { debt: MockDebt }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const total = debtTotal(debt)
  const monthly = debtMonthly(debt)
  const badgeColor = debt.issuer ? (ISSUER_COLORS[debt.issuer] ?? '#1F2937') : '#1B4F72'
  const kindLabel = debt.kind === 'loan' ? t('health.loan') : t('health.card')
  const Icon = debt.kind === 'loan' ? Landmark : CreditCard

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
          <p className="text-sm font-medium text-on-surface truncate">{debt.name}</p>
          <p className="text-xs text-on-surface/40 mt-0.5">
            {kindLabel} · {formatCurrency(monthly)}
            {t('health.perMonth')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-semibold tabular-nums text-tertiary">
            {formatCurrency(total)}
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

      {/* Lista de parcelamentos */}
      {open && (
        <div className="border-t-[0.5px] border-surface-container px-4 py-2">
          {debt.installments.map((inst) => (
            <div key={inst.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">{inst.description}</p>
                <p className="text-xs text-on-surface/40 mt-0.5">
                  {t('health.installmentsRemaining', {
                    current: inst.current,
                    total: inst.total,
                    remaining: remainingCount(inst),
                  })}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#A87B0C' }}>
                  {formatCurrency(installmentRemaining(inst))}
                </p>
                <p className="text-xs text-on-surface/40 mt-0.5 tabular-nums">
                  {formatCurrency(inst.monthly)}
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
