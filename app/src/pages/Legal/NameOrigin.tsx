import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, ExternalLink } from 'lucide-react'

export default function NameOrigin() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const sections = [
    { title: t('legal.origin.s1Title'), body: t('legal.origin.s1Body') },
    { title: t('legal.origin.s2Title'), body: t('legal.origin.s2Body') },
  ]

  const sources = [
    { label: t('legal.origin.source1Label'), url: 'https://www.dicio.com.br/gimbo/' },
    {
      label: t('legal.origin.source2Label'),
      url: 'https://www.campograndenews.com.br/colunistas/em-pauta/jimbo-e-florim-a-aventura-do-dinheiro-no-brasil',
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
            <BookOpen size={18} strokeWidth={1.5} className="text-primary" />
            <h1 className="text-xl font-bold text-on-surface">{t('legal.origin.title')}</h1>
          </div>
          <p className="text-sm text-on-surface/70 leading-relaxed pt-1">
            {t('legal.origin.intro')}
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

        <div className="rounded-2xl bg-surface-container p-6 space-y-3">
          <h2 className="text-sm font-semibold text-on-surface">{t('legal.origin.videoTitle')}</h2>
          <div className="aspect-video w-full overflow-hidden rounded-xl">
            <iframe
              className="h-full w-full"
              src="https://www.youtube.com/embed/Z7cBYUMCAA8"
              title="Jorge Ben Jor - Gimbo (Sacode a Poeira)"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>

        <div className="rounded-2xl bg-surface-container p-6 space-y-2">
          <h2 className="text-sm font-semibold text-on-surface">
            {t('legal.origin.sourcesTitle')}
          </h2>
          <ul className="space-y-1.5">
            {sources.map((src) => (
              <li key={src.url}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {src.label}
                  <ExternalLink size={13} strokeWidth={1.5} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
