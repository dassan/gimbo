// Configurações — subpágina de uma receita (BX-13, plan/BUDGETS.md §5.9.2).
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { cn } from '@/lib/utils'

// Só existe uma receita hoje (Quadrantes) — a lista cresce quando uma segunda receita
// for proposta, sem precisar generalizar o schema (plan/BUDGETS.md §5.9.2).
const RECIPE_LABEL_KEYS: Record<string, string> = {
  quadrantes: 'budgets.quadrantesLabel',
}

export default function RecipeSettings() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug?: string }>()
  const labelKey = slug ? RECIPE_LABEL_KEYS[slug] : undefined
  const data = useDataStore((s) => s.data)
  const setQuadrantesInferFromHistory = useDataStore((s) => s.setQuadrantesInferFromHistory)

  if (!labelKey) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        <BackLink />
        <p className="text-sm text-on-surface/40">{t('common.noData')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <BackLink />

      <div className="rounded-2xl bg-surface-container p-5 sm:p-6 shadow-card">
        <h1 className="text-xl font-semibold text-on-surface">{t(labelKey)}</h1>
      </div>

      {slug === 'quadrantes' && (
        <div className="rounded-2xl bg-surface-container px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-on-surface">{t('budgets.quadrantesInferLabel')}</p>
              <p className="text-xs text-on-surface/40 mt-0.5">
                {t('budgets.quadrantesInferHint')}
              </p>
            </div>
            <button
              onClick={() =>
                setQuadrantesInferFromHistory(!data?.settings.quadrantesInferFromHistory)
              }
              aria-label={t('budgets.quadrantesInferLabel')}
              aria-pressed={data?.settings.quadrantesInferFromHistory ?? false}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
                data?.settings.quadrantesInferFromHistory
                  ? 'bg-primary'
                  : 'bg-surface-container-high'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5',
                  data?.settings.quadrantesInferFromHistory ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/preferences"
      className="inline-flex items-center gap-2 text-sm text-on-surface/50 transition-colors hover:text-on-surface"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-low">
        <ChevronLeft size={16} />
      </span>
      {t('budgets.backToPreferences')}
    </Link>
  )
}
