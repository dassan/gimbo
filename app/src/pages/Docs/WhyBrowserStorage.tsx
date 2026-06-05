import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { cn } from '@/lib/utils'
import { ShieldAlert, HardDrive, FolderSync } from 'lucide-react'

export default function WhyBrowserStorage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )

  const sections = [
    {
      icon: <HardDrive size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('docs.whyBrowserStorage.section1Title'),
      body: t('docs.whyBrowserStorage.section1Body'),
    },
    {
      icon: <ShieldAlert size={16} strokeWidth={1.5} className="text-tertiary" />,
      title: t('docs.whyBrowserStorage.section2Title'),
      body: t('docs.whyBrowserStorage.section2Body'),
    },
    {
      icon: <FolderSync size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('docs.whyBrowserStorage.section3Title'),
      body: t('docs.whyBrowserStorage.section3Body'),
    },
  ]

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <button
        onClick={() => void navigate(-1)}
        className="text-sm text-on-surface/50 hover:text-on-surface transition-colors"
      >
        {t('docs.back')}
      </button>

      <div className={cn('rounded-2xl bg-surface-container p-6 space-y-1', shadowClass)}>
        <h1 className="text-xl font-bold text-on-surface">{t('docs.whyBrowserStorage.title')}</h1>
        <p className="text-sm text-on-surface/50">{t('docs.whyBrowserStorage.subtitle')}</p>
      </div>

      <div className="space-y-4">
        {sections.map((s, i) => (
          <div
            key={i}
            className={cn('rounded-2xl bg-surface-container p-6 space-y-2', shadowClass)}
          >
            <div className="flex items-center gap-2">
              {s.icon}
              <h2 className="text-sm font-semibold text-on-surface">{s.title}</h2>
            </div>
            <p className="text-sm text-on-surface/70 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      <button
        onClick={() => void navigate('/settings')}
        className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
      >
        {t('docs.whyBrowserStorage.cta')}
      </button>
    </div>
  )
}
