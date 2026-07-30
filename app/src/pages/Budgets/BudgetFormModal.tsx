// Modal de caixinha — criação e edição. PROTÓTIPO: o botão de confirmar apenas
// fecha o modal, nenhuma mutação de dados acontece. Ver nota em `mock.ts`.
//
// Criar e editar compartilham os mesmos campos; no modo edição o tipo
// (despesa/receita) e o emoji ficam de fora — mudar o tipo de uma caixinha que
// já tem lançamentos associados inverteria o sentido de todos eles.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import DatePicker from '@/components/DatePicker'
import type { BudgetKind, MockBudget } from './mock'

const EMOJI_OPTIONS = ['🎯', '✈️', '🎁', '🔨', '🚗', '🏠', '💼', '📚', '🐾']

function centsToStr(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

export interface BudgetFormModalProps {
  onClose: () => void
  /** Ausente = criação; presente = edição, com os campos pré-preenchidos. */
  budget?: MockBudget
}

export default function BudgetFormModal({ onClose, budget }: BudgetFormModalProps) {
  const { t } = useTranslation()
  const isEdit = budget !== undefined

  const today = new Date().toISOString().slice(0, 10)
  const [name, setName] = useState(budget?.name ?? '')
  const [emoji, setEmoji] = useState(budget?.emoji ?? EMOJI_OPTIONS[0])
  const [kind, setKind] = useState<BudgetKind>(budget?.kind ?? 'expense')
  const [amountStr, setAmountStr] = useState(budget ? centsToStr(budget.target) : '0,00')
  const [periodMode, setPeriodMode] = useState<'date' | 'range'>(budget?.period.mode ?? 'range')
  // Confirmação de exclusão in-place: empilhar um segundo modal por cima deste
  // custaria mais atenção do que a ação merece.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [start, setStart] = useState(budget?.period.mode === 'range' ? budget.period.start : today)
  const [end, setEnd] = useState(
    budget === undefined
      ? today
      : budget.period.mode === 'range'
        ? budget.period.end
        : budget.period.date
  )

  function handleAmountInput(e: React.ChangeEvent<HTMLInputElement>) {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setAmountStr(centsToStr(cents / 100))
  }

  const fieldClass =
    'w-full rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30'
  const labelClass =
    'text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 block mb-2'
  const segmentClass = (active: boolean) =>
    cn(
      'rounded-xl py-2.5 text-sm font-medium transition-colors',
      active
        ? 'bg-primary text-white'
        : 'bg-surface-container-low text-on-surface/60 hover:text-on-surface'
    )

  return (
    <>
      <div className="fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl bg-surface-container-low p-6 shadow-card-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-on-surface">
              {t(isEdit ? 'budgets.editTitle' : 'budgets.newTitle')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface/40 transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tipo: despesa (teto de gasto) ou receita (meta a atingir) */}
          {!isEdit && (
            <div>
              <span className={labelClass}>{t('budgets.kind')}</span>
              <div className="grid grid-cols-2 gap-2">
                {(['expense', 'income'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={segmentClass(kind === k)}
                  >
                    {t(k === 'income' ? 'budgets.kindIncome' : 'budgets.kindExpense')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nome (+ emoji, só na criação) */}
          <div>
            <label className={labelClass} htmlFor="budget-name">
              {t('budgets.name')}
            </label>
            <input
              id="budget-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('budgets.namePlaceholder')}
              className={fieldClass}
            />
            {!isEdit && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EMOJI_OPTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    aria-label={e}
                    aria-pressed={emoji === e}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl text-base transition-colors',
                      emoji === e
                        ? 'bg-primary/15 ring-2 ring-primary/40'
                        : 'bg-surface-container-low hover:bg-surface-container-high'
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Meta */}
          <div>
            <label className={labelClass} htmlFor="budget-amount">
              {t('budgets.target')}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface/40">
                R$
              </span>
              <input
                id="budget-amount"
                type="text"
                inputMode="numeric"
                value={amountStr}
                onChange={handleAmountInput}
                className={cn(fieldClass, 'pl-9')}
              />
            </div>
          </div>

          {/* Período: data única ou intervalo */}
          <div>
            <span className={labelClass}>{t('budgets.period')}</span>
            {/* Só existem dois modos — segmentado, igual à escolha de tipo acima */}
            <div className="grid grid-cols-2 gap-2">
              {(['range', 'date'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeriodMode(mode)}
                  className={segmentClass(periodMode === mode)}
                >
                  {t(mode === 'range' ? 'budgets.periodRange' : 'budgets.periodDate')}
                </button>
              ))}
            </div>

            <div className={cn('mt-2 gap-2', periodMode === 'range' ? 'grid grid-cols-2' : '')}>
              {periodMode === 'range' && (
                <div>
                  <p className="mb-1 text-[10px] text-on-surface/40">{t('budgets.periodStart')}</p>
                  <DatePicker value={start} onChange={setStart} className={fieldClass} />
                </div>
              )}
              <div>
                <p className="mb-1 text-[10px] text-on-surface/40">
                  {t(periodMode === 'range' ? 'budgets.periodEnd' : 'budgets.periodTargetDate')}
                </p>
                <DatePicker value={end} onChange={setEnd} className={fieldClass} />
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
          >
            {t(isEdit ? 'budgets.save' : 'budgets.create')}
          </button>
          <p className="text-center text-[11px] text-on-surface/40">{t('budgets.prototypeNote')}</p>

          {/* Zona destrutiva — separada do "Salvar" por uma divisória e com peso
              de link, para nunca competir com a ação primária. */}
          {isEdit &&
            (confirmingDelete ? (
              <div className="rounded-xl border-[0.5px] border-tertiary/30 bg-tertiary/5 p-4">
                <p className="text-sm font-semibold text-on-surface">
                  {t('budgets.deleteConfirmTitle')}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-on-surface/60">
                  {t('budgets.deleteConfirmBody', {
                    count: budget.transactions.length,
                  })}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-xl bg-surface-container-high py-2.5 text-sm font-medium text-on-surface/70 transition-colors hover:text-on-surface"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl bg-tertiary py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
                  >
                    {t('budgets.deleteConfirm')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t-[0.5px] border-surface-container-high pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="flex items-center gap-2 text-xs font-medium text-tertiary transition-opacity hover:opacity-80"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  {t('budgets.delete')}
                </button>
              </div>
            ))}
        </div>
      </div>
    </>
  )
}
