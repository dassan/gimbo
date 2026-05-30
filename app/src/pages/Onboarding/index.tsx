import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Lock, ArrowRight, FileJson } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { createEmptyDataFile } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import { cn } from '@/lib/utils'
import type { Locale } from '@/types'

type Tab = 'new' | 'import'

export default function Onboarding() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const loadData = useDataStore((s) => s.loadData)
  const setLocale = useWorkspaceStore((s) => s.setLocale)

  const [tab, setTab] = useState<Tab>('new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [locale, setLocaleState] = useState<Locale>('pt-BR')
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleCreate() {
    if (!name.trim()) return
    setFileError(null)
    const data = createEmptyDataFile(name.trim(), email.trim())
    await storage.replaceAll(data)
    loadData(data)
    setLocale(locale)
    void i18n.changeLanguage(locale)
    localStorage.setItem('gimbo_welcome_pending', 'true')
    void navigate('/dashboard')
  }

  async function handleImportFile(file: File) {
    setFileError(null)
    try {
      await storage.importBlob(file)
      const imported = await storage.loadDataFile()
      if (imported) loadData(imported)
      void navigate('/dashboard')
    } catch {
      setFileError(t('onboarding.importFileError'))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleImportFile(file)
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Main split layout */}
      <div className="flex flex-1">
        {/* ── Left editorial panel ── */}
        <div className="hidden lg:flex lg:w-[45%] flex-col justify-between bg-surface p-12 xl:p-16">
          <div>
            {/* Security badge */}
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5">
              <ShieldCheck size={13} className="text-primary" strokeWidth={2} />
              <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                {t('onboarding.securityBadge')}
              </span>
            </div>

            {/* Headline */}
            <h1 className="mt-8 text-5xl xl:text-6xl font-bold leading-[1.1] tracking-tight text-on-surface whitespace-pre-line">
              {t('onboarding.headline')}
            </h1>

            {/* Subtitle */}
            <p className="mt-6 text-base leading-relaxed text-on-surface/50 max-w-sm">
              {t('onboarding.subtitle')}
            </p>

            {/* Feature bullet */}
            <div className="mt-10 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Lock size={14} className="text-primary" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  {t('onboarding.privacyFeature')}
                </p>
                <p className="mt-0.5 text-sm text-on-surface/50">
                  {t('onboarding.privacyFeatureDesc')}
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-on-surface/30">
            <span className="font-semibold">{t('onboarding.footer')}</span>
            <div className="flex gap-4">
              <span className="cursor-default hover:text-on-surface/50 transition-colors">
                {t('onboarding.privacyPolicy')}
              </span>
              <span className="cursor-default hover:text-on-surface/50 transition-colors">
                {t('onboarding.securityWhitepaper')}
              </span>
              <span className="cursor-default hover:text-on-surface/50 transition-colors">
                {t('onboarding.termsOfService')}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="flex flex-1 items-center justify-center bg-surface-container-low p-6 lg:p-12">
          <div
            className="w-full max-w-md rounded-3xl bg-surface-container p-8"
            style={{ boxShadow: '0px 20px 60px rgba(0,0,0,0.3)' }}
          >
            {/* Tabs */}
            <div className="flex rounded-full bg-surface-container-low p-1 mb-8">
              <TabButton
                active={tab === 'new'}
                onClick={() => {
                  setTab('new')
                  setFileError(null)
                }}
              >
                {t('onboarding.tabNew')}
              </TabButton>
              <TabButton
                active={tab === 'import'}
                onClick={() => {
                  setTab('import')
                  setFileError(null)
                }}
              >
                {t('onboarding.tabImport')}
              </TabButton>
            </div>

            {tab === 'new' ? (
              /* ── New profile form ── */
              <div className="space-y-4">
                <div>
                  <label className="label text-on-surface/40 block mb-1.5">
                    {t('onboarding.name')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('onboarding.namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
                    className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div>
                  <label className="label text-on-surface/40 block mb-1.5">
                    {t('onboarding.email')}
                  </label>
                  <input
                    type="email"
                    placeholder={t('onboarding.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
                    className="w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div>
                  <label className="label text-on-surface/40 block mb-1.5">
                    {t('onboarding.language')}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base">
                      {locale === 'pt-BR' ? '🇧🇷' : '🇺🇸'}
                    </span>
                    <select
                      value={locale}
                      onChange={(e) => {
                        const l = e.target.value as Locale
                        setLocaleState(l)
                        void i18n.changeLanguage(l)
                      }}
                      className="w-full appearance-none rounded-xl bg-surface-container-high py-3 pl-10 pr-4 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="pt-BR">Português (Brasil)</option>
                      <option value="en-US">English (US)</option>
                    </select>
                  </div>
                </div>

                <p className="text-xs text-on-surface/40 pt-1">{t('onboarding.createHint')}</p>

                {fileError && <p className="text-xs text-red-500">{fileError}</p>}

                <button
                  onClick={() => void handleCreate()}
                  disabled={!name.trim()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
                >
                  {t('onboarding.create')}
                  <ArrowRight size={16} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              /* ── Import form ── */
              <div className="space-y-4">
                {/* Drop zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 transition-colors',
                    dragging
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant bg-surface hover:border-primary/50 hover:bg-surface-container-low'
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                    <FileJson size={24} className="text-primary" strokeWidth={1.5} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-on-surface">
                      {t('onboarding.importDrop')}
                    </p>
                    <p className="mt-1 text-xs text-on-surface/40">
                      {t('onboarding.importDropSub')}
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".db"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) void handleImportFile(e.target.files[0])
                    }}
                  />
                </div>

                {fileError && <p className="text-xs text-red-500">{fileError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-full py-2 text-sm font-medium transition-all',
        active
          ? 'bg-surface-container-high text-on-surface shadow-sm'
          : 'text-on-surface/40 hover:text-on-surface/60'
      )}
    >
      {children}
    </button>
  )
}
