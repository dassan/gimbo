import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FlaskConical, FolderSync, ShieldAlert, X } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { isDemoMode } from '@/lib/demo'
import { useTrackNavigation } from '@/hooks/useTrackNavigation'
import { loadBackupDirHandle, clearBackupDirHandle } from '@/lib/backupDir'
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

  const data = useDataStore((s) => s.data)

  const showFAB = !NO_FAB_ROUTES.some((r) => location.pathname.startsWith(r))

  const initials = data?.user.name
    ? data.user.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

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
      <Navbar initials={initials} onNewTransaction={() => openTransactionDrawer()} />

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
              navigate('/settings')
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

      {/* max-sm: compensate for the full nav height (h-16 = 4rem + device safe area).
          On desktop (sm+) the bottom nav is hidden, so no padding needed. */}
      <main
        className={`flex-1 max-sm:pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0 ${isDemoMode() || backupPermState ? 'pt-24' : 'pt-14'}`}
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
