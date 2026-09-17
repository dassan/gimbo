import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, Search, SearchX, X } from 'lucide-react'
import { cn, formatCurrency, parseDateLocal } from '@/lib/utils'
import { GLOBAL_SEARCH_RESULT_LIMIT, searchTransactions, sumSignedAmount } from '@/lib/globalSearch'
import type { GlobalSearchPeriod } from '@/lib/globalSearch'
import { useDataStore } from '@/store/useDataStore'
import { useIsMobile } from '@/hooks/useIsMobile'
import MobileSheet from '@/components/MobileSheet'
import DatePicker from '@/components/DatePicker'

// M-105: busca global — desenho de front-end aprovado em 2026-09-17, motor de busca real
// (lib/globalSearch.ts) ligado na sequência, mesma sessão. Ver o comentário em
// lib/globalSearch.ts para o porquê do escopo (só INCOME/EXPENSE, sem accent-folding).

export interface GlobalSearchModalProps {
  open: boolean
  onClose: () => void
}

export default function GlobalSearchModal({ open, onClose }: GlobalSearchModalProps) {
  const { t, i18n } = useTranslation()
  const isMobile = useIsMobile()
  const inputRef = useRef<HTMLInputElement>(null)
  const periodMenuRef = useRef<HTMLDivElement>(null)

  const transactions = useDataStore((s) => s.data?.transactions ?? [])
  const categories = useDataStore((s) => s.data?.categories ?? [])
  const accounts = useDataStore((s) => s.data?.accounts ?? [])

  // Mesmo padrão do M-75: resolver mapas pequenos uma vez em vez de repassar o array inteiro
  // de categorias/contas (ou o DataFile inteiro) pra cada linha renderizada.
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<GlobalSearchPeriod>('all')
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // Reset the form fields when the modal transitions from closed to open. Adjusting state
  // during render (rather than in an effect) on a prop change is the pattern React itself
  // recommends for this exact case — see "Storing information from previous renders".
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setPeriod('all')
      setShowPeriodMenu(false)
      setCustomStart('')
      setCustomEnd('')
    }
  }

  useEffect(() => {
    if (open && !isMobile) inputRef.current?.focus()
  }, [open, isMobile])

  useEffect(() => {
    if (!showPeriodMenu) return
    function handler(e: MouseEvent) {
      if (periodMenuRef.current && !periodMenuRef.current.contains(e.target as Node)) {
        setShowPeriodMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPeriodMenu])

  const allResults = useMemo(
    () => searchTransactions(transactions, { query, period, customStart, customEnd }),
    [transactions, query, period, customStart, customEnd]
  )
  const results = useMemo(() => allResults.slice(0, GLOBAL_SEARCH_RESULT_LIMIT), [allResults])
  const total = useMemo(() => sumSignedAmount(allResults), [allResults])

  const periodLabel =
    period === 'all'
      ? t('search.period.all')
      : period === 'thisYear'
        ? t('search.period.thisYear')
        : period === 'lastYear'
          ? t('search.period.lastYear')
          : customStart && customEnd
            ? `${parseDateLocal(customStart).toLocaleDateString(i18n.language)} – ${parseDateLocal(customEnd).toLocaleDateString(i18n.language)}`
            : t('search.period.custom')

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  const content = (
    <div role="dialog" aria-modal="true" aria-label={t('search.title')} onKeyDown={handleKeyDown}>
      {/* Input row */}
      <div className="flex items-center gap-3 border-b border-outline-variant px-5 py-4">
        <Search size={18} strokeWidth={1.75} className="shrink-0 text-on-surface/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          className="flex-1 bg-transparent text-base text-on-surface outline-none placeholder:text-on-surface/40"
        />
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface/50 hover:bg-surface-container-high"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      {/* Period filter row */}
      <div
        ref={periodMenuRef}
        className="relative flex items-center gap-2 border-b border-outline-variant px-5 py-3"
      >
        <button
          onClick={() => setShowPeriodMenu((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface/70 transition-colors hover:bg-surface-container-low"
        >
          <Calendar size={13} strokeWidth={1.75} />
          {periodLabel}
        </button>

        {showPeriodMenu && (
          <div
            className="absolute left-5 top-full z-10 mt-2 w-56 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high py-1"
            style={{ boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' }}
            role="menu"
          >
            {(['all', 'thisYear', 'lastYear'] as const).map((opt) => (
              <button
                key={opt}
                role="menuitem"
                onClick={() => {
                  setPeriod(opt)
                  setShowPeriodMenu(false)
                }}
                className={cn(
                  'w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-container-low',
                  period === opt ? 'font-medium text-primary' : 'text-on-surface'
                )}
              >
                {t(`search.period.${opt}`)}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => setPeriod('custom')}
              className={cn(
                'w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-container-low',
                period === 'custom' ? 'font-medium text-primary' : 'text-on-surface'
              )}
            >
              {t('search.period.custom')}
            </button>

            {period === 'custom' && (
              <div className="space-y-2 px-4 pb-3 pt-1">
                <div className="flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2">
                  <DatePicker
                    ariaLabel="search-custom-start"
                    value={customStart}
                    onChange={setCustomStart}
                    className="flex-1 bg-transparent text-sm text-on-surface outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-surface-container-low px-3 py-2">
                  <DatePicker
                    ariaLabel="search-custom-end"
                    value={customEnd}
                    onChange={setCustomEnd}
                    className="flex-1 bg-transparent text-sm text-on-surface outline-none"
                  />
                </div>
                <button
                  onClick={() => setShowPeriodMenu(false)}
                  disabled={!customStart || !customEnd}
                  className="w-full rounded-xl bg-primary py-2 text-xs font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
                >
                  {t('transactions.applyPeriod')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="max-h-[50vh] overflow-y-auto">
        {query.trim().length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Search size={28} strokeWidth={1.5} className="text-on-surface/20" />
            <p className="text-sm text-on-surface/50">{t('search.emptyPrompt')}</p>
          </div>
        )}

        {query.trim().length > 0 && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <SearchX size={28} strokeWidth={1.5} className="text-on-surface/20" />
            <p className="text-sm text-on-surface/50">{t('search.noResults')}</p>
          </div>
        )}

        {results.length > 0 && (
          <ul>
            {results.map((r) => {
              const category = categoriesById.get(r.categoryId)
              const account = accountsById.get(r.accountId)
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-b border-outline-variant/50 px-5 py-3 last:border-0 hover:bg-surface-container-low"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">{r.description}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-on-surface/50">
                      <span className="shrink-0">
                        {parseDateLocal(r.date).toLocaleDateString(i18n.language)}
                      </span>
                      {category && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5"
                          style={{ backgroundColor: `${category.color}22`, color: category.color }}
                        >
                          {category.name}
                        </span>
                      )}
                      {account && <span className="truncate">{account.name}</span>}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold',
                      r.type === 'EXPENSE' ? 'text-tertiary' : 'text-primary'
                    )}
                  >
                    {r.type === 'EXPENSE' ? '−' : '+'}
                    {formatCurrency(r.amount)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {allResults.length > GLOBAL_SEARCH_RESULT_LIMIT && (
          <p className="px-5 py-3 text-center text-xs text-on-surface/40">
            {t('search.truncatedHint', {
              shown: results.length,
              total: allResults.length,
            })}
          </p>
        )}
      </div>

      {/* Aggregated total — líquido (INCOME soma, EXPENSE subtrai), sempre sobre TODOS os
          resultados encontrados (allResults), não só os que a lista corta pra renderizar. */}
      {allResults.length > 0 && (
        <div className="flex items-center justify-between border-t border-outline-variant px-5 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-on-surface/50">
            {t('search.total')}
          </span>
          <span
            className={cn('text-sm font-bold', total < 0 ? 'text-tertiary' : 'text-on-surface')}
          >
            {total < 0 ? '−' : ''}
            {formatCurrency(Math.abs(total))}
          </span>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <MobileSheet open={open} onClose={onClose} ariaLabel={t('search.title')}>
        {content}
      </MobileSheet>
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-surface-container shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  )
}
