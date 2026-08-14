import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, WifiOff, FileJson, Info } from 'lucide-react'

export default function WhyLocalStorage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const sections = [
    {
      icon: <ShieldCheck size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('legal.whyLocal.s1Title'),
      body: t('legal.whyLocal.s1Body'),
    },
    {
      icon: <WifiOff size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('legal.whyLocal.s2Title'),
      body: t('legal.whyLocal.s2Body'),
    },
    {
      icon: <FileJson size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('legal.whyLocal.s3Title'),
      body: t('legal.whyLocal.s3Body'),
    },
    {
      icon: <Info size={16} strokeWidth={1.5} className="text-tertiary" />,
      title: t('legal.whyLocal.s4Title'),
      body: t('legal.whyLocal.s4Body'),
    },
  ]

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        <button
          onClick={() => void navigate(-1)}
          className="text-sm text-on-surface/50 hover:text-on-surface transition-colors"
        >
          {t('legal.back')}
        </button>

        <div className="rounded-2xl bg-surface-container p-6 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} strokeWidth={1.5} className="text-primary" />
            <h1 className="text-xl font-bold text-on-surface">{t('legal.whyLocal.title')}</h1>
          </div>
          <p className="text-sm text-on-surface/70 leading-relaxed pt-1">
            {t('legal.whyLocal.intro')}
          </p>
        </div>

        <div className="space-y-3">
          {sections.map((s, i) => (
            <div key={i} className="rounded-2xl bg-surface-container p-6 space-y-2">
              <div className="flex items-center gap-2">
                {s.icon}
                <h2 className="text-sm font-semibold text-on-surface">{s.title}</h2>
              </div>
              <p className="text-sm text-on-surface/70 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
