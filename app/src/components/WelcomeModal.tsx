import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'

const DISMISSED_KEY = 'gimbo_welcome_dismissed'
const PENDING_KEY = 'gimbo_welcome_pending'

interface Props {
  onClose: () => void
}

export default function WelcomeModal({ onClose }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dontShow, setDontShow] = useState(true)

  function dismiss() {
    if (dontShow) localStorage.setItem(DISMISSED_KEY, 'true')
    localStorage.removeItem(PENDING_KEY)
    onClose()
  }

  function handleConfigureBackup() {
    if (dontShow) localStorage.setItem(DISMISSED_KEY, 'true')
    localStorage.removeItem(PENDING_KEY)
    onClose()
    navigate('/settings', { state: { section: 'backup' } })
  }

  function handleDocLink() {
    if (dontShow) localStorage.setItem(DISMISSED_KEY, 'true')
    localStorage.removeItem(PENDING_KEY)
    onClose()
    navigate('/docs/why-browser-storage')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-surface-container shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary/10 px-6 pt-7 pb-5">
          <div className="flex items-center gap-3 mb-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <ShieldCheck size={20} strokeWidth={1.5} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-on-surface">{t('welcome.title')}</h2>
              <p className="text-sm text-on-surface/50">{t('welcome.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Privacy section */}
          <div className="rounded-2xl bg-surface-container-low p-4 space-y-1">
            <p className="text-sm font-semibold text-on-surface">{t('welcome.privacyTitle')}</p>
            <p className="text-sm text-on-surface/60 leading-relaxed">{t('welcome.privacyBody')}</p>
          </div>

          {/* Risk warning */}
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/8 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} strokeWidth={2} className="text-amber-500 shrink-0" />
              <p className="text-sm font-semibold text-on-surface">{t('welcome.riskTitle')}</p>
            </div>
            <p className="text-sm text-on-surface/60 leading-relaxed">{t('welcome.riskBody')}</p>
            <button onClick={handleDocLink} className="text-xs text-primary hover:underline">
              {t('welcome.riskLink')}
            </button>
          </div>

          {/* Don't show again */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <span className="text-xs text-on-surface/50">{t('welcome.dontShow')}</span>
          </label>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          <button
            onClick={handleConfigureBackup}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-on-primary hover:opacity-90 transition-opacity"
          >
            <HardDrive size={15} strokeWidth={2} />
            {t('welcome.cta')}
          </button>
          <button
            onClick={dismiss}
            className={cn(
              'w-full rounded-2xl py-2.5 text-sm font-medium text-on-surface/50',
              'hover:bg-surface-container-high transition-colors'
            )}
          >
            {t('welcome.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
