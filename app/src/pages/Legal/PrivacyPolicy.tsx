import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'

export default function PrivacyPolicy() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const sections = [
    { title: t('legal.privacy.s1Title'), body: t('legal.privacy.s1Body') },
    { title: t('legal.privacy.s2Title'), body: t('legal.privacy.s2Body') },
    { title: t('legal.privacy.s3Title'), body: t('legal.privacy.s3Body') },
    { title: t('legal.privacy.s4Title'), body: t('legal.privacy.s4Body') },
    { title: t('legal.privacy.s5Title'), body: t('legal.privacy.s5Body') },
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
            <Shield size={18} strokeWidth={1.5} className="text-primary" />
            <h1 className="text-xl font-bold text-on-surface">{t('legal.privacy.title')}</h1>
          </div>
          <p className="text-xs text-on-surface/40">{t('legal.privacy.lastUpdated')}</p>
          <p className="text-sm text-on-surface/70 leading-relaxed pt-1">
            {t('legal.privacy.intro')}
          </p>
        </div>

        <div className="space-y-3">
          {sections.map((s, i) => (
            <div key={i} className="rounded-2xl bg-surface-container p-6 space-y-2">
              <h2 className="text-sm font-semibold text-on-surface">{s.title}</h2>
              <p className="text-sm text-on-surface/70 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
