import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, ArrowLeft, FileJson, FolderOpen, HardDrive, Lock } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { createEmptyDataFile } from '@/lib/storage/schema'
import { storage } from '@/services/storage'
import { detectBrowserLocale } from '@/lib/storage/workspace'
import { cn } from '@/lib/utils'
import { saveBackupDirHandle } from '@/lib/backupDir'
import { getDeviceId } from '@/lib/cloudSync/deviceId'
import { createFolderProvider } from '@/lib/cloudSync/folderProvider'
import { mergeForSync } from '@/lib/cloudSync/merge'
import { setMultiDeviceEnabled } from '@/lib/cloudSync/multiDeviceMode'
import type { Locale } from '@/types'

type Tab = 'new' | 'import' | 'folder'
type Step = 'intro' | 'form'

export default function Onboarding() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const loadData = useDataStore((s) => s.loadData)
  const setLocale = useWorkspaceStore((s) => s.setLocale)

  const [step, setStep] = useState<Step>('intro')
  const [tab, setTab] = useState<Tab>('new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [locale, setLocaleState] = useState<Locale>(() => detectBrowserLocale())
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

  // S-17: second (or later) desktop joining a shared folder that already has a Fase 1
  // multi-device setup. Imports the first device-*.db found, merges the rest, then adopts the
  // folder and starts writing this device's own file — never anyone else's.
  async function handleRestoreFromFolder() {
    setFileError(null)
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const syncDir = await handle.getDirectoryHandle('gimbo').catch(() => null)
      if (!syncDir) {
        setFileError(t('onboarding.folderNoDevices'))
        return
      }

      const deviceFiles: FileSystemFileHandle[] = []
      for await (const entry of syncDir.values()) {
        if (entry.kind === 'file' && /^device-.+\.db$/.test(entry.name)) {
          deviceFiles.push(entry)
        }
      }
      if (deviceFiles.length === 0) {
        setFileError(t('onboarding.folderNoDevices'))
        return
      }

      const [first, ...rest] = deviceFiles
      await storage.importBlob(await first.getFile())

      for (const peerHandle of rest) {
        const result = await storage.readPeerBlob(await peerHandle.getFile())
        if (result.status !== 'ok') continue // unreadable/newer-schema peer — skip (S-20)
        const current = await storage.loadDataFile()
        if (!current) continue
        await storage.replaceAll(mergeForSync(current, result.data))
      }

      await saveBackupDirHandle(handle)
      setMultiDeviceEnabled(true)
      const deviceId = await getDeviceId()
      await createFolderProvider(deviceId).upload(await storage.exportBlob())

      const imported = await storage.loadDataFile()
      if (imported) loadData(imported)
      void navigate('/dashboard')
    } catch {
      setFileError(t('onboarding.folderImportError'))
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Main split layout */}
      <div className="flex flex-1">
        {/* ── Left editorial panel ── */}
        <div className="hidden lg:flex lg:w-[45%] flex-col justify-between bg-surface p-12 xl:p-16">
          <div>
            {/* Logo */}
            <GimboLogo />

            {/* Headline */}
            <h1 className="mt-8 text-5xl xl:text-6xl font-bold leading-[1.1] tracking-tight text-on-surface whitespace-pre-line">
              {t('onboarding.headline')}
            </h1>

            {/* Subtitle */}
            <p className="mt-6 text-base leading-relaxed text-on-surface/50 max-w-sm">
              {t('onboarding.subtitle')}
            </p>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="flex flex-1 flex-col items-center justify-center bg-surface-container-low p-6 lg:p-12">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <GimboLogo />
          </div>
          <div
            className="w-full max-w-md rounded-3xl bg-surface-container p-8"
            style={{ boxShadow: '0px 20px 60px rgba(0,0,0,0.3)' }}
          >
            {step === 'intro' ? (
              /* ── Local-first explainer ── */
              <div className="space-y-6">
                <div className="flex justify-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <HardDrive size={26} strokeWidth={1.5} />
                  </span>
                </div>

                <div className="space-y-2 text-center">
                  <h2 className="text-xl font-bold text-on-surface">
                    {t('onboarding.introTitle')}
                  </h2>
                  <p className="text-sm leading-relaxed text-on-surface/60">
                    {t('onboarding.introBody')}
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      icon: <HardDrive size={16} strokeWidth={1.5} />,
                      title: t('onboarding.introPoint1Title'),
                      body: t('onboarding.introPoint1Body'),
                    },
                    {
                      icon: <FileJson size={16} strokeWidth={1.5} />,
                      title: t('onboarding.introPoint2Title'),
                      body: t('onboarding.introPoint2Body'),
                    },
                    {
                      icon: <Lock size={16} strokeWidth={1.5} />,
                      title: t('onboarding.introPoint3Title'),
                      body: t('onboarding.introPoint3Body'),
                    },
                  ].map((point, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-2xl bg-surface-container-low p-4"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        {point.icon}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-on-surface">{point.title}</p>
                        <p className="text-xs leading-relaxed text-on-surface/50">{point.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setStep('form')}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
                >
                  {t('onboarding.introCta')}
                  <ArrowRight size={16} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <>
                {/* Back to explainer */}
                <button
                  onClick={() => setStep('intro')}
                  className="mb-4 flex items-center gap-1 text-xs text-on-surface/40 hover:text-on-surface/60 transition-colors"
                >
                  <ArrowLeft size={12} strokeWidth={2} />
                  {t('onboarding.introBack')}
                </button>

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
                  <TabButton
                    active={tab === 'folder'}
                    onClick={() => {
                      setTab('folder')
                      setFileError(null)
                    }}
                  >
                    {t('onboarding.tabFolder')}
                  </TabButton>
                </div>

                {tab === 'new' ? (
                  /* ── New profile form ── */
                  <div className="space-y-4">
                    <p className="text-xs text-on-surface/40">{t('onboarding.newDesc')}</p>
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
                ) : tab === 'import' ? (
                  /* ── Import form ── */
                  <div className="space-y-4">
                    <p className="text-xs text-on-surface/40">{t('onboarding.importDesc')}</p>
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
                ) : (
                  /* ── S-17: restore from a shared multi-device folder ── */
                  <div className="space-y-4">
                    <p className="text-xs text-on-surface/40">{t('onboarding.folderDesc')}</p>
                    <button
                      onClick={() => void handleRestoreFromFolder()}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
                    >
                      <FolderOpen size={16} strokeWidth={2} />
                      {t('onboarding.folderButton')}
                    </button>
                    {fileError && <p className="text-xs text-red-500">{fileError}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Global footer */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-6 text-xs text-on-surface/30">
        <span className="font-semibold">{t('onboarding.footer')}</span>
        <div className="flex gap-4">
          <Link to="/privacy" className="hover:text-on-surface/50 transition-colors">
            {t('onboarding.privacyPolicy')}
          </Link>
          <Link to="/terms" className="hover:text-on-surface/50 transition-colors">
            {t('onboarding.termsOfService')}
          </Link>
          <Link to="/origin" className="hover:text-on-surface/50 transition-colors">
            {t('onboarding.aboutName')}
          </Link>
        </div>
      </div>
    </div>
  )
}

function GimboLogo() {
  return (
    <div className="flex items-center gap-3">
      <svg
        width="40"
        height="40"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="48" height="48" rx="10" fill="#2D6A4F" />
        <text
          x="24"
          y="34"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="28"
          fontWeight="600"
          fill="#FFFFFF"
          textAnchor="middle"
        >
          G
        </text>
      </svg>
      <span className="text-2xl font-bold tracking-tight text-on-surface">Gimbo</span>
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
