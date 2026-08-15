import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FlaskConical, FolderSync, ShieldAlert, X } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { isDemoMode } from '@/lib/demo'
import { useTrackNavigation } from '@/hooks/useTrackNavigation'
import { loadBackupDirHandle, clearBackupDirHandle } from '@/lib/backupDir'
import { isMultiDeviceEnabled } from '@/lib/cloudSync/multiDeviceMode'
import {
  initiateGoogleAuth,
  isGoogleConnected,
  googleNeedsReconnect,
} from '@/lib/cloudSync/googleAuth'
import Navbar from '@/components/Navbar'
import FAB from '@/components/FAB'
import TransactionDrawer from '@/components/TransactionDrawer'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import WelcomeModal from '@/components/WelcomeModal'
import type { Transaction } from '@/types'

export interface AppLayoutContext {
  openTransactionDrawer: (tx?: Transaction) => void
}

const NO_FAB_ROUTES = ['/settings']

export default function AppLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined)
  const [backupPermState, setBackupPermState] = useState<'prompt' | 'denied' | null>(null)
  const [backupHandle, setBackupHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [showWelcome, setShowWelcome] = useState(
    () =>
      localStorage.getItem('gimbo_welcome_pending') === 'true' &&
      localStorage.getItem('gimbo_welcome_dismissed') !== 'true'
  )
  const location = useLocation()

  useTrackNavigation()

  useEffect(() => {
    async function checkBackupPermission() {
      const handle = await loadBackupDirHandle()
      if (!handle) return
      setBackupHandle(handle)
      const perm = await handle.queryPermission({ mode: 'readwrite' })
      if (perm === 'prompt' || perm === 'denied') setBackupPermState(perm)
    }
    void checkBackupPermission()
  }, [])

  async function handleReconnectBackup() {
    if (!backupHandle) return
    const perm = await backupHandle.requestPermission({ mode: 'readwrite' })
    if (perm === 'granted') setBackupPermState(null)
  }

  async function handleClearBackup() {
    await clearBackupDirHandle()
    setBackupHandle(null)
    setBackupPermState(null)
  }

  // Usability follow-up: multi-device sync going 'offline' is almost always a lapsed folder
  // permission (same root cause as backupPermState above) — surface the same "click to
  // reconnect" affordance instead of leaving the user to notice a stale badge in Settings.
  const [multiDeviceBannerDismissed, setMultiDeviceBannerDismissed] = useState(false)
  const syncStatus = useDataStore((s) => s.syncStatus)
  const runPeerSync = useDataStore((s) => s.runPeerSync)

  async function handleReconnectMultiDeviceSync() {
    const handle = backupHandle ?? (await loadBackupDirHandle())
    if (!handle) return
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm === 'granted') await runPeerSync()
  }

  // CS-09: Google's refresh token can fail (revoked elsewhere, expired — S-15). googleAuth.ts
  // keeps the connection "configured" in that case and flags needsReconnect instead of silently
  // dropping it, so this banner can offer a one-click reconnect via the OAuth flow.
  const [googleBannerDismissed, setGoogleBannerDismissed] = useState(false)
  const googleReconnectNeeded = isGoogleConnected() && googleNeedsReconnect()

  const data = useDataStore((s) => s.data)

  // Exactly one reconnect banner shows at a time — they all share the same root-cause slot
  // (fixed top-14) and would otherwise stack when multiple transports degrade simultaneously.
  // Google takes priority since it's the transport CS-07 prefers when both are configured.
  const showGoogleBanner =
    !isDemoMode() && !backupPermState && googleReconnectNeeded && !googleBannerDismissed
  const showMultiDeviceBanner =
    !isDemoMode() &&
    !backupPermState &&
    !showGoogleBanner &&
    isMultiDeviceEnabled() &&
    syncStatus === 'offline' &&
    !multiDeviceBannerDismissed

  async function handleReconnectGoogle() {
    await initiateGoogleAuth() // navigates away; Settings resumes the flow on redirect back
  }

  const showFAB = !NO_FAB_ROUTES.some((r) => location.pathname.startsWith(r))

  function openTransactionDrawer(tx?: Transaction) {
    setEditingTx(tx)
    setDrawerOpen(true)
  }

  function handleDrawerClose() {
    setDrawerOpen(false)
    setEditingTx(undefined)
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Navbar: desktop top bar + mobile bottom nav.
          onNewTransaction wires the bottom nav + button to the same drawer. */}
      <Navbar vaultName={data?.user.name} onNewTransaction={() => openTransactionDrawer()} />

      {isDemoMode() && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-2 bg-amber-400 px-6 py-2.5 text-xs font-medium text-amber-950">
          <FlaskConical size={14} strokeWidth={2} className="shrink-0" />
          <span>{t('demo.banner')}</span>
        </div>
      )}

      {!isDemoMode() && backupPermState === 'prompt' && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-3 bg-amber-400 px-4 py-2.5 text-xs font-medium text-amber-950">
          <FolderSync size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1 text-center">{t('settings.backupReconnectBanner')}</span>
          <button
            onClick={() => void handleReconnectBackup()}
            className="rounded-md bg-amber-950/15 px-2.5 py-1 font-semibold hover:bg-amber-950/25 transition-colors shrink-0"
          >
            {t('settings.backupReconnect')}
          </button>
          <button onClick={() => setBackupPermState(null)} className="shrink-0 hover:opacity-70">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {!isDemoMode() && backupPermState === 'denied' && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-3 bg-tertiary/90 px-4 py-2.5 text-xs font-medium text-white">
          <ShieldAlert size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1 text-center">{t('settings.backupDeniedBanner')}</span>
          <button
            onClick={() => {
              void handleClearBackup()
              void navigate('/settings')
            }}
            className="rounded-md bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25 transition-colors shrink-0"
          >
            {t('settings.backupClearFolder')}
          </button>
          <button onClick={() => setBackupPermState(null)} className="shrink-0 hover:opacity-70">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Usability follow-up: 'offline' almost always means the shared-folder permission
          lapsed — mutually exclusive with the banners above, which already cover that root
          cause for the plain Nível 1 backup dir. */}
      {showMultiDeviceBanner && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-3 bg-amber-400 px-4 py-2.5 text-xs font-medium text-amber-950">
          <FolderSync size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1 text-center">{t('settings.multiDeviceReconnectBanner')}</span>
          <button
            onClick={() => void handleReconnectMultiDeviceSync()}
            className="rounded-md bg-amber-950/15 px-2.5 py-1 font-semibold hover:bg-amber-950/25 transition-colors shrink-0"
          >
            {t('settings.multiDeviceReconnect')}
          </button>
          <button
            onClick={() => setMultiDeviceBannerDismissed(true)}
            className="shrink-0 hover:opacity-70"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* CS-09: Google refresh-token failure (S-15) — same "click to reconnect" affordance. */}
      {showGoogleBanner && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center justify-center gap-3 bg-amber-400 px-4 py-2.5 text-xs font-medium text-amber-950">
          <FolderSync size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1 text-center">{t('settings.googleReconnectBanner')}</span>
          <button
            onClick={() => void handleReconnectGoogle()}
            className="rounded-md bg-amber-950/15 px-2.5 py-1 font-semibold hover:bg-amber-950/25 transition-colors shrink-0"
          >
            {t('settings.googleReconnect')}
          </button>
          <button
            onClick={() => setGoogleBannerDismissed(true)}
            className="shrink-0 hover:opacity-70"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* max-sm: compensate for the full nav height (h-16 = 4rem + device safe area).
          On desktop (sm+) the bottom nav is hidden, so no padding needed. */}
      <main
        className={`flex-1 max-sm:pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0 ${
          isDemoMode() || backupPermState || showMultiDeviceBanner || showGoogleBanner
            ? 'pt-24'
            : 'pt-14'
        }`}
      >
        <ErrorBoundary fallback="card">
          <Outlet context={{ openTransactionDrawer } satisfies AppLayoutContext} />
        </ErrorBoundary>
      </main>

      {/* FAB: desktop only — mobile uses the + button in the bottom nav (MB-02) */}
      {showFAB && (
        <div className="hidden sm:block">
          <FAB onClick={() => openTransactionDrawer()} />
        </div>
      )}

      <TransactionDrawer open={drawerOpen} onClose={handleDrawerClose} transaction={editingTx} />

      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
  )
}
