// Configurações — subpágina de uma receita (BX-13, plan/BUDGETS.md §5.9.2).
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Sparkles } from 'lucide-react'

// Só existe uma receita hoje (Quadrantes) — a lista cresce quando uma segunda receita
// for proposta, sem precisar generalizar o schema (plan/BUDGETS.md §5.9.2).
const RECIPE_LABEL_KEYS: Record<string, string> = {
  quadrantes: 'budgets.quadrantesLabel',
}

export default function RecipeSettings() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug?: string }>()
  const labelKey = slug ? RECIPE_LABEL_KEYS[slug] : undefined

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

      {/* BX-12 (sugestão de meta por histórico) ainda não implementada — placeholder por ora. */}
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-container-lowest px-6 py-16 text-center shadow-card border-[0.5px] border-surface-container-high">
        <Sparkles size={32} strokeWidth={1.25} className="text-on-surface/25" />
        <p className="max-w-sm text-xs text-on-surface/40">{t('budgets.recipeNoConfigYet')}</p>
      </div>
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
