import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Smartphone, MoreVertical, Share2, Store } from 'lucide-react'

export default function MobileInstall() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const platforms = [
    {
      icon: <MoreVertical size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('legal.mobileInstall.androidTitle'),
      steps: [
        t('legal.mobileInstall.androidStep1'),
        t('legal.mobileInstall.androidStep2'),
        t('legal.mobileInstall.androidStep3'),
        t('legal.mobileInstall.androidStep4'),
      ],
    },
    {
      icon: <Share2 size={16} strokeWidth={1.5} className="text-primary" />,
      title: t('legal.mobileInstall.iosTitle'),
      steps: [
        t('legal.mobileInstall.iosStep1'),
        t('legal.mobileInstall.iosStep2'),
        t('legal.mobileInstall.iosStep3'),
        t('legal.mobileInstall.iosStep4'),
      ],
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
            <Smartphone size={18} strokeWidth={1.5} className="text-primary" />
            <h1 className="text-xl font-bold text-on-surface">{t('legal.mobileInstall.title')}</h1>
          </div>
          <p className="text-sm text-on-surface/70 leading-relaxed pt-1">
            {t('legal.mobileInstall.intro')}
          </p>
        </div>

        <div className="space-y-3">
          {platforms.map((p, i) => (
            <div key={i} className="rounded-2xl bg-surface-container p-6 space-y-3">
              <div className="flex items-center gap-2">
                {p.icon}
                <h2 className="text-sm font-semibold text-on-surface">{p.title}</h2>
              </div>
              <ol className="space-y-2">
                {p.steps.map((step, j) => (
                  <li key={j} className="flex gap-3 text-sm leading-relaxed text-on-surface/70">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {j + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-surface-container p-6 space-y-2">
          <div className="flex items-center gap-2">
            <Store size={16} strokeWidth={1.5} className="text-on-surface/50" />
            <h2 className="text-sm font-semibold text-on-surface">
              {t('legal.mobileInstall.storeTitle')}
            </h2>
          </div>
          <p className="text-sm text-on-surface/70 leading-relaxed">
            {t('legal.mobileInstall.storeBody')}
          </p>
        </div>
      </div>
    </div>
  )
}
