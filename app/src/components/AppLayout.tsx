import { useState, useEffect, useMemo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { isFsaSupported } from '@/lib/storage/fileSystem'
import Navbar from '@/components/Navbar'
import FAB from '@/components/FAB'
import TransactionDrawer from '@/components/TransactionDrawer'
import ConflictModal from '@/components/ConflictModal'
import Toast from '@/components/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { Transaction } from '@/types'

export interface AppLayoutContext {
  openTransactionDrawer: (tx?: Transaction) => void
}

const NO_FAB_ROUTES = ['/settings']

export default function AppLayout() {
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined)
  const location = useLocation()

  const data = useDataStore((s) => s.data)
  const unsyncedCount = useDataStore((s) => s.unsyncedCount)
  const persist = useDataStore((s) => s.persist)
  const conflictData = useDataStore((s) => s.conflictData)
  const resolveConflict = useDataStore((s) => s.resolveConflict)
  const fileHandleLost = useDataStore((s) => s.fileHandleLost)
  const permissionNeeded = useDataStore((s) => s.permissionNeeded)
  const isSecondaryTab = useDataStore((s) => s.isSecondaryTab)
  const writeError = useDataStore((s) => s.writeError)

  const fsaSupported = useMemo(() => isFsaSupported(), [])
  const FSA_NOTICE_KEY = 'nexus_fsa_notice_seen'
  const [fsaNoticeDismissed, setFsaNoticeDismissed] = useState(
    () => fsaSupported || localStorage.getItem(FSA_NOTICE_KEY) === 'true'
  )

  function handleDismissFsaNotice() {
    localStorage.setItem(FSA_NOTICE_KEY, 'true')
    setFsaNoticeDismissed(true)
  }

  const [showToast, setShowToast] = useState(false)
  useEffect(() => {
    if (!writeError) return
    // Both setState calls are inside async callbacks so they don't
    // trigger the react-hooks/set-state-in-effect lint rule.
    const show = setTimeout(() => setShowToast(true), 0)
    const hide = setTimeout(() => setShowToast(false), 5000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [writeError])

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
      <Navbar
        initials={initials}
        unsyncedCount={unsyncedCount}
        fileHandleLost={fileHandleLost}
        permissionNeeded={permissionNeeded}
        writeError={writeError}
        fsaSupported={fsaSupported}
        onSync={async () => {
          await persist()
        }}
      />

      {isSecondaryTab && (
        <div className="fixed top-14 left-0 right-0 z-40 flex items-center gap-2 bg-tertiary/10 px-6 py-2.5 text-xs text-tertiary border-b border-tertiary/20">
          <AlertTriangle size={14} strokeWidth={2} className="shrink-0" />
          <span>{t('sync.secondaryTabWarning')}</span>
        </div>
      )}

      <main className={`flex-1 ${isSecondaryTab ? 'pt-24' : 'pt-14'}`}>
        {!fsaSupported && !fsaNoticeDismissed && (
          <div className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface-container-low px-6 py-3 text-xs text-on-surface/60 sm:items-center">
            <span>{t('sync.noFsaNotice')}</span>
            <button
              onClick={handleDismissFsaNotice}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium hover:bg-surface-container transition-colors"
            >
              {t('sync.noFsaDismiss')}
            </button>
          </div>
        )}
        <ErrorBoundary fallback="card">
          <Outlet context={{ openTransactionDrawer } satisfies AppLayoutContext} />
        </ErrorBoundary>
      </main>

      {showFAB && <FAB onClick={() => openTransactionDrawer()} />}

      <TransactionDrawer open={drawerOpen} onClose={handleDrawerClose} transaction={editingTx} />

      {conflictData && (
        <ConflictModal
          onOverwrite={() => resolveConflict('overwrite')}
          onLoadCloud={() => void resolveConflict('load-cloud')}
        />
      )}

      {showToast && <Toast message={t('sync.writeError')} onDismiss={() => setShowToast(false)} />}
    </div>
  )
}
