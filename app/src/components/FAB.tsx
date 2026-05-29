import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FABProps {
  onClick: () => void
}

export default function FAB({ onClick }: FABProps) {
  const { t } = useTranslation()

  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-primary to-primary-container px-5 py-3 text-sm font-semibold text-white shadow-ambient transition-transform duration-150 active:scale-[0.97] hover:brightness-110"
    >
      <Plus size={18} strokeWidth={2.5} />
      {t('transactions.new')}
    </button>
  )
}
