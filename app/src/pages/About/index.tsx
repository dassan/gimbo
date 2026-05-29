import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FlaskConical,
  GitBranch,
  Layers,
  TrendingUp,
  TrendingDown,
  Repeat2,
  CalendarDays,
  Tag,
  Wallet,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileCode2,
  BarChart3,
  Sparkles,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { formatCurrency, cn, parseDateLocal } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GimboStats {
  generatedAt: string
  coverage: {
    statements: { covered: number; total: number; pct: number }
    branches: { covered: number; total: number; pct: number }
    functions: { covered: number; total: number; pct: number }
    files: number | null
  } | null
  unitTests: { total: number; passed: number; failed: number; suites: number } | null
  e2eTests: { status: string; failed: number; total?: number; passed?: number } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pctColor(pct: number): string {
  if (pct >= 95) return 'text-primary'
  if (pct >= 80) return 'text-amber-500'
  return 'text-tertiary'
}

function CoverageBar({ pct, label }: { pct: number; label: string }) {
  const barColor = pct >= 95 ? 'bg-primary' : pct >= 80 ? 'bg-amber-400' : 'bg-tertiary'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-on-surface/60">{label}</span>
        <span className={cn('text-xs font-semibold tabular-nums', pctColor(pct))}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-container-low overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700', barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

interface StatTileProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  shadowClass: string
}

function StatTile({ icon, label, value, sub, shadowClass }: StatTileProps) {
  return (
    <div className={cn('rounded-2xl bg-surface-container p-5', shadowClass)}>
      <div className="flex items-center gap-2 mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="label text-on-surface/50">{label}</span>
      </div>
      <p className="text-2xl font-bold text-on-surface">{value}</p>
      {sub && <p className="mt-1 text-xs text-on-surface/40 truncate">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function About() {
  const { t } = useTranslation()
  const data = useDataStore((s) => s.data)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )

  const [devStats, setDevStats] = useState<GimboStats | null>(null)

  useEffect(() => {
    fetch('/gimbo-stats.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setDevStats(json as GimboStats))
      .catch(() => setDevStats(null))
  }, [])

  // ── Usage stats ─────────────────────────────────────────────────────────────
  const usage = useMemo(() => {
    if (!data) return null

    const txs = data.transactions
    const income = txs.filter((tx) => tx.type === 'INCOME')
    const expenses = txs.filter((tx) => tx.type === 'EXPENSE')
    const transfers = txs.filter((tx) => tx.type === 'TRANSFER')
    const creditPayments = txs.filter((tx) => tx.type === 'CREDIT_PAYMENT')

    const totalIncome = income.reduce((s, tx) => s + tx.amount, 0)
    const totalExpenses = expenses.reduce((s, tx) => s + tx.amount, 0)

    // First and last transaction dates
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date))
    const firstDate = sorted[0]?.date ?? null
    const lastDate = sorted[sorted.length - 1]?.date ?? null

    // Most used category (by expense count)
    const catCount: Record<string, number> = {}
    expenses.forEach((tx) => {
      catCount[tx.categoryId] = (catCount[tx.categoryId] ?? 0) + 1
    })
    const topCatId = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0]
    const topCat = data.categories.find((c) => c.id === topCatId)

    // Hottest spending month
    const monthTotals: Record<string, number> = {}
    expenses.forEach((tx) => {
      const d = parseDateLocal(tx.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthTotals[key] = (monthTotals[key] ?? 0) + tx.amount
    })
    const hottestMonth = Object.entries(monthTotals).sort((a, b) => b[1] - a[1])[0]

    // Biggest single expense
    const biggestExpense = [...expenses].sort((a, b) => b.amount - a.amount)[0]

    // Installment groups (unique parentIds)
    const parentIds = new Set(txs.map((tx) => tx.installment?.parentId).filter(Boolean))

    // Credit cards
    const creditAccounts = data.accounts.filter((a) => a.type === 'CREDIT')

    return {
      totalTx: txs.length,
      incomeCount: income.length,
      expenseCount: expenses.length,
      transferCount: transfers.length,
      creditPaymentCount: creditPayments.length,
      totalIncome,
      totalExpenses,
      firstDate,
      lastDate,
      topCat,
      topCatCount: topCatId ? catCount[topCatId] : 0,
      hottestMonth,
      biggestExpense,
      installmentGroups: parentIds.size,
      accountCount: data.accounts.length,
      categoryCount: data.categories.length,
      tagCount: data.tags.length,
      creditCardCount: creditAccounts.length,
      auditCount: data.auditLog.length,
    }
  }, [data])

  const formatMonthLabel = (key: string) => {
    const [year, month] = key.split('-')
    return new Date(Number(year), Number(month) - 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    })
  }

  if (!data || !usage) return null

  const generatedDate = devStats?.generatedAt
    ? new Date(devStats.generatedAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles size={20} strokeWidth={1.5} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-on-surface">{t('about.title')}</h1>
          <p className="text-sm text-on-surface/50">{t('about.subtitle')}</p>
        </div>
      </div>

      {/* ── Sua jornada: resumo rápido ── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-on-surface/40">
          {t('about.sectionUsage')}
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile
            icon={<BarChart3 size={14} strokeWidth={2} />}
            label={t('about.totalTx')}
            value={usage.totalTx.toLocaleString('pt-BR')}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<TrendingUp size={14} strokeWidth={2} />}
            label={t('about.totalIncome')}
            value={formatCurrency(usage.totalIncome)}
            sub={`${usage.incomeCount} ${t('about.entries')}`}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<TrendingDown size={14} strokeWidth={2} />}
            label={t('about.totalExpenses')}
            value={formatCurrency(usage.totalExpenses)}
            sub={`${usage.expenseCount} ${t('about.entries')}`}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<Repeat2 size={14} strokeWidth={2} />}
            label={t('about.transfers')}
            value={usage.transferCount.toLocaleString('pt-BR')}
            sub={
              usage.creditPaymentCount > 0
                ? `+ ${usage.creditPaymentCount} ${t('about.invoicePayments')}`
                : undefined
            }
            shadowClass={shadowClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile
            icon={<CalendarDays size={14} strokeWidth={2} />}
            label={t('about.firstTx')}
            value={
              usage.firstDate
                ? parseDateLocal(usage.firstDate).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'
            }
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<CalendarDays size={14} strokeWidth={2} />}
            label={t('about.lastTx')}
            value={
              usage.lastDate
                ? parseDateLocal(usage.lastDate).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'
            }
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<TrendingDown size={14} strokeWidth={2} />}
            label={t('about.hottestMonth')}
            value={usage.hottestMonth ? formatCurrency(usage.hottestMonth[1]) : '—'}
            sub={usage.hottestMonth ? formatMonthLabel(usage.hottestMonth[0]) : undefined}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<TrendingDown size={14} strokeWidth={2} />}
            label={t('about.biggestExpense')}
            value={usage.biggestExpense ? formatCurrency(usage.biggestExpense.amount) : '—'}
            sub={usage.biggestExpense?.description}
            shadowClass={shadowClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile
            icon={<Wallet size={14} strokeWidth={2} />}
            label={t('about.accounts')}
            value={usage.accountCount.toLocaleString('pt-BR')}
            sub={
              usage.creditCardCount > 0
                ? `${usage.creditCardCount} ${t('about.creditCards')}`
                : undefined
            }
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<Layers size={14} strokeWidth={2} />}
            label={t('about.categories')}
            value={usage.categoryCount.toLocaleString('pt-BR')}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<Tag size={14} strokeWidth={2} />}
            label={t('about.tags')}
            value={usage.tagCount.toLocaleString('pt-BR')}
            shadowClass={shadowClass}
          />
          <StatTile
            icon={<CreditCard size={14} strokeWidth={2} />}
            label={t('about.installmentGroups')}
            value={usage.installmentGroups.toLocaleString('pt-BR')}
            shadowClass={shadowClass}
          />
        </div>

        {usage.topCat && (
          <div
            className={cn(
              'rounded-2xl bg-surface-container p-5 flex items-center gap-4',
              shadowClass
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary text-lg">
              {usage.topCat.icon}
            </span>
            <div className="min-w-0">
              <p className="label text-on-surface/50">{t('about.topCategory')}</p>
              <p className="text-base font-semibold text-on-surface">{usage.topCat.name}</p>
              <p className="text-xs text-on-surface/40">
                {usage.topCatCount} {t('about.entries')}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Qualidade de código ── */}
      {devStats && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-on-surface/40">
              {t('about.sectionQuality')}
            </h2>
            {generatedDate && (
              <span className="text-xs text-on-surface/30">
                {t('about.generatedAt')} {generatedDate}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Testes */}
            <div className={cn('rounded-2xl bg-surface-container p-6 space-y-4', shadowClass)}>
              <div className="flex items-center gap-2">
                <FlaskConical size={16} strokeWidth={1.5} className="text-primary" />
                <p className="text-sm font-semibold text-on-surface">{t('about.testsTitle')}</p>
              </div>

              {devStats.unitTests && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-on-surface/60">{t('about.unitTests')}</span>
                    <div className="flex items-center gap-1.5">
                      {devStats.unitTests.failed === 0 ? (
                        <CheckCircle2 size={13} className="text-primary" />
                      ) : (
                        <XCircle size={13} className="text-tertiary" />
                      )}
                      <span className="text-xs font-semibold tabular-nums text-on-surface">
                        {devStats.unitTests.passed.toLocaleString('pt-BR')}
                        <span className="text-on-surface/40">
                          /{devStats.unitTests.total.toLocaleString('pt-BR')}
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface/40">
                    {devStats.unitTests.suites} {t('about.suites')}
                  </p>
                </div>
              )}

              {devStats.e2eTests && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface/60">{t('about.e2eTests')}</span>
                  <div className="flex items-center gap-1.5">
                    {devStats.e2eTests.failed === 0 ? (
                      <CheckCircle2 size={13} className="text-primary" />
                    ) : (
                      <XCircle size={13} className="text-tertiary" />
                    )}
                    <span className="text-xs font-semibold text-on-surface">
                      {devStats.e2eTests.status === 'passed'
                        ? t('about.allPassed')
                        : t('about.hasFailed')}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 pt-1 border-t border-outline-variant">
                <ShieldCheck size={13} className="text-primary" />
                <span className="text-xs text-on-surface/50">{t('about.auditLog')}: </span>
                <span className="text-xs font-semibold text-on-surface">
                  {usage.auditCount.toLocaleString('pt-BR')} {t('about.auditEntries')}
                </span>
              </div>
            </div>

            {/* Coverage */}
            {devStats.coverage && (
              <div className={cn('rounded-2xl bg-surface-container p-6 space-y-4', shadowClass)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch size={16} strokeWidth={1.5} className="text-primary" />
                    <p className="text-sm font-semibold text-on-surface">
                      {t('about.coverageTitle')}
                    </p>
                  </div>
                  {devStats.coverage.files !== null && (
                    <div className="flex items-center gap-1 text-on-surface/40">
                      <FileCode2 size={12} strokeWidth={1.5} />
                      <span className="text-xs">
                        {devStats.coverage.files} {t('about.files')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <CoverageBar
                    pct={devStats.coverage.statements.pct}
                    label={t('about.statements')}
                  />
                  <CoverageBar pct={devStats.coverage.branches.pct} label={t('about.branches')} />
                  <CoverageBar pct={devStats.coverage.functions.pct} label={t('about.functions')} />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-outline-variant">
                  {(['statements', 'branches', 'functions'] as const).map((key) => (
                    <div key={key} className="text-center">
                      <p
                        className={cn(
                          'text-lg font-bold tabular-nums',
                          pctColor(devStats.coverage![key].pct)
                        )}
                      >
                        {devStats.coverage![key].pct.toFixed(0)}%
                      </p>
                      <p className="text-[10px] text-on-surface/40">
                        {devStats.coverage![key].covered}/{devStats.coverage![key].total}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
