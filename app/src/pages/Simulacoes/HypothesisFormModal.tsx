// Modal de hipótese — criação e edição. Mirrors BudgetFormModal's shell/fields, mas com uma
// lista de itens (cada um com campos condicionais por `kind`) em vez de um único conjunto de
// campos — uma hipótese nunca é uma Transaction/Account real (M-101, ver types/index.ts).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Plus, Trash2, X } from 'lucide-react'
import { cn, now, todayStr, uuid } from '@/lib/utils'
import { useDataStore } from '@/store/useDataStore'
import DatePicker from '@/components/DatePicker'
import type { Hypothesis, HypothesisItem, HypothesisItemKind } from '@/types'

function centsToStr(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

function makeEmptyItem(): HypothesisItem {
  return {
    id: uuid(),
    kind: 'ONE_TIME',
    description: '',
    type: 'EXPENSE',
    amount: 0,
    startDate: todayStr(),
  }
}

export interface HypothesisFormModalProps {
  onClose: () => void
  /** Ausente = criação; presente = edição, com os campos pré-preenchidos. */
  hypothesis?: Hypothesis
}

export default function HypothesisFormModal({ onClose, hypothesis }: HypothesisFormModalProps) {
  const { t } = useTranslation()
  const addHypothesis = useDataStore((s) => s.addHypothesis)
  const updateHypothesis = useDataStore((s) => s.updateHypothesis)
  const deleteHypothesis = useDataStore((s) => s.deleteHypothesis)
  const categories = useDataStore((s) => s.data?.categories ?? [])
  const isEdit = hypothesis !== undefined

  const [name, setName] = useState(hypothesis?.name ?? '')
  const [items, setItems] = useState<HypothesisItem[]>(hypothesis?.items ?? [makeEmptyItem()])
  // Confirmação de exclusão in-place — mesmo raciocínio de BudgetFormModal: empilhar um segundo
  // modal por cima deste custaria mais atenção do que a ação merece.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function patchItem(id: string, patch: Partial<HypothesisItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function addItem() {
    setItems((prev) => [...prev, makeEmptyItem()])
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function handleSave() {
    const cleanItems = items.filter((it) => it.amount > 0)
    if (isEdit) {
      updateHypothesis({ ...hypothesis, name: name.trim(), items: cleanItems })
    } else {
      addHypothesis({
        id: uuid(),
        name: name.trim(),
        enabled: true,
        items: cleanItems,
        createdAt: now(),
      })
    }
    onClose()
  }

  function handleDelete() {
    if (!hypothesis) return
    deleteHypothesis(hypothesis.id)
    onClose()
  }

  const fieldClass =
    'w-full rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30'
  const labelClass =
    'text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 block mb-2'

  return (
    <>
      <div className="fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="max-h-[90vh] w-full max-w-lg space-y-5 overflow-y-auto rounded-2xl bg-surface-container-low p-6 shadow-card-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-on-surface">
              {t(isEdit ? 'simulacoes.editTitle' : 'simulacoes.newTitle')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface/40 transition-colors hover:bg-surface-container-high"
            >
              <X size={16} />
            </button>
          </div>

          {/* Nome */}
          <div>
            <label className={labelClass} htmlFor="hypothesis-name">
              {t('simulacoes.name')}
            </label>
            <input
              id="hypothesis-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('simulacoes.namePlaceholder')}
              className={fieldClass}
            />
          </div>

          {/* Itens */}
          <div className="space-y-3">
            <span className={cn(labelClass, 'flex items-center gap-1.5')}>
              {t('simulacoes.itemsTitle')}
              <span className="group relative inline-flex">
                <Info
                  size={13}
                  strokeWidth={1.5}
                  className="cursor-help text-on-surface/40"
                  aria-hidden="true"
                />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 flex-col gap-2 rounded-xl bg-surface-container-high p-4 text-left normal-case tracking-normal font-normal shadow-lg group-hover:flex"
                >
                  {(
                    [
                      ['kindOneTime', 'kindOneTimeHint'],
                      ['kindInstallment', 'kindInstallmentHint'],
                      ['kindRecurring', 'kindRecurringHint'],
                      ['kindCategoryTarget', 'kindCategoryTargetHint'],
                    ] as const
                  ).map(([labelKey, hintKey]) => (
                    <p key={labelKey} className="text-[11px] leading-relaxed text-on-surface/70">
                      <span className="font-semibold text-on-surface">
                        {t(`simulacoes.${labelKey}`)}
                      </span>{' '}
                      — {t(`simulacoes.${hintKey}`)}
                    </p>
                  ))}
                </div>
              </span>
            </span>
            {items.map((item) => (
              <ItemEditor
                key={item.id}
                item={item}
                categories={categories}
                onChange={(patch) => patchItem(item.id, patch)}
                onRemove={() => removeItem(item.id)}
                canRemove={items.length > 1}
              />
            ))}
            <button
              type="button"
              onClick={addItem}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant py-2.5 text-xs font-medium text-on-surface/60 transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Plus size={14} strokeWidth={2} />
              {t('simulacoes.addItem')}
            </button>
          </div>

          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
          >
            {t(isEdit ? 'simulacoes.save' : 'simulacoes.create')}
          </button>

          {/* Zona destrutiva — separada do "Salvar" por uma divisória e com peso de link, para
              nunca competir com a ação primária. */}
          {isEdit &&
            (confirmingDelete ? (
              <div className="rounded-xl border-[0.5px] border-tertiary/30 bg-tertiary/5 p-4">
                <p className="text-sm font-semibold text-on-surface">
                  {t('simulacoes.deleteConfirmTitle')}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-on-surface/60">
                  {t('simulacoes.deleteConfirmBody')}
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
                    onClick={handleDelete}
                    className="rounded-xl bg-tertiary py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
                  >
                    {t('simulacoes.deleteConfirm')}
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
                  {t('simulacoes.delete')}
                </button>
              </div>
            ))}
        </div>
      </div>
    </>
  )
}

// ─── Editor de um item da hipótese ─────────────────────────────────────────────

interface ItemEditorProps {
  item: HypothesisItem
  categories: { id: string; name: string; type: 'INCOME' | 'EXPENSE' }[]
  onChange: (patch: Partial<HypothesisItem>) => void
  onRemove: () => void
  canRemove: boolean
}

const KIND_OPTIONS: HypothesisItemKind[] = [
  'ONE_TIME',
  'INSTALLMENT',
  'RECURRING',
  'CATEGORY_TARGET',
]

function ItemEditor({ item, categories, onChange, onRemove, canRemove }: ItemEditorProps) {
  const { t } = useTranslation()

  const fieldClass =
    'w-full rounded-xl bg-surface-container-lowest py-2.5 px-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30'
  const labelClass = 'text-[10px] font-medium text-on-surface/40 block mb-1'
  const segmentClass = (active: boolean) =>
    cn(
      'rounded-xl py-2 text-xs font-medium transition-colors',
      active
        ? 'bg-primary text-white'
        : 'bg-surface-container-lowest text-on-surface/60 hover:text-on-surface'
    )
  const kindLabel: Record<HypothesisItemKind, string> = {
    ONE_TIME: t('simulacoes.kindOneTime'),
    INSTALLMENT: t('simulacoes.kindInstallment'),
    RECURRING: t('simulacoes.kindRecurring'),
    CATEGORY_TARGET: t('simulacoes.kindCategoryTarget'),
  }
  const relevantCategories = categories.filter((c) => c.type === item.type)

  function handleKindChange(kind: HypothesisItemKind) {
    onChange({
      kind,
      // RECURRING v1 só suporta mensal (decisão de produto) — sem seletor de frequência na UI.
      frequency: kind === 'RECURRING' ? 'monthly' : undefined,
      installmentCount: kind === 'INSTALLMENT' ? (item.installmentCount ?? 2) : undefined,
      categoryId: kind === 'CATEGORY_TARGET' ? item.categoryId : undefined,
      endDate: kind === 'RECURRING' || kind === 'CATEGORY_TARGET' ? item.endDate : undefined,
    })
  }

  return (
    <div className="rounded-xl bg-surface-container-low p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={item.kind}
          onChange={(e) => handleKindChange(e.target.value as HypothesisItemKind)}
          aria-label={t('simulacoes.kind')}
          className={cn(fieldClass, 'flex-1')}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {kindLabel[k]}
            </option>
          ))}
        </select>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('simulacoes.removeItem')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-on-surface/40 transition-colors hover:bg-surface-container-high hover:text-tertiary"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['EXPENSE', 'INCOME'] as const).map((ty) => (
          <button
            key={ty}
            type="button"
            onClick={() => onChange({ type: ty, categoryId: undefined })}
            className={segmentClass(item.type === ty)}
          >
            {t(ty === 'EXPENSE' ? 'simulacoes.typeExpense' : 'simulacoes.typeIncome')}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>
            {t(
              item.kind === 'CATEGORY_TARGET'
                ? 'simulacoes.monthlyTarget'
                : item.kind === 'INSTALLMENT'
                  ? 'simulacoes.installmentAmount'
                  : 'simulacoes.amount'
            )}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface/40">
              R$
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={centsToStr(item.amount)}
              onChange={(e) => {
                const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
                onChange({ amount: cents / 100 })
              }}
              className={cn(fieldClass, 'pl-9')}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>{t('simulacoes.startDate')}</label>
          <DatePicker
            value={item.startDate}
            onChange={(v) => onChange({ startDate: v })}
            className={fieldClass}
          />
        </div>
      </div>

      {item.kind === 'INSTALLMENT' && (
        <div>
          <label className={labelClass}>{t('simulacoes.installmentCount')}</label>
          <input
            type="number"
            min={2}
            value={item.installmentCount ?? 2}
            onChange={(e) => onChange({ installmentCount: parseInt(e.target.value, 10) || 2 })}
            className={fieldClass}
          />
        </div>
      )}

      {(item.kind === 'RECURRING' || item.kind === 'CATEGORY_TARGET') && (
        <div>
          <label className={labelClass}>{t('simulacoes.endDateOptional')}</label>
          <DatePicker
            value={item.endDate ?? ''}
            onChange={(v) => onChange({ endDate: v || undefined })}
            className={fieldClass}
          />
        </div>
      )}

      {item.kind === 'CATEGORY_TARGET' && (
        <div>
          <label className={labelClass}>{t('simulacoes.category')}</label>
          <select
            value={item.categoryId ?? ''}
            onChange={(e) => onChange({ categoryId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">{t('simulacoes.categoryPlaceholder')}</option>
            {relevantCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
